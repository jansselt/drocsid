use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::api::channels::resolve_channel_with_perm;
use crate::api::unfurl::fetch_unfurl;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::{
    ChannelLinkQuery, CreateChannelLinkRequest, UpdateChannelLinkRequest,
};
use crate::types::events::LinkCollectionUpdateEvent;
use crate::types::permissions::Permissions;

const MAX_LINKS_PER_CHANNEL: i64 = 200;
const MAX_TAGS: usize = 10;
const MAX_TAG_LENGTH: usize = 32;
const MAX_NOTE_LENGTH: usize = 500;
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/{channel_id}/links",
            get(list_links).post(add_link),
        )
        .route(
            "/{channel_id}/links/tags",
            get(list_tags),
        )
        .route(
            "/{channel_id}/links/{link_id}",
            axum::routing::patch(update_link).delete(remove_link),
        )
}

fn validate_tags(tags: &[String]) -> Result<Vec<String>, ApiError> {
    if tags.len() > MAX_TAGS {
        return Err(ApiError::InvalidInput(format!(
            "Maximum of {MAX_TAGS} tags per link"
        )));
    }
    let mut cleaned = Vec::with_capacity(tags.len());
    for tag in tags {
        let t = tag.trim().to_lowercase();
        if t.is_empty() {
            continue;
        }
        if t.len() > MAX_TAG_LENGTH {
            return Err(ApiError::InvalidInput(format!(
                "Tag must be {MAX_TAG_LENGTH} characters or fewer"
            )));
        }
        if !t
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        {
            return Err(ApiError::InvalidInput(
                "Tags may only contain letters, numbers, hyphens, and underscores".into(),
            ));
        }
        cleaned.push(t);
    }
    cleaned.sort();
    cleaned.dedup();
    Ok(cleaned)
}

fn validate_url(url: &str) -> Result<(), ApiError> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(ApiError::InvalidInput("URL must start with http:// or https://".into()));
    }
    if url.len() > 2048 {
        return Err(ApiError::InvalidInput("URL too long".into()));
    }
    Ok(())
}

/// POST /channels/{channel_id}/links
async fn add_link(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateChannelLinkRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let url = body.url.trim().to_string();
    validate_url(&url)?;

    if let Some(ref note) = body.note {
        if note.len() > MAX_NOTE_LENGTH {
            return Err(ApiError::InvalidInput(format!(
                "Note must be {MAX_NOTE_LENGTH} characters or fewer"
            )));
        }
    }

    let tags = validate_tags(&body.tags.unwrap_or_default())?;

    // Permission check
    let (channel, _, _) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
    )
    .await?;

    // Rate limit per channel
    let count = queries::count_channel_links(&state.db, channel_id).await?;
    if count >= MAX_LINKS_PER_CHANNEL {
        return Err(ApiError::InvalidInput(format!(
            "Maximum of {MAX_LINKS_PER_CHANNEL} links per channel"
        )));
    }

    // Auto-unfurl the URL (best effort)
    let unfurl = fetch_unfurl(&url, &state.config.instance.domain).await;

    let id = Uuid::now_v7();
    let link = queries::create_channel_link(
        &state.db,
        id,
        channel_id,
        user.user_id,
        &url,
        unfurl.as_ref().and_then(|u| u.title.as_deref()),
        unfurl.as_ref().and_then(|u| u.description.as_deref()),
        unfurl.as_ref().and_then(|u| u.image.as_deref()),
        unfurl.as_ref().and_then(|u| u.site_name.as_deref()),
        &tags,
        body.note.as_deref(),
    )
    .await?;

    // Broadcast update event
    let event = LinkCollectionUpdateEvent { channel_id };
    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "LINK_COLLECTION_UPDATE", &event, None);
    } else {
        if let Ok(members) = queries::get_dm_members(&state.db, channel_id).await {
            for member in &members {
                state
                    .gateway
                    .dispatch_to_user(member.id, "LINK_COLLECTION_UPDATE", &event);
            }
        }
    }

    Ok((axum::http::StatusCode::CREATED, Json(link)))
}

