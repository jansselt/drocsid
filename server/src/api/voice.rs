use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use uuid::Uuid;

use livekit_api::access_token;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::services::permissions as perm_service;
use crate::state::AppState;
use crate::types::entities::{ChannelType, VoiceJoinRequest, VoiceStateUpdate};
use crate::types::events::{SoundboardPlayEvent, VoiceTokenResponse};
use crate::types::permissions::Permissions;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/{channel_id}/voice/join", post(voice_join))
        .route("/{channel_id}/voice/leave", post(voice_leave))
        .route("/{channel_id}/voice/state", axum::routing::patch(voice_update_state))
        .route("/{channel_id}/voice/states", get(voice_get_states))
}

/// POST /channels/:channel_id/voice/join
/// Join a voice channel and get a LiveKit token.
/// Works for both server voice channels and DM/group-DM channels.
async fn voice_join(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<VoiceJoinRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify channel exists
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let self_mute = body.self_mute.unwrap_or(false);
    let self_deaf = body.self_deaf.unwrap_or(false);

    // Branch: server voice channel vs DM voice call
    let (server_id, can_speak, dm_member_ids) = if let Some(sid) = channel.server_id {
        // ── Server voice channel ──
        if channel.channel_type != ChannelType::Voice {
            return Err(ApiError::InvalidInput("Not a voice channel".into()));
        }

        let server = queries::get_server_by_id(&state.db, sid)
            .await?
            .ok_or(ApiError::NotFound("Server"))?;

        // Check membership
        queries::get_server_member(&state.db, sid, user.user_id)
            .await?
            .ok_or(ApiError::NotFound("Channel"))?;

        // Check CONNECT permission
        if !perm_service::has_channel_permission(
            &state.db,
            sid,
            channel_id,
            user.user_id,
            server.owner_id,
            Permissions::CONNECT,
        )
        .await?
        {
            return Err(ApiError::Forbidden);
        }

        // Check SPEAK permission
        let speak = perm_service::has_channel_permission(
            &state.db,
            sid,
            channel_id,
            user.user_id,
            server.owner_id,
            Permissions::SPEAK,
        )
        .await
        .unwrap_or(false);

        (Some(sid), speak, None)
    } else {
        // ── DM / Group DM voice call ──
        if !matches!(channel.channel_type, ChannelType::Dm | ChannelType::GroupDm) {
            return Err(ApiError::InvalidInput("Not a DM channel".into()));
        }

        // Verify the caller is a member of this DM
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        let is_member = members.iter().any(|m| m.id == user.user_id);
        if !is_member {
            return Err(ApiError::Forbidden);
        }

        let member_ids: Vec<Uuid> = members.iter().map(|m| m.id).collect();
        // All DM participants can speak
        (None, true, Some(member_ids))
    };

    // Get LiveKit config
    let lk_config = state
        .config
        .livekit
        .as_ref()
        .ok_or(ApiError::Internal(anyhow::anyhow!("LiveKit not configured")))?;

    // Get user info for the token
    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    // Room name = channel_id (each voice channel maps to a LiveKit room)
    let room_name = channel_id.to_string();

    let token = access_token::AccessToken::with_api_key(
        &lk_config.api_key,
        &lk_config.api_secret,
    )
    .with_identity(&user.user_id.to_string())
    .with_name(&user_data.username)
    .with_grants(access_token::VideoGrants {
        room_join: true,
        room: room_name,
        can_publish: can_speak,
        can_subscribe: true,
        can_publish_data: true,
        ..Default::default()
    })
    .to_jwt()
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("Token generation failed: {e}")))?;

    // Track voice state in gateway
    state.gateway.voice_join(
        user.user_id,
        channel_id,
        server_id,
        self_mute,
        self_deaf,
        dm_member_ids,
    );

    // Play entrance sound (server voice channels only)
    if let Some(sid) = server_id {
        if let Ok(Some(join_sound)) =
            queries::get_member_join_sound(&state.db, sid, user.user_id).await
        {
            let play_event = SoundboardPlayEvent {
                server_id: sid,
                channel_id,
                sound_id: join_sound.id,
                audio_url: join_sound.audio_url,
                volume: join_sound.volume,
                user_id: user.user_id,
            };
            let channel_users = state.gateway.voice_channel_users(channel_id);
            for vs in &channel_users {
                state
                    .gateway
                    .dispatch_to_user(vs.user_id, "SOUNDBOARD_PLAY", &play_event);
            }
        }
    }

    Ok(Json(VoiceTokenResponse {
        token,
        url: lk_config.public_url.clone(),
    }))
}

/// POST /channels/:channel_id/voice/leave
async fn voice_leave(
    State(state): State<AppState>,
    user: AuthUser,
    Path(_channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    state.gateway.voice_leave(user.user_id);
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// PATCH /channels/:channel_id/voice/state
/// Update mute/deaf state
async fn voice_update_state(
    State(state): State<AppState>,
    user: AuthUser,
    Path(_channel_id): Path<Uuid>,
    Json(body): Json<VoiceStateUpdate>,
) -> Result<impl IntoResponse, ApiError> {
    let current = state
        .gateway
        .voice_state(user.user_id)
        .ok_or(ApiError::InvalidInput("Not in a voice channel".into()))?;

    let self_mute = body.self_mute.unwrap_or(current.self_mute);
    let self_deaf = body.self_deaf.unwrap_or(current.self_deaf);
    let audio_sharing = body.audio_sharing.unwrap_or(current.audio_sharing);

    state.gateway.voice_update(user.user_id, self_mute, self_deaf, audio_sharing);
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /channels/:channel_id/voice/states
/// Get all users in a voice channel (works for both server and DM channels)
async fn voice_get_states(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    if let Some(server_id) = channel.server_id {
        // Server voice channel — check VIEW_CHANNEL permission
        let server = queries::get_server_by_id(&state.db, server_id)
            .await?
            .ok_or(ApiError::NotFound("Server"))?;

        if !perm_service::has_channel_permission(
            &state.db,
            server_id,
            channel_id,
            user.user_id,
            server.owner_id,
            Permissions::VIEW_CHANNEL,
        )
        .await?
        {
            return Err(ApiError::Forbidden);
        }
    } else {
        // DM channel — check membership
        let members = queries::get_dm_members(&state.db, channel_id).await?;
        if !members.iter().any(|m| m.id == user.user_id) {
            return Err(ApiError::Forbidden);
        }
    }

    let states: Vec<VoiceStateResponse> = state
        .gateway
        .voice_channel_users(channel_id)
        .into_iter()
        .map(|vs| VoiceStateResponse {
            user_id: vs.user_id,
            channel_id: vs.channel_id,
            self_mute: vs.self_mute,
            self_deaf: vs.self_deaf,
            audio_sharing: vs.audio_sharing,
        })
        .collect();

    Ok(Json(states))
}

#[derive(serde::Serialize)]
struct VoiceStateResponse {
    user_id: Uuid,
    channel_id: Uuid,
    self_mute: bool,
    self_deaf: bool,
    audio_sharing: bool,
}
