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
use crate::types::entities::{CreateRoleRequest, RoleAssignment, UpdateRoleRequest};
use crate::types::events::{MemberRoleUpdateEvent, RoleCreateEvent, RoleDeleteEvent, RoleUpdateEvent};
use crate::types::permissions::Permissions;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/{server_id}/roles", get(list_roles).post(create_role))
        .route(
            "/{server_id}/roles/{role_id}",
            get(get_role)
                .patch(update_role)
                .delete(delete_role),
        )
        .route(
            "/{server_id}/members/{user_id}/roles",
            get(get_member_roles).put(assign_role),
        )
        .route(
            "/{server_id}/members/{user_id}/roles/{role_id}",
            post(assign_role_by_path).delete(remove_role),
        )
}

async fn list_roles(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify membership
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let roles = queries::get_server_roles(&state.db, server_id).await?;
    Ok(Json(roles))
}

async fn get_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let role = queries::get_role_by_id(&state.db, role_id)
        .await?
        .ok_or(ApiError::NotFound("Role"))?;

    if role.server_id != server_id {
        return Err(ApiError::NotFound("Role"));
    }

    Ok(Json(role))
}

async fn create_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateRoleRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    // Check MANAGE_ROLES permission
    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    if body.name.is_empty() || body.name.len() > 100 {
        return Err(ApiError::InvalidInput(
            "Role name must be 1-100 characters".into(),
        ));
    }

    let position = queries::get_next_role_position(&state.db, server_id).await?;
    let role_id = Uuid::now_v7();

    queries::create_role(
        &state.db,
        role_id,
        server_id,
        &body.name,
        body.permissions.unwrap_or(0),
        false,
        position,
    )
    .await?;

    // Apply optional fields (color, hoist, mentionable)
    let role = queries::update_role(
        &state.db,
        role_id,
        None,
        body.color,
        body.hoist,
        None,
        None,
        body.mentionable,
    )
    .await?;

    let event = RoleCreateEvent {
        server_id,
        role: role.clone(),
    };
    state
        .gateway
        .broadcast_to_server(server_id, "ROLE_CREATE", &event, None);

    Ok(Json(role))
}

async fn update_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRoleRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let existing = queries::get_role_by_id(&state.db, role_id)
        .await?
        .ok_or(ApiError::NotFound("Role"))?;

    if existing.server_id != server_id {
        return Err(ApiError::NotFound("Role"));
    }

    if let Some(ref name) = body.name {
        if name.is_empty() || name.len() > 100 {
            return Err(ApiError::InvalidInput(
                "Role name must be 1-100 characters".into(),
            ));
        }
    }

    let role = queries::update_role(
        &state.db,
        role_id,
        body.name.as_deref(),
        body.color,
        body.hoist,
        body.position,
        body.permissions,
        body.mentionable,
    )
    .await?;

    let event = RoleUpdateEvent {
        server_id,
        role: role.clone(),
    };
    state
        .gateway
        .broadcast_to_server(server_id, "ROLE_UPDATE", &event, None);

    Ok(Json(role))
}

async fn delete_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    let role = queries::get_role_by_id(&state.db, role_id)
        .await?
        .ok_or(ApiError::NotFound("Role"))?;

    if role.server_id != server_id {
        return Err(ApiError::NotFound("Role"));
    }

    if role.is_default {
        return Err(ApiError::InvalidInput(
            "Cannot delete the @everyone role".into(),
        ));
    }

    queries::delete_role(&state.db, role_id).await?;

    let event = RoleDeleteEvent {
        server_id,
        role_id,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "ROLE_DELETE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn get_member_roles(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    queries::get_server_member(&state.db, server_id, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    let roles = queries::get_member_roles(&state.db, server_id, target_user_id).await?;
    Ok(Json(roles))
}

async fn assign_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<RoleAssignment>,
) -> Result<impl IntoResponse, ApiError> {
    assign_role_inner(state, user.user_id, server_id, target_user_id, body.role_id).await
}

async fn assign_role_by_path(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, target_user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    assign_role_inner(state, user.user_id, server_id, target_user_id, role_id).await
}

async fn assign_role_inner(
    state: AppState,
    user_id: Uuid,
    server_id: Uuid,
    target_user_id: Uuid,
    role_id: Uuid,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    // Verify target is a member
    queries::get_server_member(&state.db, server_id, target_user_id)
        .await?
        .ok_or(ApiError::NotFound("Member"))?;

    // Verify role exists and belongs to server
    let role = queries::get_role_by_id(&state.db, role_id)
        .await?
        .ok_or(ApiError::NotFound("Role"))?;

    if role.server_id != server_id {
        return Err(ApiError::NotFound("Role"));
    }

    if role.is_default {
        return Err(ApiError::InvalidInput(
            "Cannot assign the @everyone role".into(),
        ));
    }

    queries::assign_member_role(&state.db, server_id, target_user_id, role_id).await?;

    // Broadcast updated role list
    let role_ids = queries::get_member_role_ids(&state.db, server_id, target_user_id).await?;
    let event = MemberRoleUpdateEvent {
        server_id,
        user_id: target_user_id,
        role_ids,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "MEMBER_ROLE_UPDATE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn remove_role(
    State(state): State<AppState>,
    user: AuthUser,
    Path((server_id, target_user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let server = queries::get_server_by_id(&state.db, server_id)
        .await?
        .ok_or(ApiError::NotFound("Server"))?;

    if !perm_service::has_server_permission(
        &state.db,
        server_id,
        user.user_id,
        server.owner_id,
        Permissions::MANAGE_ROLES,
    )
    .await?
    {
        return Err(ApiError::Forbidden);
    }

    queries::remove_member_role(&state.db, server_id, target_user_id, role_id).await?;

    let role_ids = queries::get_member_role_ids(&state.db, server_id, target_user_id).await?;
    let event = MemberRoleUpdateEvent {
        server_id,
        user_id: target_user_id,
        role_ids,
    };
    state
        .gateway
        .broadcast_to_server(server_id, "MEMBER_ROLE_UPDATE", &event, None);

    Ok(axum::http::StatusCode::NO_CONTENT)
}
