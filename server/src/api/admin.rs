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
use crate::state::AppState;
use crate::types::entities::CreateRegistrationCodeRequest;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/registration-codes",
            get(list_registration_codes).post(create_registration_code),
        )
        .route(
            "/registration-codes/{code}",
            axum::routing::delete(delete_registration_code),
        )
}

fn generate_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::rng();
    (0..8)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

async fn require_admin(state: &AppState, user_id: Uuid) -> Result<(), ApiError> {
    let user = queries::get_user_by_id(&state.db, user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;
    if !user.is_admin {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

async fn list_registration_codes(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;
    let codes = queries::get_all_registration_codes(&state.db).await?;
    Ok(Json(codes))
}

async fn create_registration_code(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateRegistrationCodeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let id = Uuid::now_v7();
    let code = generate_code();
    let expires_at = body
        .max_age_secs
        .map(|secs| Utc::now() + chrono::Duration::seconds(secs));

    let reg_code =
        queries::create_registration_code(&state.db, id, user.user_id, &code, body.max_uses, expires_at)
            .await?;

    Ok(Json(reg_code))
}

async fn delete_registration_code(
    State(state): State<AppState>,
    user: AuthUser,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;
    queries::delete_registration_code(&state.db, &code).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}
