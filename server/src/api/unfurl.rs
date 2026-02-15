use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::api::auth::AuthUser;
use crate::error::ApiError;
use crate::state::AppState;

/// In-memory cache with 1-hour TTL
static CACHE: LazyLock<RwLock<HashMap<String, CachedUnfurl>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

const CACHE_TTL: Duration = Duration::from_secs(3600);
const FETCH_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_BODY_BYTES: usize = 512 * 1024;

struct CachedUnfurl {
    data: UnfurlResponse,
    fetched_at: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnfurlResponse {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/unfurl", get(unfurl))
}

#[derive(Debug, Deserialize)]
struct UnfurlQuery {
    url: String,
}

async fn unfurl(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<UnfurlQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let url = query.url.trim().to_string();

    if !url.starts_with("https://") {
        return Err(ApiError::InvalidInput(
            "Only HTTPS URLs are supported".into(),
        ));
    }

    // Don't unfurl our own domain
    if url.contains(&state.config.instance.domain) {
        return Err(ApiError::InvalidInput(
            "Cannot unfurl internal URLs".into(),
        ));
    }

    // Check cache
    {
        let cache = CACHE.read().await;
        if let Some(cached) = cache.get(&url) {
            if cached.fetched_at.elapsed() < CACHE_TTL {
                return Ok(Json(cached.data.clone()));
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        // Use a recognized bot UA so sites like Reddit serve OG meta tags
        // instead of JS-rendered shells
        .user_agent("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")
        .build()
        .map_err(|e| ApiError::Internal(e.into()))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|_| ApiError::InvalidInput("Failed to fetch URL".into()))?;

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.contains("text/html") {
        return Err(ApiError::InvalidInput("URL is not an HTML page".into()));
    }

    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let end = body_bytes.len().min(MAX_BODY_BYTES);
    let html = String::from_utf8_lossy(&body_bytes[..end]);

    let data = extract_og_metadata(&url, &html);

    // Cache the result
    {
        let mut cache = CACHE.write().await;
        cache.insert(
            url.clone(),
            CachedUnfurl {
                data: data.clone(),
                fetched_at: Instant::now(),
            },
        );
        // Evict expired entries periodically
        if cache.len() % 100 == 0 {
            cache.retain(|_, v| v.fetched_at.elapsed() < CACHE_TTL);
        }
    }

    Ok(Json(data))
}

fn extract_og_metadata(url: &str, html: &str) -> UnfurlResponse {
    use scraper::{Html, Selector};

    let document = Html::parse_document(html);
    let meta_sel = Selector::parse("meta").unwrap();
    let title_sel = Selector::parse("title").unwrap();

    let mut og_title: Option<String> = None;
    let mut og_description: Option<String> = None;
    let mut og_image: Option<String> = None;
    let mut og_site_name: Option<String> = None;
    let mut twitter_title: Option<String> = None;
    let mut twitter_description: Option<String> = None;
    let mut twitter_image: Option<String> = None;

    for element in document.select(&meta_sel) {
        let property = element
            .value()
            .attr("property")
            .or_else(|| element.value().attr("name"));
        let content = element.value().attr("content");

        if let (Some(prop), Some(cont)) = (property, content) {
            match prop {
                "og:title" => og_title = Some(cont.to_string()),
                "og:description" => og_description = Some(cont.to_string()),
                "og:image" => og_image = Some(cont.to_string()),
                "og:site_name" => og_site_name = Some(cont.to_string()),
                "twitter:title" => twitter_title = Some(cont.to_string()),
                "twitter:description" => twitter_description = Some(cont.to_string()),
                "twitter:image" | "twitter:image:src" => {
                    twitter_image = Some(cont.to_string());
                }
                "description" if og_description.is_none() => {
                    og_description = Some(cont.to_string());
                }
                _ => {}
            }
        }
    }

    // Use twitter: as fallbacks for og:
    if og_title.is_none() {
        og_title = twitter_title;
    }
    if og_description.is_none() {
        og_description = twitter_description;
    }
    if og_image.is_none() {
        og_image = twitter_image;
    }

    // Fallback title from <title> tag
    if og_title.is_none() {
        if let Some(title_el) = document.select(&title_sel).next() {
            let text = title_el.text().collect::<String>();
            if !text.is_empty() {
                og_title = Some(text);
            }
        }
    }

    // Resolve relative image URLs against the page URL
    if let Some(ref mut img) = og_image {
        if img.starts_with("//") {
            *img = format!("https:{img}");
        } else if img.starts_with('/') {
            // Extract origin from the page URL
            if let Some(origin_end) = url.find("://").and_then(|i| url[i + 3..].find('/').map(|j| i + 3 + j)) {
                *img = format!("{}{img}", &url[..origin_end]);
            }
        }
    }

    // Truncate description
    if let Some(ref mut desc) = og_description {
        if desc.len() > 300 {
            desc.truncate(300);
            desc.push_str("…");
        }
    }

    UnfurlResponse {
        url: url.to_string(),
        title: og_title,
        description: og_description,
        image: og_image,
        site_name: og_site_name,
    }
}
