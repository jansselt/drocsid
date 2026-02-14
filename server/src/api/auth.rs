use axum::extract::{FromRef, State};
use axum::http::request::Parts;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use uuid::Uuid;

use crate::db::queries;
use crate::error::ApiError;
use crate::services::auth as auth_service;
use crate::state::AppState;
use crate::types::entities::{LoginRequest, RefreshRequest, RegisterRequest};
use crate::types::events::ServerMemberAddEvent;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let (response, joined_server_id) =
        auth_service::register(&state.db, &state.config, &body.username, &body.email, &body.password, body.invite_code.as_deref())
            .await?;

    // If user was auto-joined to a server via invite, notify existing members
    if let Some(server_id) = joined_server_id {
        let member = queries::get_server_member(&state.db, server_id, response.user.id)
            .await?;
        if let Some(member) = member {
            let event = ServerMemberAddEvent {
                server_id,
                member,
                user: response.user.clone(),
            };
            state
                .gateway
                .broadcast_to_server(server_id, "SERVER_MEMBER_ADD", &event, None);
        }
    }

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

// ── Password Reset ────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct ForgotPasswordRequest {
    email: String,
}

#[derive(Debug, serde::Deserialize)]
struct ResetPasswordRequest {
    token: String,
    new_password: String,
}

async fn forgot_password(
    State(state): State<AppState>,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Rate limit by email via Redis
    let mut redis = state.redis.clone();
    let rate_key = format!("pw_reset:{}", body.email.to_lowercase());
    let count: Option<i64> = redis::cmd("GET")
        .arg(&rate_key)
        .query_async(&mut redis)
        .await
        .unwrap_or(None);

    if count.unwrap_or(0) >= 3 {
        return Err(ApiError::RateLimited {
            retry_after_ms: 900_000,
        });
    }

    // Increment rate limit counter with 15-minute TTL
    redis::pipe()
        .cmd("INCR")
        .arg(&rate_key)
        .cmd("EXPIRE")
        .arg(&rate_key)
        .arg(900)
        .query_async::<()>(&mut redis)
        .await
        .ok();

    auth_service::request_password_reset(&state.db, &state.config, &body.email).await?;

    Ok(Json(serde_json::json!({
        "message": "If an account with that email exists, a reset link has been sent."
    })))
}

async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<impl IntoResponse, ApiError> {
    auth_service::complete_password_reset(&state.db, &body.token, &body.new_password).await?;

    Ok(Json(serde_json::json!({
        "message": "Password has been reset successfully."
    })))
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

