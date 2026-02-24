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
use crate::types::entities::SetJoinSoundRequest;
use crate::types::events::{SoundboardPlayEvent, SoundboardSoundCreateEvent, SoundboardSoundDeleteEvent};
use crate::types::permissions::Permissions;

const MAX_SOUNDS_PER_SERVER: i64 = 48;
const MAX_SOUND_DURATION_MS: i32 = 15_000;
const MAX_JOIN_SOUND_DURATION_MS: i32 = 5_000;
const MAX_SOUND_FILE_BYTES: usize = 2 * 1024 * 1024; // 2 MB
const ALLOWED_AUDIO_TYPES: &[&str] = &["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm"];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/{server_id}/soundboard", get(list_sounds).post(upload_sound))
        .route(
            "/{server_id}/soundboard/{sound_id}",
            axum::routing::delete(delete_sound),
        )
        .route(
            "/{server_id}/soundboard/{sound_id}/play",
            post(play_sound),
        )
        .route(
            "/{server_id}/soundboard/join-sound",
            axum::routing::put(set_join_sound).delete(clear_join_sound),
        )
}

/// GET /servers/:server_id/soundboard
async fn list_sounds(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify membership
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let sounds = queries::get_soundboard_sounds(&state.db, server_id).await?;
    Ok(Json(sounds))
}