/// GET /channels/{channel_id}/links
async fn list_links(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<ChannelLinkQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let _ = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT).max(1);
    let links = queries::get_channel_links(
        &state.db,
        channel_id,
        query.tag.as_deref(),
        query.search.as_deref(),
        limit,
    )
    .await?;

    Ok(Json(links))
}

/// GET /channels/{channel_id}/links/tags
async fn list_tags(
    State(state): State<AppState>,
    user: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let _ = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let tags = queries::get_channel_link_tags(&state.db, channel_id).await?;
    Ok(Json(tags))
}

/// PATCH /channels/{channel_id}/links/{link_id}
async fn update_link(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, link_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateChannelLinkRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, _, owner_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let link = queries::get_channel_link_by_id(&state.db, link_id)
        .await?
        .ok_or(ApiError::NotFound("Link"))?;

    if link.channel_id != channel_id {
        return Err(ApiError::NotFound("Link"));
    }

    // Only the author or someone with MANAGE_MESSAGES can edit
    let is_author = link.added_by == user.user_id;
    let is_owner = owner_id == Some(user.user_id);
    if !is_author && !is_owner {
        // Check MANAGE_MESSAGES permission
        if let Some(sid) = channel.server_id {
            let has_perm = crate::services::permissions::has_channel_permission(
                &state.db,
                sid,
                channel_id,
                user.user_id,
                owner_id.unwrap_or_default(),
                Permissions::MANAGE_MESSAGES,
            )
            .await?;
            if !has_perm {
                return Err(ApiError::Forbidden);
            }
        } else {
            return Err(ApiError::Forbidden);
        }
    }

    let tags = match body.tags {
        Some(ref t) => Some(validate_tags(t)?),
        None => None,
    };

    if let Some(ref note) = body.note {
        if note.len() > MAX_NOTE_LENGTH {
            return Err(ApiError::InvalidInput(format!(
                "Note must be {MAX_NOTE_LENGTH} characters or fewer"
            )));
        }
    }

    let updated = queries::update_channel_link(
        &state.db,
        link_id,
        tags.as_deref(),
        body.note.as_deref(),
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => ApiError::NotFound("Link"),
        other => ApiError::Database(other),
    })?;

    // Broadcast update
    let event = LinkCollectionUpdateEvent { channel_id };
    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "LINK_COLLECTION_UPDATE", &event, None);
    }

    Ok(Json(updated))
}

/// DELETE /channels/{channel_id}/links/{link_id}
async fn remove_link(
    State(state): State<AppState>,
    user: AuthUser,
    Path((channel_id, link_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let (channel, _, owner_id) = resolve_channel_with_perm(
        &state,
        channel_id,
        user.user_id,
        Permissions::VIEW_CHANNEL,
    )
    .await?;

    let link = queries::get_channel_link_by_id(&state.db, link_id)
        .await?
        .ok_or(ApiError::NotFound("Link"))?;

    if link.channel_id != channel_id {
        return Err(ApiError::NotFound("Link"));
    }

    // Only the author or someone with MANAGE_MESSAGES can delete
    let is_author = link.added_by == user.user_id;
    let is_owner = owner_id == Some(user.user_id);
    if !is_author && !is_owner {
        if let Some(sid) = channel.server_id {
            let has_perm = crate::services::permissions::has_channel_permission(
                &state.db,
                sid,
                channel_id,
                user.user_id,
                owner_id.unwrap_or_default(),
                Permissions::MANAGE_MESSAGES,
            )
            .await?;
            if !has_perm {
                return Err(ApiError::Forbidden);
            }
        } else {
            return Err(ApiError::Forbidden);
        }
    }

    let deleted = queries::delete_channel_link(&state.db, link_id).await?;
    if !deleted {
        return Err(ApiError::NotFound("Link"));
    }

    // Broadcast update
    let event = LinkCollectionUpdateEvent { channel_id };
    if let Some(sid) = channel.server_id {
        state
            .gateway
            .broadcast_to_server(sid, "LINK_COLLECTION_UPDATE", &event, None);
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}
