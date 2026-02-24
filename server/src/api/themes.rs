use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::api::auth::AuthUser;
use crate::db::queries;
use crate::error::ApiError;
use crate::state::AppState;
use crate::types::entities::{CreateCustomThemeRequest, UpdateCustomThemeRequest};

const MAX_THEMES_PER_USER: i64 = 20;

/// Known CSS variable keys that custom themes may set.
const REQUIRED_COLOR_KEYS: &[&str] = &[
    "--bg-darkest",
    "--bg-base",
    "--bg-primary",
    "--bg-secondary",
    "--bg-tertiary",
    "--bg-hover",
    "--bg-active",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--border",
    "--accent",
    "--accent-hover",
    "--danger",
];

const OPTIONAL_COLOR_KEYS: &[&str] = &["--font-body", "--text-glow"];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_custom_themes).post(create_custom_theme))
        .route(
            "/{theme_id}",
            axum::routing::patch(update_custom_theme).delete(delete_custom_theme),
        )
}

/// Validate that a color value looks like a CSS color (hex, rgb, rgba).
fn is_valid_color_value(value: &str) -> bool {
    let v = value.trim();
    // #rgb, #rrggbb, #rrggbbaa
    if v.starts_with('#') {
        let hex = &v[1..];
        return (hex.len() == 3 || hex.len() == 6 || hex.len() == 8)
            && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    // rgba(...) or rgb(...)
    if (v.starts_with("rgba(") || v.starts_with("rgb(")) && v.ends_with(')') {
        return true;
    }
    false
}

/// Validate the colors JSON object: all required keys present, values are valid CSS colors.
fn validate_colors(colors: &serde_json::Value, partial: bool) -> Result<(), ApiError> {
    let obj = colors
        .as_object()
        .ok_or_else(|| ApiError::InvalidInput("colors must be a JSON object".into()))?;

    if !partial {
        for key in REQUIRED_COLOR_KEYS {
            if !obj.contains_key(*key) {
                return Err(ApiError::InvalidInput(format!(
                    "Missing required color key: {key}"
                )));
            }
        }
    }

    for (key, value) in obj {
        let is_known = REQUIRED_COLOR_KEYS.contains(&key.as_str())
            || OPTIONAL_COLOR_KEYS.contains(&key.as_str());
        if !is_known {
            return Err(ApiError::InvalidInput(format!(
                "Unknown color key: {key}"
            )));
        }

        let val_str = value
            .as_str()
            .ok_or_else(|| ApiError::InvalidInput(format!("Color value for {key} must be a string")))?;

        // --font-body is a font stack, not a color
        if key == "--font-body" {
            if val_str.len() > 200 {
                return Err(ApiError::InvalidInput(
                    "--font-body must be 200 characters or fewer".into(),
                ));
            }
            continue;
        }

        // --text-glow is a CSS text-shadow value
        if key == "--text-glow" {
            if val_str.len() > 200 {
                return Err(ApiError::InvalidInput(
                    "--text-glow must be 200 characters or fewer".into(),
                ));
            }
            continue;
        }

        if !is_valid_color_value(val_str) {
            return Err(ApiError::InvalidInput(format!(
                "Invalid color value for {key}: must be hex (#rrggbb) or rgb()/rgba()"
            )));
        }
    }

    Ok(())
}

/// GET /users/@me/themes
async fn list_custom_themes(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    let themes = queries::get_custom_themes_by_user(&state.db, user.user_id).await?;
    Ok(Json(themes))
}

/// POST /users/@me/themes
async fn create_custom_theme(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateCustomThemeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let name = body.name.trim();
    if name.is_empty() || name.len() > 32 {
        return Err(ApiError::InvalidInput(
            "Theme name must be 1-32 characters".into(),
        ));
    }

    validate_colors(&body.colors, false)?;

    let count = queries::count_user_custom_themes(&state.db, user.user_id).await?;
    if count >= MAX_THEMES_PER_USER {
        return Err(ApiError::InvalidInput(format!(
            "Maximum of {MAX_THEMES_PER_USER} custom themes"
        )));
    }

    let theme =
        queries::create_custom_theme(&state.db, user.user_id, name, &body.colors).await?;

    Ok((axum::http::StatusCode::CREATED, Json(theme)))
}

/// PATCH /users/@me/themes/:theme_id
async fn update_custom_theme(
    State(state): State<AppState>,
    user: AuthUser,
    Path(theme_id): Path<Uuid>,
    Json(body): Json<UpdateCustomThemeRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let existing = queries::get_custom_theme_by_id(&state.db, theme_id)
        .await?
        .ok_or(ApiError::NotFound("Custom theme"))?;

    if existing.user_id != user.user_id {
        return Err(ApiError::NotFound("Custom theme"));
    }

    if let Some(ref name) = body.name {
        let name = name.trim();
        if name.is_empty() || name.len() > 32 {
            return Err(ApiError::InvalidInput(
                "Theme name must be 1-32 characters".into(),
            ));
        }
    }

    if let Some(ref colors) = body.colors {
        validate_colors(colors, false)?;
    }

    let theme = queries::update_custom_theme(
        &state.db,
        theme_id,
        body.name.as_deref(),
        body.colors.as_ref(),
    )
    .await?;

    Ok(Json(theme))
}

/// DELETE /users/@me/themes/:theme_id
async fn delete_custom_theme(
    State(state): State<AppState>,
    user: AuthUser,
    Path(theme_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let existing = queries::get_custom_theme_by_id(&state.db, theme_id)
        .await?
        .ok_or(ApiError::NotFound("Custom theme"))?;

    if existing.user_id != user.user_id {
        return Err(ApiError::NotFound("Custom theme"));
    }

    // If user's active theme is this custom theme, reset to "dark"
    let user_data = queries::get_user_by_id(&state.db, user.user_id)
        .await?
        .ok_or(ApiError::NotFound("User"))?;

    if user_data.theme_preference == format!("custom:{}", theme_id) {
        queries::update_user_profile(&state.db, user.user_id, None, None, None, Some("dark"), None)
            .await?;
    }

    queries::delete_custom_theme(&state.db, theme_id).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}
