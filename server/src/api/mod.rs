pub mod admin;
pub mod auth;
pub mod bans;
pub mod bookmarks;
pub mod bug_reports;
pub mod channels;
pub mod dms;
pub mod gif;
pub mod invites;
pub mod relationships;
pub mod roles;
pub mod search;
pub mod servers;
pub mod soundboard;
pub mod themes;
pub mod unfurl;
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
                .merge(bans::routes())
                .merge(soundboard::routes()),
        )
        .nest(
            "/channels",
            channels::routes()
                .merge(voice::routes())
                .merge(webhooks::routes()),
        )
        .nest("/admin", admin::routes())
        .nest("/dms", dms::routes())
        .nest("/relationships", relationships::routes())
        .nest("/search", search::routes())
        .merge(gif::routes())
        .merge(invites::resolve_routes())
        .merge(webhooks::execute_routes())
        .merge(bug_reports::routes())
        .merge(unfurl::routes())
}

fn user_routes() -> Router<AppState> {
    Router::new()
        .route("/@me", get(get_me).patch(update_me).delete(delete_me))
        .route("/@me/avatar", post(request_avatar_upload))
        .route(
            "/@me/notification-preferences",
            get(get_notification_prefs).put(set_notification_pref),
        )
        .nest("/@me/themes", themes::routes())
        .nest("/@me/bookmarks", bookmarks::routes())
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
    timezone: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
    axum::Json(body): axum::Json<UpdateUserRequest>,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;

    if let Some(ref status) = body.status {
        let valid = matches!(status.as_str(), "online" | "idle" | "dnd" | "invisible" | "offline");
        if !valid {
            return Err(crate::error::ApiError::InvalidInput(
                "Status must be one of: online, idle, dnd, invisible, offline".into(),
            ));
        }
        queries::update_user_status(&state.db, user.user_id, status).await?;
        state.gateway.update_presence(user.user_id, status);
    }

    if let Some(ref custom_status) = body.custom_status {
        let cs = if custom_status.is_empty() { None } else { Some(custom_status.as_str()) };
        queries::update_user_custom_status(&state.db, user.user_id, cs).await?;
        state.gateway.update_custom_status(user.user_id, cs.map(|s| s.to_string()));
    }

    // Profile fields
    if body.display_name.is_some() || body.bio.is_some() || body.avatar_url.is_some() || body.theme_preference.is_some() || body.timezone.is_some() {
        if let Some(ref theme) = body.theme_preference {
            if let Some(id_str) = theme.strip_prefix("custom:") {
                let theme_id = uuid::Uuid::parse_str(id_str).map_err(|_| {
                    crate::error::ApiError::InvalidInput("Invalid custom theme ID".into())
                })?;
                let custom_theme =
                    queries::get_custom_theme_by_id(&state.db, theme_id)
                        .await?
                        .ok_or(crate::error::ApiError::NotFound("Custom theme"))?;
                if custom_theme.user_id != user.user_id {
                    return Err(crate::error::ApiError::NotFound("Custom theme"));
                }
            } else {
                let valid = matches!(
                    theme.as_str(),
                    "dark" | "light" | "midnight" | "forest" | "rose"
                        | "solarized-dark" | "solarized-light" | "dracula" | "monokai"
                        | "gruvbox" | "nord" | "catppuccin" | "tokyo-night" | "terminal"
                );
                if !valid {
                    return Err(crate::error::ApiError::InvalidInput(
                        "Invalid theme name".into(),
                    ));
                }
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
        if let Some(ref tz) = body.timezone {
            if tz.len() > 64 {
                return Err(crate::error::ApiError::InvalidInput(
                    "Invalid timezone".into(),
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
            body.timezone.as_deref(),
        )
        .await?;
    }

    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(crate::error::ApiError::NotFound("User"))?;

    Ok(axum::Json(user_data))
}

#[derive(serde::Deserialize)]
struct DeleteAccountRequest {
    password: String,
}

async fn delete_me(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
    axum::Json(body): axum::Json<DeleteAccountRequest>,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;

    // Verify password
    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(crate::error::ApiError::NotFound("User"))?;
    let password_hash = user_data
        .password_hash
        .as_ref()
        .ok_or(crate::error::ApiError::Unauthorized)?;

    use argon2::{Argon2, PasswordHash, PasswordVerifier};
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| anyhow::anyhow!("Invalid hash: {}", e))?;
    Argon2::default()
        .verify_password(body.password.as_bytes(), &parsed_hash)
        .map_err(|_| crate::error::ApiError::InvalidInput("Incorrect password".into()))?;

    // Delete all servers owned by this user
    let servers = queries::get_user_servers(&state.db, user.user_id).await?;
    for server in &servers {
        if server.owner_id == user.user_id {
            queries::delete_server(&state.db, server.id).await?;
        }
    }

    // Delete user (cascades handle sessions, memberships, relationships, etc.)
    queries::delete_user(&state.db, user.user_id).await?;

    // Disconnect from gateway
    state.gateway.disconnect_user(user.user_id);

    Ok(axum::Json(serde_json::json!({ "deleted": true })))
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

async fn get_notification_prefs(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;
    let prefs = queries::get_notification_preferences(&state.db, user.user_id).await?;
    Ok(axum::Json(prefs))
}

#[derive(serde::Deserialize)]
struct SetNotificationPrefRequest {
    target_id: uuid::Uuid,
    target_type: String,
    notification_level: String,
    muted: bool,
}

async fn set_notification_pref(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
    axum::Json(body): axum::Json<SetNotificationPrefRequest>,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;

    if !matches!(body.target_type.as_str(), "channel" | "server") {
        return Err(crate::error::ApiError::InvalidInput(
            "target_type must be 'channel' or 'server'".into(),
        ));
    }
    if !matches!(
        body.notification_level.as_str(),
        "all" | "mentions" | "nothing"
    ) {
        return Err(crate::error::ApiError::InvalidInput(
            "notification_level must be 'all', 'mentions', or 'nothing'".into(),
        ));
    }

    let pref = queries::upsert_notification_preference(
        &state.db,
        user.user_id,
        body.target_id,
        &body.target_type,
        &body.notification_level,
        body.muted,
    )
    .await?;
    Ok(axum::Json(pref))
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