/// POST /servers/:server_id/soundboard
async fn upload_sound(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    multipart: axum::extract::Multipart,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Check MANAGE_SOUNDBOARD permission
    if server.owner_id != user.user_id
        && !perm_service::has_server_permission(
            &state.db,
            server_id,
            user.user_id,
            server.owner_id,
            Permissions::MANAGE_SOUNDBOARD,
        )
        .await?
    {
        return Err(ApiError::Forbidden);
    }

    // Check sound count limit
    let count = queries::count_server_sounds(&state.db, server_id).await?;
    if count >= MAX_SOUNDS_PER_SERVER {
        return Err(ApiError::InvalidInput(
            format!("Server has reached the maximum of {} sounds", MAX_SOUNDS_PER_SERVER),
        ));
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

    // Extract all fields from multipart
    let (filename, content_type, data, name, duration_ms, emoji_name) =
        extract_soundboard_multipart(multipart).await?;

    // Validate audio content type
    if !ALLOWED_AUDIO_TYPES.contains(&content_type.as_str()) {
        return Err(ApiError::InvalidInput(
            "File must be audio (mp3, ogg, wav, or webm)".into(),
        ));
    }

    // Validate duration
    if duration_ms <= 0 || duration_ms > MAX_SOUND_DURATION_MS {
        return Err(ApiError::InvalidInput(
            format!("Sound duration must be between 1ms and {}ms", MAX_SOUND_DURATION_MS),
        ));
    }

    // Validate name
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 32 {
        return Err(ApiError::InvalidInput(
            "Sound name must be 1-32 characters".into(),
        ));
    }

    let sound_id = Uuid::now_v7();
    let object_key = format!("soundboard/{}/{}/{}", server_id, sound_id, filename);
    let file_url =
        crate::services::uploads::upload_to_s3(s3, s3_config, &object_key, &content_type, data)
            .await?;

    let sound = queries::create_soundboard_sound(
        &state.db,
        sound_id,
        server_id,
        user.user_id,
        &name,
        &file_url,
        duration_ms,
        emoji_name.as_deref(),
    )
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    // Broadcast to server
    let event = SoundboardSoundCreateEvent {
        server_id,
        sound: sound.clone(),
    };
    state
        .gateway
        .broadcast_to_server(server_id, "SOUNDBOARD_SOUND_CREATE", &event, None);

    Ok(Json(sound))
}

/// DELETE /servers/:server_id/soundboard/:sound_id
async fn delete_sound(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, sound_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let sound = queries::get_soundboard_sound(&state.db, sound_id)
        .await?
        .ok_or(ApiError::NotFound("Sound"))?;

    if sound.server_id != server_id {
        return Err(ApiError::NotFound("Sound"));
    }

    // Allow uploader or users with MANAGE_SOUNDBOARD
    let is_uploader = sound.uploader_id == user.user_id;
    if !is_uploader
        && server.owner_id != user.user_id
        && !perm_service::has_server_permission(
            &state.db,
            server_id,
            user.user_id,
            server.owner_id,
            Permissions::MANAGE_SOUNDBOARD,
        )
        .await?
    {
        return Err(ApiError::Forbidden);
    }

    queries::delete_soundboard_sound(&state.db, sound_id).await?;

    // Broadcast deletion
    let event = SoundboardSoundDeleteEvent {
        server_id,
        sound_id,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "SOUNDBOARD_SOUND_DELETE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /servers/:server_id/soundboard/:sound_id/play
async fn play_sound(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, sound_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Check USE_SOUNDBOARD permission
    if server.owner_id != user.user_id
        && !perm_service::has_server_permission(
            &state.db,
            server_id,
            user.user_id,
            server.owner_id,
            Permissions::USE_SOUNDBOARD,
        )
        .await?
    {
        return Err(ApiError::Forbidden);
    }

    // Verify user is in a voice channel in this server
    let voice_state = state
        .gateway
        .voice_state(user.user_id)
        .ok_or(ApiError::InvalidInput("Not in a voice channel".into()))?;

    if voice_state.server_id != server_id {
        return Err(ApiError::InvalidInput(
            "Not in a voice channel in this server".into(),
        ));
    }

    // Get the sound
    let sound = queries::get_soundboard_sound(&state.db, sound_id)
        .await?
        .ok_or(ApiError::NotFound("Sound"))?;

    if sound.server_id != server_id {
        return Err(ApiError::NotFound("Sound"));
    }

    // Broadcast SOUNDBOARD_PLAY to all users in the voice channel
    let event = SoundboardPlayEvent {
        server_id,
        channel_id: voice_state.channel_id,
        sound_id,
        audio_url: sound.audio_url,
        volume: sound.volume,
        user_id: user.user_id,
    };

    let channel_users = state.gateway.voice_channel_users(voice_state.channel_id);
    for vs in &channel_users {
        state
            .gateway
            .dispatch_to_user(vs.user_id, "SOUNDBOARD_PLAY", &event);
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// PUT /servers/:server_id/soundboard/join-sound
async fn set_join_sound(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<SetJoinSoundRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify membership
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Verify the sound exists in this server and is short enough
    let sound = queries::get_soundboard_sound(&state.db, body.sound_id)
        .await?
        .ok_or(ApiError::NotFound("Sound"))?;

    if sound.server_id != server_id {
        return Err(ApiError::NotFound("Sound"));
    }

    if sound.duration_ms > MAX_JOIN_SOUND_DURATION_MS {
        return Err(ApiError::InvalidInput(
            format!(
                "Join sound must be {} seconds or shorter",
                MAX_JOIN_SOUND_DURATION_MS / 1000
            ),
        ));
    }

    queries::set_member_join_sound(&state.db, server_id, user.user_id, Some(body.sound_id))
        .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// DELETE /servers/:server_id/soundboard/join-sound
async fn clear_join_sound(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify membership
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    queries::set_member_join_sound(&state.db, server_id, user.user_id, None).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Extract multipart form with file + text fields for soundboard upload
async fn extract_soundboard_multipart(
    mut multipart: axum::extract::Multipart,
) -> Result<(String, String, Vec<u8>, String, i32, Option<String>), ApiError> {
    let mut file_data: Option<(String, String, Vec<u8>)> = None;
    let mut name: Option<String> = None;
    let mut duration_ms: Option<i32> = None;
    let mut emoji_name: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::InvalidInput(format!("Failed to read form: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "file" => {
                let filename = field
                    .file_name()
                    .unwrap_or("upload")
                    .to_string();
                let content_type = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| ApiError::InvalidInput(format!("Failed to read file: {e}")))?
                    .to_vec();

                if data.len() > MAX_SOUND_FILE_BYTES {
                    return Err(ApiError::InvalidInput(format!(
                        "File too large (max {} MB)",
                        MAX_SOUND_FILE_BYTES / (1024 * 1024)
                    )));
                }

                file_data = Some((filename, content_type, data));
            }
            "name" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| ApiError::InvalidInput(format!("Failed to read name: {e}")))?;
                name = Some(text);
            }
            "duration_ms" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| ApiError::InvalidInput(format!("Failed to read duration: {e}")))?;
                duration_ms = Some(
                    text.parse::<i32>()
                        .map_err(|_| ApiError::InvalidInput("Invalid duration_ms".into()))?,
                );
            }
            "emoji_name" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| ApiError::InvalidInput(format!("Failed to read emoji: {e}")))?;
                if !text.is_empty() {
                    emoji_name = Some(text);
                }
            }
            _ => {}
        }
    }

    let (filename, content_type, data) =
        file_data.ok_or(ApiError::InvalidInput("Missing audio file".into()))?;
    let name = name.ok_or(ApiError::InvalidInput("Missing sound name".into()))?;
    let duration_ms =
        duration_ms.ok_or(ApiError::InvalidInput("Missing duration_ms".into()))?;

    Ok((filename, content_type, data, name, duration_ms, emoji_name))
}
