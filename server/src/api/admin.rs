use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use rand::Rng;
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::CreateRegistrationCodeRequest;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/registration-codes",
            get(list_registration_codes).post(create_registration_code),
        )
        .route(
            "/registration-codes/{code}",
            axum::routing::delete(delete_registration_code),
        )
        .route(
            "/users/{user_id}",
            axum::routing::patch(admin_set_user_admin)
                .delete(admin_delete_user),
        )
        .route(
            "/channels/{channel_id}/messages",
            axum::routing::delete(admin_purge_channel),
        )
}

fn generate_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::rng();
    (0..8)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

async fn require_admin(state: &AppState, user_id: Uuid) -> Result<(), ApiError> {
    let user = queries::get_user_by_id(&state.db, user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;
    if !user.is_admin {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

async fn list_registration_codes(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;
    let codes = queries::get_all_registration_codes(&state.db).await?;
    Ok(Json(codes))
}

async fn create_registration_code(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateRegistrationCodeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let id = Uuid::now_v7();
    let code = generate_code();
    let expires_at = body
        .max_age_secs
        .map(|secs| Utc::now() + chrono::Duration::seconds(secs));

    let reg_code =
        queries::create_registration_code(&state.db, id, user.user_id, &code, body.max_uses, expires_at)
            .await?;

    Ok(Json(reg_code))
}

async fn delete_registration_code(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;
    queries::delete_registration_code(&state.db, &code).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(serde::Deserialize)]
struct SetAdminRequest {
    is_admin: bool,
}

async fn admin_set_user_admin(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target_user_id): Path<Uuid>,
    Json(body): Json<SetAdminRequest>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    if target_user_id == user.user_id {
        return Err(ApiError::InvalidInput(
            "Cannot change your own admin status".into(),
        ));
    }

    let _target = queries::get_user_by_id(&state.db, target_user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    queries::set_user_admin(&state.db, target_user_id, body.is_admin).await?;

    Ok(Json(serde_json::json!({ "is_admin": body.is_admin })))
}

async fn admin_delete_user(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    // Prevent self-deletion via admin endpoint
    if target_user_id == user.user_id {
        return Err(ApiError::InvalidInput(
            "Cannot delete your own account via admin endpoint".into(),
        ));
    }

    let _target = queries::get_user_by_id(&state.db, target_user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    // Delete all servers owned by target user
    let servers = queries::get_user_servers(&state.db, target_user_id).await?;
    for server in &servers {
        if server.owner_id == target_user_id {
            queries::delete_server(&state.db, server.id).await?;
        }
    }

    queries::delete_user(&state.db, target_user_id).await?;
    state.gateway.disconnect_user(target_user_id);

    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn admin_purge_channel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let count = queries::delete_channel_messages(&state.db, channel_id).await?;

    // Broadcast purge event so connected clients clear messages
    if let Some(sid) = channel.server_id {
        state.gateway.broadcast_to_server(
            sid,
            "CHANNEL_MESSAGES_PURGE",
            &serde_json::json!({ "channel_id": channel_id }),
            None,
        );
    }

    Ok(Json(serde_json::json!({ "purged": count })))
}
