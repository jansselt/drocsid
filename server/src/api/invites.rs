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
use crate::services::permissions as perm_service;
use crate::state::AppState;
use crate::types::entities::{AuditAction, CreateInviteRequest};
use crate::types::events::{InviteCreateEvent, InviteDeleteEvent};
use crate::types::permissions::Permissions;

/// Server-scoped routes (merged into /servers)
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/{server_id}/invites", get(get_invites).post(create_invite))
        .route(
            "/{server_id}/invites/{code}",
            axum::routing::delete(delete_invite),
        )
}

/// Top-level invite resolution routes
pub fn resolve_routes() -> Router<AppState> {
    Router::new().route(
        "/invites/{code}",
        get(resolve_invite).post(use_invite),
    )
}

fn generate_invite_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::rng();
    (0..8)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

async fn create_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateInviteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::CREATE_INSTANT_INVITE,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let expires_at = body
        .max_age_secs
        .filter(|&s| s > 0)
        .map(|s| Utc::now() + chrono::Duration::seconds(s));

    let code = generate_invite_code();
    let invite_id = Uuid::now_v7();

    let invite = queries::create_invite(
        &state.db,
        invite_id,
        server_id,
        None,
        user.user_id,
        &code,
        body.max_uses,
        expires_at,
    )
    .await?;

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::InviteCreate,
        Some(invite_id),
        None,
        Some(serde_json::json!({ "code": code })),
    )
    .await;

    let event = InviteCreateEvent {
        server_id,
        invite: invite.clone(),
    };
    state
        .gateway
        .broadcast_to_server(server_id, "INVITE_CREATE", &event, None);

    Ok(Json(invite))
}

async fn get_invites(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
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

    let invites = queries::get_server_invites(&state.db, server_id).await?;
    Ok(Json(invites))
}

/// Resolve an invite code to server info (no auth required)
async fn resolve_invite(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let invite = queries::get_invite_by_code(&state.db, &code)
        .await?
        .ok_or(ApiError::NotFound("Invite"))?;

    // Check expiry
    if let Some(expires_at) = invite.expires_at {
        if Utc::now() > expires_at {
            return Err(ApiError::NotFound("Invite"));
        }
    }

    // Check max uses
    if let Some(max) = invite.max_uses {
        if invite.uses >= max {
            return Err(ApiError::NotFound("Invite"));
        }
    }

    let server = queries::get_server_by_id(&state.db, invite.server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    Ok(Json(serde_json::json!({
        "code": invite.code,
        "server": {
            "id": server.id,
            "name": server.name,
            "icon_url": server.icon_url,
            "description": server.description,
        }
    })))
}

/// Use an invite to join a server
async fn use_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let invite = queries::get_invite_by_code(&state.db, &code)
        .await?
        .ok_or(ApiError::NotFound("Invite"))?;

    // Check expiry
    if let Some(expires_at) = invite.expires_at {
        if Utc::now() > expires_at {
            return Err(ApiError::NotFound("Invite"));
        }
    }

    // Check max uses
    if let Some(max) = invite.max_uses {
        if invite.uses >= max {
            return Err(ApiError::NotFound("Invite"));
        }
    }

    let server_id = invite.server_id;

    // Check if banned
    if queries::get_ban(&state.db, server_id, user.user_id)
        .await?
        .is_some()
    {
        return Err(ApiError::Forbidden);
    }

    // Check if already a member
    if queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .is_some()
    {
        return Err(ApiError::InvalidInput("Already a member".into()));
    }

    let member = queries::add_server_member(&state.db, server_id, user.user_id).await?;
    queries::increment_invite_uses(&state.db, &code).await?;

    // Subscribe gateway sessions and update presence cache
    state
        .gateway
        .subscribe_to_server_for_user(user.user_id, server_id);
    state.gateway.add_user_server(user.user_id, server_id);

    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

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
        state
            .gateway
            .broadcast_to_server(server_id, "PRESENCE_UPDATE", &presence_event, None);
    }

    Ok(Json(server))
}

async fn delete_invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, code)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
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

    queries::delete_invite(&state.db, &code).await?;

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::InviteDelete,
        None,
        None,
        Some(serde_json::json!({ "code": code })),
    )
    .await;

    let event = InviteDeleteEvent {
        server_id,
        code: code.clone(),
    };
    state
        .gateway
        .broadcast_to_server(server_id, "INVITE_DELETE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}
