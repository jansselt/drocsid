use axum::extract::{FromRef, State};
use axum::http::request::Parts;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use uuid::Uuid;

use crate::error::ApiError;
use crate::services::auth as auth_service;
use crate::state::AppState;
use crate::types::entities::{LoginRequest, RefreshRequest, RegisterRequest};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh))
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let response =
        auth_service::register(&state.db, &state.config, &body.username, &body.email, &body.password, body.invite_code.as_deref())
            .await?;

    Ok(Json(response))
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let response =
        auth_service::login(&state.db, &state.config, &body.email, &body.password).await?;

    Ok(Json(response))
}

async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let response =
        auth_service::refresh(&state.db, &state.config, &body.refresh_token).await?;

    Ok(Json(response))
}

// ── Auth Extractor ─────────────────────────────────────

pub struct AuthUser {
    pub user_id: Uuid,
}

impl<S> axum::extract::FromRequestParts<S> for AuthUser
where
    AppState: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        async move {
            let app_state = <AppState as FromRef<S>>::from_ref(state);

            let auth_header = parts
                .headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .ok_or(ApiError::Unauthorized)?;

            let token = auth_header
                .strip_prefix("Bearer ")
                .ok_or(ApiError::Unauthorized)?;

            let user_id = auth_service::validate_access_token(&app_state.config, token)?;

            Ok(AuthUser { user_id })
        }
    }
}

