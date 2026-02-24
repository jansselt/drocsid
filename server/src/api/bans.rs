use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::services::permissions as perm_service;
use crate::state::AppState;
use crate::types::entities::{
    AuditAction, AuditLogEntryWithUser, AuditLogQuery, BanWithUser, CreateBanRequest, PublicUser,
};
use crate::types::events::{BanCreateEvent, BanDeleteEvent, ServerMemberRemoveEvent};
use crate::types::permissions::Permissions;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/{server_id}/bans",
            get(get_bans),
        )
        .route(
            "/{server_id}/bans/{user_id}",
            axum::routing::put(ban_member).delete(unban_member),
        )
        .route(
            "/{server_id}/kick/{user_id}",
            axum::routing::post(kick_member),
        )
        .route("/{server_id}/audit-log", get(get_audit_log))
}

async fn get_bans(
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
        Permissions::BAN_MEMBERS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let bans = queries::get_server_bans(&state.db, server_id).await?;

    // Enrich with user info
    let mut result = Vec::new();
    for ban in bans {
        let user_data = queries::get_user_by_id(&state.db, ban.user_id).await?;
        if let Some(u) = user_data {
            result.push(BanWithUser {
                ban,
                user: PublicUser::from(u),
            });
        }
    }

    Ok(Json(result))
}

async fn ban_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, target_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateBanRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::BAN_MEMBERS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    // Can't ban the owner
    if target_id == server.owner_id {
        return Err(ApiError::InvalidInput("Cannot ban the server owner".into()));
    }

    // Can't ban yourself
    if target_id == user.user_id {
        return Err(ApiError::InvalidInput("Cannot ban yourself".into()));
    }

    // Create the ban
    let ban = queries::create_ban(
        &state.db,
        server_id,
        target_id,
        user.user_id,
        body.reason.as_deref(),
    )
    .await?;

    // Remove from server if member
    if queries::get_server_member(&state.db, server_id, target_id)
        .await?
        .is_some()
    {
        queries::remove_server_member(&state.db, server_id, target_id).await?;

        let remove_event = ServerMemberRemoveEvent {
            server_id,
            user_id: target_id,
        };
        state.gateway.broadcast_to_server(
            server_id,
            "SERVER_MEMBER_REMOVE",
            &remove_event,
            None,
        );
    }

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::MemberBan,
        Some(target_id),
        body.reason.as_deref(),
        None,
    )
    .await;

    let event = BanCreateEvent {
        server_id,
        user_id: target_id,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "BAN_CREATE", &event, None);

    Ok(Json(ban))
}

async fn unban_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, target_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::BAN_MEMBERS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    queries::delete_ban(&state.db, server_id, target_id).await?;

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::MemberUnban,
        Some(target_id),
        None,
        None,
    )
    .await;

    let event = BanDeleteEvent {
        server_id,
        user_id: target_id,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "BAN_DELETE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn kick_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, target_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::KICK_MEMBERS,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    if target_id == server.owner_id {
        return Err(ApiError::InvalidInput("Cannot kick the server owner".into()));
    }

    if target_id == user.user_id {
        return Err(ApiError::InvalidInput("Cannot kick yourself".into()));
    }

    queries::get_server_member(&state.db, server_id, target_id)
        .await?
        .ok_or(ApiError::NotFound("Member"))?;

    queries::remove_server_member(&state.db, server_id, target_id).await?;

    // Audit log
    let _ = queries::create_audit_log(
        &state.db,
        server_id,
        user.user_id,
        AuditAction::MemberKick,
        Some(target_id),
        None,
        None,
    )
    .await;

    let event = ServerMemberRemoveEvent {
        server_id,
        user_id: target_id,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "SERVER_MEMBER_REMOVE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn get_audit_log(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Query(query): Query<AuditLogQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Only users with VIEW_AUDIT_LOG can see it
    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::VIEW_AUDIT_LOG,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let limit = query.limit.unwrap_or(50).min(100);
    let entries = queries::get_audit_log(
        &state.db,
        server_id,
        query.action,
        query.user_id,
        query.before,
        limit,
    )
    .await?;

    // Enrich with user info
    let mut result = Vec::new();
    for entry in entries {
        let user_data = queries::get_user_by_id(&state.db, entry.user_id).await?;
        if let Some(u) = user_data {
            result.push(AuditLogEntryWithUser {
                entry,
                user: PublicUser::from(u),
            });
        }
    }

    Ok(Json(result))
}
