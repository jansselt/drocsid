use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Authentication required")]
    Unauthorized,

    #[error("Insufficient permissions")]
    Forbidden,

    #[error("{0} not found")]
    NotFound(&'static str),

    #[error("{0}")]
    InvalidInput(String),

    #[error("Rate limited")]
    RateLimited { retry_after_ms: u64 },

    #[error(transparent)]
    Database(#[from] sqlx::Error),

    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, 40001, self.to_string()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, 40003, self.to_string()),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, 40004, self.to_string()),
            ApiError::InvalidInput(_) => (StatusCode::BAD_REQUEST, 40000, self.to_string()),
            ApiError::RateLimited { retry_after_ms } => {
                let body = json!({
                    "error": "Rate limited",
                    "code": 42900,
                    "retry_after_ms": retry_after_ms,
                });
                return (StatusCode::TOO_MANY_REQUESTS, Json(body)).into_response();
            }
            ApiError::Database(e) => {
                tracing::error!(error = %e, "Database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    50000,
                    "Internal server error".into(),
                )
            }
            ApiError::Internal(e) => {
                tracing::error!(error = %e, "Internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    50000,
                    "Internal server error".into(),
                )
            }
        };

        let body = json!({
            "error": message,
            "code": code,
        });

        (status, Json(body)).into_response()
    }
}
