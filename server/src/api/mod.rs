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
use axum::routing::get;
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
    Router::new().route("/@me", get(get_me).patch(update_me))
}

async fn get_me(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;
    use crate::types::entities::PublicUser;

    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(crate::error::ApiError::NotFound("User"))?;

    Ok(axum::Json(PublicUser::from(user_data)))
}

#[derive(serde::Deserialize)]
struct UpdateUserRequest {
    status: Option<String>,
    custom_status: Option<String>,
}

async fn update_me(
    State(state): State<AppState>,
    user: crate::api::auth::AuthUser,
    axum::Json(body): axum::Json<UpdateUserRequest>,
) -> Result<impl IntoResponse, crate::error::ApiError> {
    use crate::db::queries;
    use crate::types::entities::PublicUser;

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

    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(crate::error::ApiError::NotFound("User"))?;

    Ok(axum::Json(PublicUser::from(user_data)))
}

async fn gateway_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_connection(state, socket))
}
