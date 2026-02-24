use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::{PublicUser, RelationshipType, RelationshipWithUser};
use crate::types::events::RelationshipUpdateEvent;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_relationships))
        .route(
            "/{target_id}",
            axum::routing::put(send_friend_request).delete(remove_relationship),
        )
        .route("/{target_id}/accept", axum::routing::post(accept_friend))
        .route("/{target_id}/block", axum::routing::put(block_user))
}

async fn list_relationships(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    let rels = queries::get_user_relationships(&state.db, user.user_id).await?;

    let mut result = Vec::with_capacity(rels.len());
    for rel in rels {
        let target = queries::get_user_by_id(&state.db, rel.target_id)
            .await?
            .ok_or(ApiError::NotFound("User"))?;
        result.push(RelationshipWithUser {
            relationship: rel,
            user: PublicUser::from(target),
        });
    }

    Ok(Json(result))
}

async fn send_friend_request(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    if target_id == user.user_id {
        return Err(ApiError::InvalidInput(
            "Cannot send friend request to yourself".into(),
        ));
    }

    // Target must exist
    queries::get_user_by_id(&state.db, target_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    // Check if already friends or blocked
    if let Some(existing) = queries::get_relationship(&state.db, user.user_id, target_id).await? {
        match existing.rel_type {
            RelationshipType::Friend => {
                return Err(ApiError::InvalidInput("Already friends".into()));
            }
            RelationshipType::Blocked => {
                return Err(ApiError::InvalidInput("User is blocked".into()));
            }
            RelationshipType::PendingOutgoing => {
                return Err(ApiError::InvalidInput("Request already sent".into()));
            }
            _ => {}
        }
    }

    // Check if target has blocked us
    if let Some(their_rel) = queries::get_relationship(&state.db, target_id, user.user_id).await? {
        if their_rel.rel_type == RelationshipType::Blocked {
            // Don't reveal that we're blocked
            return Err(ApiError::NotFound("User"));
        }
    }

    // Create outgoing on our side, incoming on their side
    let rel = queries::create_relationship(
        &state.db,
        user.user_id,
        target_id,
        RelationshipType::PendingOutgoing,
    )
    .await?;

    queries::create_relationship(
        &state.db,
        target_id,
        user.user_id,
        RelationshipType::PendingIncoming,
    )
    .await?;

    // Notify both users
    let our_event = RelationshipUpdateEvent {
        user_id: user.user_id,
        target_id,
        rel_type: Some("pending_outgoing".into()),
    };
    let their_event = RelationshipUpdateEvent {
        user_id: target_id,
        target_id: user.user_id,
        rel_type: Some("pending_incoming".into()),
    };

    state
        .gateway
        .dispatch_to_user(user.user_id, "RELATIONSHIP_UPDATE", &our_event);
    state
        .gateway
        .dispatch_to_user(target_id, "RELATIONSHIP_UPDATE", &their_event);

    let target_user = queries::get_user_by_id(&state.db, target_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    Ok(Json(RelationshipWithUser {
        relationship: rel,
        user: PublicUser::from(target_user),
    }))
}

async fn accept_friend(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    // Must have a pending incoming request
    let rel = queries::get_relationship(&state.db, user.user_id, target_id)
        .await?
        .ok_or(ApiError::NotFound("Relationship"))?;

    if rel.rel_type != RelationshipType::PendingIncoming {
        return Err(ApiError::InvalidInput("No pending request to accept".into()));
    }

    // Upgrade both sides to friend
    let updated = queries::create_relationship(
        &state.db,
        user.user_id,
        target_id,
        RelationshipType::Friend,
    )
    .await?;

    queries::create_relationship(&state.db, target_id, user.user_id, RelationshipType::Friend)
        .await?;

    let our_event = RelationshipUpdateEvent {
        user_id: user.user_id,
        target_id,
        rel_type: Some("friend".into()),
    };
    let their_event = RelationshipUpdateEvent {
        user_id: target_id,
        target_id: user.user_id,
        rel_type: Some("friend".into()),
    };

    state
        .gateway
        .dispatch_to_user(user.user_id, "RELATIONSHIP_UPDATE", &our_event);
    state
        .gateway
        .dispatch_to_user(target_id, "RELATIONSHIP_UPDATE", &their_event);

    let target_user = queries::get_user_by_id(&state.db, target_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    Ok(Json(RelationshipWithUser {
        relationship: updated,
        user: PublicUser::from(target_user),
    }))
}

async fn block_user(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    if target_id == user.user_id {
        return Err(ApiError::InvalidInput("Cannot block yourself".into()));
    }

    queries::get_user_by_id(&state.db, target_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    // Set to blocked on our side, remove their side entirely
    let rel = queries::create_relationship(
        &state.db,
        user.user_id,
        target_id,
        RelationshipType::Blocked,
    )
    .await?;

    queries::delete_relationship(&state.db, target_id, user.user_id).await?;

    let our_event = RelationshipUpdateEvent {
        user_id: user.user_id,
        target_id,
        rel_type: Some("blocked".into()),
    };
    let their_event = RelationshipUpdateEvent {
        user_id: target_id,
        target_id: user.user_id,
        rel_type: None, // removed
    };

    state
        .gateway
        .dispatch_to_user(user.user_id, "RELATIONSHIP_UPDATE", &our_event);
    state
        .gateway
        .dispatch_to_user(target_id, "RELATIONSHIP_UPDATE", &their_event);

    let target_user = queries::get_user_by_id(&state.db, target_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    Ok(Json(RelationshipWithUser {
        relationship: rel,
        user: PublicUser::from(target_user),
    }))
}

async fn remove_relationship(
    State(state): State<AppState>,
    user: AuthUser,
    Path(target_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    // Delete both sides
    queries::delete_relationship(&state.db, user.user_id, target_id).await?;
    queries::delete_relationship(&state.db, target_id, user.user_id).await?;

    let our_event = RelationshipUpdateEvent {
        user_id: user.user_id,
        target_id,
        rel_type: None,
    };
    let their_event = RelationshipUpdateEvent {
        user_id: target_id,
        target_id: user.user_id,
        rel_type: None,
    };

    state
        .gateway
        .dispatch_to_user(user.user_id, "RELATIONSHIP_UPDATE", &our_event);
    state
        .gateway
        .dispatch_to_user(target_id, "RELATIONSHIP_UPDATE", &their_event);

    Ok(axum::http::StatusCode::NO_CONTENT)
}
