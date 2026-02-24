use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::SearchQuery;

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(search_messages))
}

async fn search_messages(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    if query.q.trim().is_empty() {
        return Err(ApiError::InvalidInput("Search query cannot be empty".into()));
    }

    let limit = query.limit.unwrap_or(25).min(100);
    let offset = query.offset.unwrap_or(0);

    let results = queries::search_messages(
        &state.db,
        &query.q,
        query.channel_id,
        query.server_id,
        limit,
        offset,
    )
    .await?;

    Ok(Json(results))
}
