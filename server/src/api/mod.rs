pub mod auth;
pub mod bans;
pub mod channels;
pub mod dms;
pub mod gif;
pub mod invites;
pub mod relationships;
pub mod roles;
pub mod search;
pub mod servers;
pub mod voice;
pub mod webhooks;

use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;

use crate::gateway::connection::handle_connection;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/api/v1", api_routes())
        .route("/gateway", get(gateway_upgrade))
}

fn api_routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health_check))
        .nest("/auth", auth::routes())
        .nest("/users", user_routes())
        .nest(
            "/servers",
            servers::routes()
                .merge(roles::routes())
                .merge(invites::routes())
                .merge(bans::routes()),
        )
        .nest(
            "/channels",
            channels::routes()
                .merge(voice::routes())
                .merge(webhooks::routes()),
        )
        .nest("/dms", dms::routes())
        .nest("/relationships", relationships::routes())
        .nest("/search", search::routes())
        .merge(gif::routes())
        .merge(invites::resolve_routes())
        .merge(webhooks::execute_routes())
}

fn user_routes() -> Router<AppState> {
    Router::new()
        .route("/@me", get(get_me).patch(update_me))
        .route("/@me/avatar", post(request_avatar_upload))
        .route("/search", get(search_users))
}

async fn get_me(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;

    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(crate::error::ApiError::NotFound("User"))?;

    // Return full User (password_hash is #[serde(skip_serializing)]) so client gets theme_preference
    Ok(axum::Json(user_data))
}

#[derive(serde::Deserialize)]
struct UpdateUserRequest {
    status: Option<String>,
    custom_status: Option<String>,
    display_name: Option<String>,
    bio: Option<String>,
    avatar_url: Option<String>,
    theme_preference: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
    axum::Json(body): axum::Json<UpdateUserRequest>,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;

    if let Some(ref status) = body.status {
        let valid = matches!(status.as_str(), "online" | "idle" | "dnd" | "offline");
        if !valid {
            return Err(crate::error::ApiError::InvalidInput(
                "Status must be one of: online, idle, dnd, offline".into(),
            ));
        }
        queries::update_user_status(&state.db, user.user_id, status).await?;
        state.gateway.update_presence(user.user_id, status);
    }

    if let Some(ref custom_status) = body.custom_status {
        queries::update_user_custom_status(&state.db, user.user_id, Some(custom_status)).await?;
    }

    // Profile fields
    if body.display_name.is_some() || body.bio.is_some() || body.avatar_url.is_some() || body.theme_preference.is_some() {
        if let Some(ref theme) = body.theme_preference {
            let valid = matches!(theme.as_str(), "dark" | "light" | "midnight" | "forest" | "rose");
            if !valid {
                return Err(crate::error::ApiError::InvalidInput(
                    "Theme must be one of: dark, light, midnight, forest, rose".into(),
                ));
            }
        }
        if let Some(ref name) = body.display_name {
            if name.len() > 32 {
                return Err(crate::error::ApiError::InvalidInput(
                    "Display name must be 32 characters or fewer".into(),
                ));
            }
        }
        if let Some(ref bio) = body.bio {
            if bio.len() > 190 {
                return Err(crate::error::ApiError::InvalidInput(
                    "Bio must be 190 characters or fewer".into(),
                ));
            }
        }

        queries::update_user_profile(
            &state.db,
            user.user_id,
            body.display_name.as_deref(),
            body.bio.as_deref(),
            body.avatar_url.as_deref(),
            body.theme_preference.as_deref(),
        )
        .await?;
    }

    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(crate::error::ApiError::NotFound("User"))?;

    Ok(axum::Json(user_data))
}

async fn request_avatar_upload(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
    multipart: axum::extract::Multipart,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    let s3 = state
        .s3
        .as_ref()
        .ok_or_else(|| crate::error::ApiError::InvalidInput("File uploads not configured".into()))?;
    let s3_config = state
        .config
        .s3
        .as_ref()
        .ok_or_else(|| crate::error::ApiError::InvalidInput("File uploads not configured".into()))?;

    let (filename, content_type, data) =
        crate::services::uploads::extract_multipart_file(multipart, 5 * 1024 * 1024).await?;

    if !content_type.starts_with("image/") {
        return Err(crate::error::ApiError::InvalidInput(
            "Avatar must be an image".into(),
        ));
    }

    let object_key = format!("avatars/users/{}/{}", user.user_id, filename);
    let file_url =
        crate::services::uploads::upload_to_s3(s3, s3_config, &object_key, &content_type, data)
            .await?;

    Ok(axum::Json(serde_json::json!({ "file_url": file_url })))
}

#[derive(serde::Deserialize)]
struct SearchUsersQuery {
    q: String,
}

async fn search_users(
    State(state): State<AppState>,
    _user: crate::api::auth::AuthUser,
    axum::extract::Query(params): axum::extract::Query<SearchUsersQuery>,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;
    use crate::types::entities::PublicUser;

    let q = params.q.trim();
    if q.is_empty() || q.len() > 32 {
        return Ok(axum::Json(Vec::<PublicUser>::new()));
    }

    let users = queries::search_users_by_username(&state.db, q, 20).await?;
    let public: Vec<PublicUser> = users.into_iter().map(PublicUser::from).collect();
    Ok(axum::Json(public))
}

async fn health_check() -> impl IntoResponse {
    axum::Json(serde_json::json!({ "status": "ok" }))
}

async fn gateway_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_connection(state, socket))
}
