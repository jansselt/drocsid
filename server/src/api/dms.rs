use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::{ChannelType, CreateDmRequest, CreateGroupDmRequest, PublicUser};
use crate::types::events::DmChannelCreateEvent;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_dm_channels).post(create_dm))
        .route("/group", axum::routing::post(create_group_dm))
        .route("/{channel_id}", axum::routing::delete(close_dm))
        .route("/{channel_id}/recipients", get(get_dm_recipients))
}

async fn list_dm_channels(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    let channels = queries::get_dm_channels(&state.db, user.user_id).await?;
    Ok(Json(channels))
}

async fn create_dm(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateDmRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if body.recipient_id == user.user_id {
        return Err(ApiError::InvalidInput("Cannot DM yourself".into()));
    }

    // Check recipient exists
    queries::get_user_by_id(&state.db, body.recipient_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    // Check if DM already exists
    if let Some(existing) = queries::find_existing_dm(&state.db, user.user_id, body.recipient_id).await? {
        return Ok(Json(existing));
    }

    // Create DM channel
    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    let channel_id = Uuid::now_v7();
    let channel = queries::create_channel(
        &state.db,
        channel_id,
        instance_id,
        None, // no server
        ChannelType::Dm,
        None,
        None,
        None,
        0,
    )
    .await?;

    // Add both users as DM members
    queries::add_dm_member(&state.db, channel_id, user.user_id).await?;
    queries::add_dm_member(&state.db, channel_id, body.recipient_id).await?;

    // Notify both users via gateway
    let me = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;
    let recipient = queries::get_user_by_id(&state.db, body.recipient_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    let event = DmChannelCreateEvent {
        channel: channel.clone(),
        recipients: vec![PublicUser::from(me), PublicUser::from(recipient)],
    };

    state.gateway.dispatch_to_user(user.user_id, "DM_CHANNEL_CREATE", &event);
    state.gateway.dispatch_to_user(body.recipient_id, "DM_CHANNEL_CREATE", &event);

    Ok(Json(channel))
}

async fn create_group_dm(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateGroupDmRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if body.recipient_ids.is_empty() || body.recipient_ids.len() > 9 {
        return Err(ApiError::InvalidInput(
            "Group DM requires 1-9 recipients".into(),
        ));
    }

    let instance_id =
        queries::ensure_local_instance(&state.db, &state.config.instance.domain).await?;

    let channel_id = Uuid::now_v7();
    let channel = queries::create_channel(
        &state.db,
        channel_id,
        instance_id,
        None,
        ChannelType::GroupDm,
        body.name.as_deref(),
        None,
        None,
        0,
    )
    .await?;

    // Add creator
    queries::add_dm_member(&state.db, channel_id, user.user_id).await?;

    // Add recipients
    let mut recipients = vec![];
    let me = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;
    recipients.push(PublicUser::from(me));

    for rid in &body.recipient_ids {
        let u = queries::get_user_by_id(&state.db, *rid)
            .await?
            .ok_or(ApiError::NotFound("User"))?;
        queries::add_dm_member(&state.db, channel_id, *rid).await?;
        recipients.push(PublicUser::from(u));
    }

    let event = DmChannelCreateEvent {
        channel: channel.clone(),
        recipients: recipients.clone(),
    };

    // Notify all members
    state.gateway.dispatch_to_user(user.user_id, "DM_CHANNEL_CREATE", &event);
    for rid in &body.recipient_ids {
        state.gateway.dispatch_to_user(*rid, "DM_CHANNEL_CREATE", &event);
    }

    Ok(Json(channel))
}

async fn close_dm(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    queries::close_dm(&state.db, channel_id, user.user_id).await?;
    Ok(Json(serde_json::json!({ "closed": true })))
}

async fn get_dm_recipients(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify user is a member of this DM
    let members = queries::get_dm_members(&state.db, channel_id).await?;
    if !members.iter().any(|m| m.id == user.user_id) {
        return Err(ApiError::NotFound("Channel"));
    }

    let public: Vec<PublicUser> = members.into_iter().map(PublicUser::from).collect();
    Ok(Json(public))
}
