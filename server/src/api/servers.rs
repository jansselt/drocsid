use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::services::permissions as perm_service;
use crate::state::AppState;
use crate::types::entities::{
    ChannelType, CreateChannelRequest, CreateServerRequest, PublicUser, ServerMemberWithUser,
    UploadRequest,
};
use crate::types::permissions::Permissions;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(create_server))
        .route("/{server_id}", get(get_server).patch(update_server_handler).delete(delete_server_handler))
        .route("/{server_id}/icon", post(request_icon_upload))
        .route(
            "/{server_id}/channels",
            get(get_channels).post(create_channel),
        )
        .route("/{server_id}/members", get(get_members))
        .route(
            "/{server_id}/members/@me",
            post(join_server).delete(leave_server),
        )
}

async fn create_server(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateServerRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if body.name.is_empty() || body.name.len() > 100 {
        return Err(ApiError::InvalidInput(
            "Server name must be 1-100 characters".into(),
        ));
    }

    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    let server_id = Uuid::now_v7();
    let server = queries::create_server(
        &state.db,
        server_id,
        instance_id,
        &body.name,
        body.description.as_deref(),
        user.user_id,
    )
    .await?;

    // Add creator as member
    queries::add_server_member(&state.db, server_id, user.user_id).await?;

    // Create default #general channel
    let channel_id = Uuid::now_v7();
    queries::create_channel(
        &state.db,
        channel_id,
        instance_id,
        Some(server_id),
        ChannelType::Text,
        Some("general"),
        None,
        None,
        0,
    )
    .await?;

    // Set default channel
    queries::update_server_default_channel(&state.db, server_id, channel_id).await?;

    // Create @everyone role with default permissions
    let role_id = Uuid::now_v7();
    queries::create_role(
        &state.db,
        role_id,
        server_id,
        "everyone",
        Permissions::default().bits(),
        true,
        0,
    )
    .await?;

    // Subscribe the creator's gateway sessions to this server
    state
        .gateway
        .subscribe_to_server_for_user(user.user_id, server_id);

    // Broadcast to the creator
    state
        .gateway
        .dispatch_to_user(user.user_id, "SERVER_CREATE", &server);

    Ok(Json(server))
}

async fn get_server(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    Ok(Json(server))
}

async fn delete_server_handler(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Only the owner can delete a server
    if server.owner_id != user.user_id {
        return Err(ApiError::Forbidden);
    }

    queries::delete_server(&state.db, server_id).await?;

    state.gateway.broadcast_to_server(
        server_id,
        "SERVER_DELETE",
        &serde_json::json!({ "id": server_id }),
        None,
    );

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn get_channels(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let channels = queries::get_server_channels(&state.db, server_id).await?;

    // Filter channels based on VIEW_CHANNEL permission
    let mut visible = Vec::new();
    for channel in channels {
        if perm_service::has_channel_permission(
            &state.db,
            server_id,
            channel.id,
            user.user_id,
            server.owner_id,
            Permissions::VIEW_CHANNEL,
        )
        .await?
        {
            visible.push(channel);
        }
    }

    Ok(Json(visible))
}

async fn create_channel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateChannelRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Need MANAGE_CHANNELS permission
    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_CHANNELS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    if body.name.is_empty() || body.name.len() > 100 {
        return Err(ApiError::InvalidInput(
            "Channel name must be 1-100 characters".into(),
        ));
    }

    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    let channel_type = body.channel_type.unwrap_or(ChannelType::Text);
    let channel_id = Uuid::now_v7();

    // Get next position
    let existing = queries::get_server_channels(&state.db, server_id).await?;
    let position = existing.len() as i32;

    let channel = queries::create_channel(
        &state.db,
        channel_id,
        instance_id,
        Some(server_id),
        channel_type,
        Some(&body.name),
        body.topic.as_deref(),
        body.parent_id,
        position,
    )
    .await?;

    state
        .gateway
        .broadcast_to_server(server_id, "CHANNEL_CREATE", &channel, None);

    Ok(Json(channel))
}

async fn get_members(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let members = queries::get_server_members(&state.db, server_id).await?;

    // Enrich with user data, presence, and roles
    let mut enriched = Vec::with_capacity(members.len());
    for member in members {
        let user_data = queries::get_user_by_id(&state.db, member.user_id).await?;
        let role_ids = queries::get_member_role_ids(&state.db, server_id, member.user_id).await?;

        if let Some(user_data) = user_data {
            let status = state.gateway.get_presence(member.user_id);
            enriched.push(ServerMemberWithUser {
                server_id: member.server_id,
                user_id: member.user_id,
                nickname: member.nickname,
                joined_at: member.joined_at,
                user: PublicUser::from(user_data),
                status,
                role_ids,
            });
        }
    }

    Ok(Json(enriched))
}

