use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::Rng;
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::services::permissions as perm_service;
use crate::state::AppState;
use crate::types::entities::{
    AuditAction, CreateWebhookRequest, ExecuteWebhookRequest, PublicUser, UpdateWebhookRequest,
};
use crate::types::events::MessageCreateWithExtrasEvent;
use crate::types::permissions::Permissions;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/{channel_id}/webhooks",
            get(get_webhooks).post(create_webhook),
        )
        .route(
            "/{channel_id}/webhooks/{webhook_id}",
            axum::routing::patch(update_webhook).delete(delete_webhook),
        )
}

/// Standalone route for executing webhooks (no auth needed, uses token)
pub fn execute_routes() -> Router<AppState> {
    Router::new().route(
        "/webhooks/{webhook_id}/{token}",
        post(execute_webhook),
    )
}

fn generate_webhook_token() -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    let mut rng = rand::rng();
    (0..68)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

async fn create_webhook(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let server_id = channel.server_id.ok_or(ApiError::InvalidInput(
        "Webhooks are only for server channels".into(),
    ))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_channel_permission(
        &state.db,
        server_id,
        channel_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    if body.name.is_empty() || body.name.len() > 80 {
        return Err(ApiError::InvalidInput(
            "Webhook name must be 1-80 characters".into(),
        ));
    }

    let webhook_id = Uuid::now_v7();
    let token = generate_webhook_token();

    let webhook = queries::create_webhook(
        &state.db,
        webhook_id,
        server_id,
        channel_id,
        user.user_id,
        &body.name,
        &token,
    )
    .await?;

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::WebhookCreate,
        Some(webhook_id),
        None,
        Some(serde_json::json!({ "name": body.name })),
    )
    .await;

    Ok(Json(webhook))
}

async fn get_webhooks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let server_id = channel.server_id.ok_or(ApiError::InvalidInput(
        "Webhooks are only for server channels".into(),
    ))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_channel_permission(
        &state.db,
        server_id,
        channel_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let webhooks = queries::get_channel_webhooks(&state.db, channel_id).await?;
    Ok(Json(webhooks))
}

async fn update_webhook(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, webhook_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateWebhookRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let server_id = channel.server_id.ok_or(ApiError::InvalidInput(
        "Webhooks are only for server channels".into(),
    ))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_channel_permission(
        &state.db,
        server_id,
        channel_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let webhook = queries::update_webhook(
        &state.db,
        webhook_id,
        body.name.as_deref(),
        body.channel_id,
    )
    .await?;

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::WebhookUpdate,
        Some(webhook_id),
        None,
        None,
    )
    .await;

    Ok(Json(webhook))
}

async fn delete_webhook(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, webhook_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let channel = queries::get_channel_by_id(&state.db, channel_id)
        .await?
        .ok_or(ApiError::NotFound("Channel"))?;

    let server_id = channel.server_id.ok_or(ApiError::InvalidInput(
        "Webhooks are only for server channels".into(),
    ))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_channel_permission(
        &state.db,
        server_id,
        channel_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_WEBHOOKS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    queries::delete_webhook(&state.db, webhook_id).await?;

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::WebhookDelete,
        Some(webhook_id),
        None,
        None,
    )
    .await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Execute a webhook — no auth required, uses webhook token in URL
async fn execute_webhook(
    State(state): State<AppState>,
    Path((webhook_id, token)): Path<(Uuid, String)>,
    Json(body): Json<ExecuteWebhookRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let webhook = queries::get_webhook_by_id(&state.db, webhook_id)
        .await?
        .ok_or(ApiError::NotFound("Webhook"))?;

    if webhook.token != token {
        return Err(ApiError::Unauthorized);
    }

    if body.content.is_empty() || body.content.len() > 4000 {
        return Err(ApiError::InvalidInput(
            "Message content must be 1-4000 characters".into(),
        ));
    }

    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    // Create a message as the webhook's creator but with webhook identity
    let message_id = Uuid::now_v7();
    let message = queries::create_message(
        &state.db,
        message_id,
        instance_id,
        webhook.channel_id,
        webhook.creator_id,
        &body.content,
        None,
    )
    .await?;

    // Build the author info — use webhook name/avatar overrides
    let webhook_user = PublicUser {
        id: webhook.creator_id,
        username: body.username.unwrap_or(webhook.name),
        display_name: None,
        avatar_url: body.avatar_url.or(webhook.avatar_url),
        bio: None,
        status: "online".to_string(),
        custom_status: None,
        theme_preference: None,
        bot: true,
    };

    let event = MessageCreateWithExtrasEvent {
        message,
        author: webhook_user,
        attachments: vec![],
    };

    state.gateway.broadcast_to_server(
        webhook.server_id,
        "MESSAGE_CREATE",
        &event,
        None,
    );

    Ok(axum::http::StatusCode::NO_CONTENT)
}
