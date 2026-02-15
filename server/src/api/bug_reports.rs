use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/bug-reports", post(create_bug_report))
}

#[derive(Deserialize)]
struct CreateBugReportRequest {
    title: String,
    description: Option<String>,
    system_info: Option<String>,
}

async fn create_bug_report(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateBugReportRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let github = state
        .config
        .github
        .as_ref()
        .ok_or_else(|| ApiError::InvalidInput("Bug reporting not configured".into()))?;

    let reporter = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    let mut issue_body = String::new();
    if let Some(desc) = &body.description {
        if !desc.is_empty() {
            issue_body.push_str(desc);
            issue_body.push_str("\n\n");
        }
    }
    issue_body.push_str("---\n");
    issue_body.push_str(&format!("**Reported by:** {}\n", reporter.username));
    if let Some(info) = &body.system_info {
        issue_body.push_str(info);
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "https://api.github.com/repos/{}/issues",
            github.repo
        ))
        .header("Authorization", format!("Bearer {}", github.token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "drocsid-server")
        .json(&serde_json::json!({
            "title": body.title,
            "body": issue_body,
            "labels": ["bug", "user-reported"]
        }))
        .send()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(ApiError::Internal(anyhow::anyhow!(
            "GitHub API error {}: {}",
            status,
            text
        )));
    }

    let gh_issue: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(serde_json::json!({
        "number": gh_issue["number"],
        "url": gh_issue["html_url"],
    })))
}