async fn join_server(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .is_some()
    {
        return Err(ApiError::InvalidInput("Already a member".into()));
    }

    let member = queries::add_server_member(&state.db, server_id, user.user_id).await?;

    // Subscribe gateway sessions and update presence cache
    state
        .gateway
        .subscribe_to_server_for_user(user.user_id, server_id);
    state.gateway.add_user_server(user.user_id, server_id);

    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    let event = crate::types::events::ServerMemberAddEvent {
        server_id,
        member,
        user: user_data.into(),
    };
    state
        .gateway
        .broadcast_to_server(server_id, "SERVER_MEMBER_ADD", &event, None);

    state
        .gateway
        .dispatch_to_user(user.user_id, "SERVER_CREATE", &server);

    // Broadcast presence to the new server so existing members see the joiner's status
    if state.gateway.is_online(user.user_id) {
        let status = state.gateway.get_presence(user.user_id);
        let presence_event = crate::types::events::PresenceUpdateEvent {
            user_id: user.user_id,
            status,
            custom_status: None,
        };
        state.gateway.broadcast_to_server(server_id, "PRESENCE_UPDATE", &presence_event, None);
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn leave_server(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if server.owner_id == user.user_id {
        return Err(ApiError::InvalidInput(
            "Server owner cannot leave. Transfer ownership or delete the server.".into(),
        ));
    }

    queries::remove_server_member(&state.db, server_id, user.user_id).await?;
    state.gateway.remove_user_server(user.user_id, server_id);

    let event = crate::types::events::ServerMemberRemoveEvent {
        server_id,
        user_id: user.user_id,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "SERVER_MEMBER_REMOVE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Server Update ───────────────────────────────────

#[derive(serde::Deserialize)]
struct UpdateServerRequest {
    name: Option<String>,
    description: Option<String>,
    icon_url: Option<String>,
}

async fn update_server_handler(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<UpdateServerRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Require owner or MANAGE_SERVER permission
    if server.owner_id != user.user_id
        && !perm_service::has_server_permission(
            &state.db,
            server_id,
            user.user_id,
            server.owner_id,
            Permissions::MANAGE_SERVER,
        )
        .await?
    {
        return Err(ApiError::Forbidden);
    }

    if let Some(ref name) = body.name {
        if name.is_empty() || name.len() > 100 {
            return Err(ApiError::InvalidInput(
                "Server name must be 1-100 characters".into(),
            ));
        }
    }

    let updated = queries::update_server(
        &state.db,
        server_id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.icon_url.as_deref(),
    )
    .await?;

    state
        .gateway
        .broadcast_to_server(server_id, "SERVER_UPDATE", &updated, None);

    Ok(Json(updated))
}

async fn request_icon_upload(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<UploadRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if server.owner_id != user.user_id
        && !perm_service::has_server_permission(
            &state.db,
            server_id,
            user.user_id,
            server.owner_id,
            Permissions::MANAGE_SERVER,
        )
        .await?
    {
        return Err(ApiError::Forbidden);
    }

    let s3 = state
        .s3
        .as_ref()
        .ok_or_else(|| ApiError::InvalidInput("File uploads not configured".into()))?;
    let s3_config = state
        .config
        .s3
        .as_ref()
        .ok_or_else(|| ApiError::InvalidInput("File uploads not configured".into()))?;

    if body.size_bytes > 5 * 1024 * 1024 {
        return Err(ApiError::InvalidInput(
            "Icon too large (max 5 MB)".into(),
        ));
    }

    if !body.content_type.starts_with("image/") {
        return Err(ApiError::InvalidInput(
            "Icon must be an image".into(),
        ));
    }

    let object_key = format!("avatars/servers/{}/{}", server_id, body.filename);

    let presigned = s3
        .put_object()
        .bucket(&s3_config.bucket)
        .key(&object_key)
        .content_type(&body.content_type)
        .content_length(body.size_bytes)
        .presigned(
            aws_sdk_s3::presigning::PresigningConfig::builder()
                .expires_in(std::time::Duration::from_secs(600))
                .build()
                .map_err(|e| ApiError::Internal(e.into()))?,
        )
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let file_url = format!("{}/{}", s3_config.public_url.trim_end_matches('/'), object_key);

    Ok(Json(crate::types::entities::UploadUrlResponse {
        upload_url: presigned.uri().to_string(),
        file_url,
        attachment_id: String::new(),
    }))
}
