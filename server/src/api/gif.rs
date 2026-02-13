use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::api::auth::AuthUser;
use crate::error::ApiError;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/gif/search", get(gif_search))
        .route("/gif/trending", get(gif_trending))
}

#[derive(Debug, Deserialize)]
struct GifSearchQuery {
    q: String,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct GifTrendingQuery {
    limit: Option<u32>,
    offset: Option<u32>,
}

/// Proxy GIF search — keeps API key server-side
async fn gif_search(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<GifSearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let gif_config = state
        .config
        .gif
        .as_ref()
        .ok_or_else(|| ApiError::InvalidInput("GIF integration not configured".into()))?;

    if gif_config.api_key.is_empty() {
        return Err(ApiError::InvalidInput(
            "GIF API key not configured".into(),
        ));
    }

    let limit = query.limit.unwrap_or(25).min(50);
    let offset = query.offset.unwrap_or(0);
    let rating = gif_config.rating.as_deref().unwrap_or("pg-13");

    match gif_config.provider.as_str() {
        "giphy" => {
            let url = format!(
                "https://api.giphy.com/v1/gifs/search?api_key={}&q={}&limit={}&offset={}&rating={}&lang=en",
                gif_config.api_key,
                urlencoding::encode(&query.q),
                limit,
                offset,
                rating,
            );

            let resp = reqwest::get(&url)
                .await
                .map_err(|e| ApiError::Internal(e.into()))?;

            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| ApiError::Internal(e.into()))?;

            Ok(Json(transform_giphy_response(&body)))
        }
        _ => Err(ApiError::InvalidInput(format!(
            "Unknown GIF provider: {}",
            gif_config.provider
        ))),
    }
}

/// Proxy GIF trending
async fn gif_trending(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<GifTrendingQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let gif_config = state
        .config
        .gif
        .as_ref()
        .ok_or_else(|| ApiError::InvalidInput("GIF integration not configured".into()))?;

    if gif_config.api_key.is_empty() {
        return Err(ApiError::InvalidInput(
            "GIF API key not configured".into(),
        ));
    }

    let limit = query.limit.unwrap_or(25).min(50);
    let offset = query.offset.unwrap_or(0);
    let rating = gif_config.rating.as_deref().unwrap_or("pg-13");

    match gif_config.provider.as_str() {
        "giphy" => {
            let url = format!(
                "https://api.giphy.com/v1/gifs/trending?api_key={}&limit={}&offset={}&rating={}",
                gif_config.api_key, limit, offset, rating,
            );

            let resp = reqwest::get(&url)
                .await
                .map_err(|e| ApiError::Internal(e.into()))?;

            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| ApiError::Internal(e.into()))?;

            Ok(Json(transform_giphy_response(&body)))
        }
        _ => Err(ApiError::InvalidInput(format!(
            "Unknown GIF provider: {}",
            gif_config.provider
        ))),
    }
}

/// Transform Giphy response into a provider-agnostic format
fn transform_giphy_response(body: &serde_json::Value) -> serde_json::Value {
    let gifs = body["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|gif| {
                    serde_json::json!({
                        "id": gif["id"],
                        "title": gif["title"],
                        "url": gif["images"]["original"]["url"],
                        "mp4": gif["images"]["original"].get("mp4"),
                        "width": gif["images"]["original"]["width"].as_str().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0),
                        "height": gif["images"]["original"]["height"].as_str().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0),
                        "preview_url": gif["images"]["fixed_width"]["url"],
                        "preview_width": gif["images"]["fixed_width"]["width"].as_str().and_then(|s| s.parse::<u32>().ok()).unwrap_or(200),
                        "preview_height": gif["images"]["fixed_width"]["height"].as_str().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let total = body["pagination"]["total_count"]
        .as_u64()
        .unwrap_or(0);

    serde_json::json!({
        "gifs": gifs,
        "total": total,
        "provider": "giphy",
    })
}
