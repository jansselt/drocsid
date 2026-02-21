use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::{BookmarkListQuery, CreateBookmarkRequest, UpdateBookmarkRequest};

const MAX_BOOKMARKS_PER_USER: i64 = 500;
const MAX_TAGS_PER_BOOKMARK: usize = 10;
const MAX_TAG_LENGTH: usize = 32;
const MAX_NOTE_LENGTH: usize = 500;
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_bookmarks))
        .route("/tags", get(list_tags))
        .route(
            "/{message_id}",
            axum::routing::put(add_bookmark)
                .patch(update_bookmark)
                .delete(remove_bookmark),
        )
}

fn validate_tags(tags: &[String]) -> Result<Vec<String>, ApiError> {
    if tags.len() > MAX_TAGS_PER_BOOKMARK {
        return Err(ApiError::InvalidInput(format!(
            "Maximum of {MAX_TAGS_PER_BOOKMARK} tags per bookmark"
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
        if !t.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
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

fn validate_note(note: Option<&str>) -> Result<(), ApiError> {
    if let Some(n) = note {
        if n.len() > MAX_NOTE_LENGTH {
            return Err(ApiError::InvalidInput(format!(
                "Note must be {MAX_NOTE_LENGTH} characters or fewer"
            )));
        }
    }
    Ok(())
}

/// GET /users/@me/bookmarks
async fn list_bookmarks(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<BookmarkListQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT).max(1);
    let bookmarks = queries::get_bookmarks_for_user(
        &state.db,
        user.user_id,
        query.tag.as_deref(),
        query.search.as_deref(),
        query.before,
        limit,
    )
    .await?;
    Ok(Json(bookmarks))
}

/// GET /users/@me/bookmarks/tags
async fn list_tags(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    let tags = queries::get_user_bookmark_tags(&state.db, user.user_id).await?;
    Ok(Json(tags))
}

/// PUT /users/@me/bookmarks/:message_id
async fn add_bookmark(
    State(state): State<AppState>,
    user: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(body): Json<CreateBookmarkRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify message exists
    let _msg = queries::get_message_by_id(&state.db, message_id)
        .await?
        .ok_or(ApiError::NotFound("Message"))?;

    // Validate tags and note
    let tags = validate_tags(&body.tags.unwrap_or_default())?;
    validate_note(body.note.as_deref())?;

    // Check bookmark limit
    let count = queries::count_user_bookmarks(&state.db, user.user_id).await?;
    if count >= MAX_BOOKMARKS_PER_USER {
        return Err(ApiError::InvalidInput(format!(
            "Maximum of {MAX_BOOKMARKS_PER_USER} bookmarks"
        )));
    }

    let bookmark =
        queries::upsert_bookmark(&state.db, user.user_id, message_id, &tags, body.note.as_deref())
            .await?;

    Ok((axum::http::StatusCode::CREATED, Json(bookmark)))
}

/// PATCH /users/@me/bookmarks/:message_id
async fn update_bookmark(
    State(state): State<AppState>,
    user: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(body): Json<UpdateBookmarkRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let tags = match body.tags {
        Some(ref t) => Some(validate_tags(t)?),
        None => None,
    };
    validate_note(body.note.as_deref())?;

    let bookmark = queries::update_bookmark(
        &state.db,
        user.user_id,
        message_id,
        tags.as_deref(),
        body.note.as_deref(),
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => ApiError::NotFound("Bookmark"),
        other => ApiError::Database(other),
    })?;

    Ok(Json(bookmark))
}

/// DELETE /users/@me/bookmarks/:message_id
async fn remove_bookmark(
    State(state): State<AppState>,
    user: AuthUser,
    Path(message_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let deleted = queries::delete_bookmark(&state.db, user.user_id, message_id).await?;
    if !deleted {
        return Err(ApiError::NotFound("Bookmark"));
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}
