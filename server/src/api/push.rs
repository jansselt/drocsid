use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/vapid-key", get(get_vapid_key))
        .route("/subscribe", post(subscribe))
        .route("/unsubscribe", post(unsubscribe))
}

// ── GET /push/vapid-key ──────────────────────────────

#[derive(Serialize)]
struct VapidKeyResponse {
    public_key: Option<String>,
}

async fn get_vapid_key(State(state): State<AppState>) -> impl IntoResponse {
    let public_key = state
        .push
        .as_ref()
        .map(|p| p.vapid_public_key().to_string());
    Json(VapidKeyResponse { public_key })
}

// ── POST /push/subscribe ─────────────────────────────

#[derive(Deserialize)]
struct SubscribeRequest {
    endpoint: String,
    keys: SubscribeKeys,
}

#[derive(Deserialize)]
struct SubscribeKeys {
    p256dh: String,
    auth: String,
}

async fn subscribe(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<SubscribeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if state.push.is_none() {
        return Err(ApiError::InvalidInput(
            "Push notifications not configured".into(),
        ));
    }

    let sub = queries::upsert_push_subscription(
        &state.db,
        user.user_id,
        &body.endpoint,
        &body.keys.p256dh,
        &body.keys.auth,
        None,
    )
    .await?;

    Ok(Json(serde_json::json!({ "id": sub.id })))
}

// ── POST /push/unsubscribe ───────────────────────────

#[derive(Deserialize)]
struct UnsubscribeRequest {
    endpoint: String,
}

async fn unsubscribe(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<UnsubscribeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let removed = queries::delete_push_subscription(&state.db, user.user_id, &body.endpoint)
        .await?;

    Ok(Json(serde_json::json!({ "removed": removed })))
}
