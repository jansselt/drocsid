use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::api::channels::resolve_channel_with_perm;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::{CreateScheduledMessageRequest, UpdateScheduledMessageRequest};
use crate::types::permissions::Permissions;

const MAX_SCHEDULED_PER_USER: usize = 25;

/// Routes nested under /users/@me/scheduled-messages
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_scheduled))
        .route(
            "/{scheduled_id}",
            axum::routing::patch(update_scheduled).delete(cancel_scheduled),
        )
}

/// Routes nested under /channels
pub fn channel_routes() -> Router<AppState> {
    Router::new().route(
        "/{channel_id}/scheduled-messages",
        axum::routing::post(create_scheduled),
    )
}

/// POST /channels/{channel_id}/scheduled-messages
async fn create_scheduled(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateScheduledMessageRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Validate content
    if body.content.is_empty() || body.content.len() > 4000 {
        return Err(ApiError::InvalidInput(
            "Message must be 1-4000 characters".into(),
        ));
    }

    // Must be at least 1 minute in the future
    let min_time = Utc::now() + chrono::Duration::seconds(60);
    if body.send_at < min_time {
        return Err(ApiError::InvalidInput(
            "Scheduled time must be at least 1 minute in the future".into(),
        ));
    }

    // Max 7 days in the future
    let max_time = Utc::now() + chrono::Duration::days(7);
    if body.send_at > max_time {
        return Err(ApiError::InvalidInput(
            "Scheduled time must be within 7 days".into(),
        ));
    }

    // Permission check
    let _ = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
    )
    .await?;

    // Rate limit per user
    let existing = queries::get_scheduled_messages_for_user(&state.db, user.user_id).await?;
    if existing.len() >= MAX_SCHEDULED_PER_USER {
        return Err(ApiError::InvalidInput(format!(
            "Maximum of {MAX_SCHEDULED_PER_USER} scheduled messages"
        )));
    }

    let id = Uuid::now_v7();
    let scheduled = queries::create_scheduled_message(
        &state.db,
        id,
        channel_id,
        user.user_id,
        &body.content,
        body.reply_to_id,
        body.send_at,
    )
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(scheduled)))
}

/// GET /users/@me/scheduled-messages
async fn list_scheduled(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    let scheduled = queries::get_scheduled_messages_for_user(&state.db, user.user_id).await?;
    Ok(Json(scheduled))
}

/// PATCH /users/@me/scheduled-messages/{scheduled_id}
async fn update_scheduled(
    State(state): State<AppState>,
    user: AuthUser,
    Path(scheduled_id): Path<Uuid>,
    Json(body): Json<UpdateScheduledMessageRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(ref content) = body.content {
        if content.is_empty() || content.len() > 4000 {
            return Err(ApiError::InvalidInput(
                "Message must be 1-4000 characters".into(),
            ));
        }
    }

    if let Some(send_at) = body.send_at {
        let min_time = Utc::now() + chrono::Duration::seconds(60);
        if send_at < min_time {
            return Err(ApiError::InvalidInput(
                "Scheduled time must be at least 1 minute in the future".into(),
            ));
        }
        let max_time = Utc::now() + chrono::Duration::days(7);
        if send_at > max_time {
            return Err(ApiError::InvalidInput(
                "Scheduled time must be within 7 days".into(),
            ));
        }
    }

    let updated = queries::update_scheduled_message(
        &state.db,
        scheduled_id,
        user.user_id,
        body.content.as_deref(),
        body.send_at,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => ApiError::NotFound("Scheduled message"),
        other => ApiError::Database(other),
    })?;

    Ok(Json(updated))
}

/// DELETE /users/@me/scheduled-messages/{scheduled_id}
async fn cancel_scheduled(
    State(state): State<AppState>,
    user: AuthUser,
    Path(scheduled_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let deleted =
        queries::delete_scheduled_message(&state.db, scheduled_id, user.user_id).await?;
    if !deleted {
        return Err(ApiError::NotFound("Scheduled message"));
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}
