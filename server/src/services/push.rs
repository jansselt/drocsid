use std::sync::Arc;

use base64::engine::{general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use uuid::Uuid;
use web_push_native::jwt_simple::prelude::ES256KeyPair;
use web_push_native::p256::PublicKey;
use web_push_native::{Auth, WebPushBuilder};

use crate::config::WebPushConfig;
use crate::db::queries;
use crate::state::AppState;

pub struct PushService {
    vapid_keypair: ES256KeyPair,
    vapid_subject: String,
    vapid_public_key: String,
    http: reqwest::Client,
}

#[derive(Debug, Serialize)]
struct PushPayload {
    title: String,
    body: String,
    tag: String,
    url: String,
}

impl PushService {
    pub fn new(config: &WebPushConfig) -> anyhow::Result<Self> {
        // Parse the VAPID private key (base64url-encoded raw 32-byte EC scalar)
        let raw_key = URL_SAFE_NO_PAD.decode(&config.vapid_private_key)?;
        let keypair = ES256KeyPair::from_bytes(&raw_key)
            .map_err(|e| anyhow::anyhow!("Invalid VAPID private key: {e}"))?;

        Ok(Self {
            vapid_keypair: keypair,
            vapid_subject: config.subject.clone(),
            vapid_public_key: config.vapid_public_key.clone(),
            http: reqwest::Client::new(),
        })
    }

    pub fn vapid_public_key(&self) -> &str {
        &self.vapid_public_key
    }

    async fn send_notification(
        &self,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
        payload: &PushPayload,
    ) -> Result<(), PushError> {
        // Decode subscription keys
        let p256dh_bytes = URL_SAFE_NO_PAD
            .decode(p256dh)
            .map_err(|_| PushError::InvalidSubscription)?;
        let auth_bytes = URL_SAFE_NO_PAD
            .decode(auth)
            .map_err(|_| PushError::InvalidSubscription)?;

        let ua_public = PublicKey::from_sec1_bytes(&p256dh_bytes)
            .map_err(|_| PushError::InvalidSubscription)?;
        let ua_auth =
            Auth::clone_from_slice(&auth_bytes);

        let endpoint_uri: axum::http::Uri = endpoint
            .parse()
            .map_err(|_| PushError::InvalidSubscription)?;

        let builder = WebPushBuilder::new(endpoint_uri, ua_public, ua_auth)
            .with_vapid(&self.vapid_keypair, &self.vapid_subject);

        let payload_json = serde_json::to_vec(payload).unwrap();
        let request = builder
            .build(payload_json)
            .map_err(|e| PushError::Encryption(e.to_string()))?;

        // Convert http::Request to reqwest
        let (parts, body) = request.into_parts();
        let url = parts.uri.to_string();
        let mut req = self.http.request(parts.method, &url);
        for (name, value) in &parts.headers {
            req = req.header(name, value);
        }
        req = req.body(body);

        let response = req.send().await.map_err(|e| PushError::Network(e.to_string()))?;
        let status = response.status().as_u16();

        match status {
            200 | 201 | 202 => Ok(()),
            410 => Err(PushError::Gone),
            404 => Err(PushError::Gone),
            429 => Err(PushError::RateLimited),
            _ => Err(PushError::Server(status)),
        }
    }
}

#[derive(Debug)]
enum PushError {
    InvalidSubscription,
    Encryption(String),
    Network(String),
    Gone,
    RateLimited,
    Server(u16),
}

/// Send push notifications for a new message to offline users.
pub async fn send_push_for_message(
    state: &AppState,
    push: &Arc<PushService>,
    channel_id: Uuid,
    server_id: Option<Uuid>,
    author_id: Uuid,
    author_name: &str,
    content: &str,
    mentioned_user_ids: &[Uuid],
) {
    // Get the channel name for the notification title
    let channel_name = match queries::get_channel_by_id(&state.db, channel_id).await {
        Ok(Some(ch)) => ch.name,
        _ => None,
    };

    // Collect recipient user IDs
    let recipient_ids: Vec<Uuid> = if let Some(sid) = server_id {
        // Server channel — get all members
        match queries::get_server_members(&state.db, sid).await {
            Ok(members) => members
                .into_iter()
                .map(|m| m.user_id)
                .filter(|uid| *uid != author_id)
                .collect(),
            Err(e) => {
                tracing::error!("Failed to get server members for push: {e}");
                return;
            }
        }
    } else {
        // DM — get channel members
        match queries::get_dm_members(&state.db, channel_id).await {
            Ok(members) => members
                .into_iter()
                .map(|m| m.id)
                .filter(|uid| *uid != author_id)
                .collect(),
            Err(e) => {
                tracing::error!("Failed to get DM members for push: {e}");
                return;
            }
        }
    };

    if recipient_ids.is_empty() {
        return;
    }

    // Filter to offline users only
    let offline_ids: Vec<Uuid> = recipient_ids
        .into_iter()
        .filter(|uid| !state.gateway.is_online(*uid))
        .collect();

    if offline_ids.is_empty() {
        return;
    }

    // Check notification preferences for offline users
    let eligible_ids = filter_by_preferences(
        &state.db,
        &offline_ids,
        channel_id,
        server_id,
        mentioned_user_ids,
    )
    .await;

    if eligible_ids.is_empty() {
        return;
    }

    // Fetch push subscriptions for eligible users
    let subscriptions = match queries::get_push_subscriptions_for_users(&state.db, &eligible_ids).await
    {
        Ok(subs) => subs,
        Err(e) => {
            tracing::error!("Failed to fetch push subscriptions: {e}");
            return;
        }
    };

    if subscriptions.is_empty() {
        return;
    }

    // Build payload
    let body_preview: String = content.chars().take(200).collect();
    let (title, tag, url) = if let Some(sid) = server_id {
        let ch_name = channel_name.as_deref().unwrap_or("unknown");
        (
            format!("{author_name} in #{ch_name}"),
            format!("channel:{channel_id}"),
            format!("/channels/{sid}/{channel_id}"),
        )
    } else {
        (
            author_name.to_string(),
            format!("dm:{channel_id}"),
            format!("/channels/@me/{channel_id}"),
        )
    };

    let payload = PushPayload {
        title,
        body: body_preview,
        tag,
        url,
    };

    // Send to all subscriptions
    for sub in &subscriptions {
        match push
            .send_notification(&sub.endpoint, &sub.p256dh_key, &sub.auth_key, &payload)
            .await
        {
            Ok(()) => {
                tracing::debug!(endpoint = %sub.endpoint, "Push notification sent");
            }
            Err(PushError::Gone) => {
                tracing::info!(endpoint = %sub.endpoint, "Push subscription expired, removing");
                let _ =
                    queries::delete_push_subscription_by_endpoint(&state.db, &sub.endpoint).await;
            }
            Err(PushError::RateLimited) => {
                tracing::warn!(endpoint = %sub.endpoint, "Push rate limited");
            }
            Err(e) => {
                tracing::warn!(endpoint = %sub.endpoint, error = ?e, "Push notification failed");
            }
        }
    }
}

/// Filter user IDs based on their notification preferences.
async fn filter_by_preferences(
    db: &sqlx::PgPool,
    user_ids: &[Uuid],
    channel_id: Uuid,
    server_id: Option<Uuid>,
    mentioned_user_ids: &[Uuid],
) -> Vec<Uuid> {
    let mut eligible = Vec::new();

    for &user_id in user_ids {
        let prefs = match queries::get_notification_preferences(db, user_id).await {
            Ok(p) => p,
            Err(_) => {
                // If we can't fetch prefs, default to allowing
                eligible.push(user_id);
                continue;
            }
        };

        // Check channel-level preference first, then server-level
        let channel_pref = prefs.iter().find(|p| p.target_id == channel_id);
        let server_pref = server_id.and_then(|sid| prefs.iter().find(|p| p.target_id == sid));
        let effective = channel_pref.or(server_pref);

        match effective {
            Some(pref) if pref.muted => continue,
            Some(pref) if pref.notification_level == "nothing" => continue,
            Some(pref) if pref.notification_level == "mentions" => {
                if mentioned_user_ids.contains(&user_id) {
                    eligible.push(user_id);
                }
            }
            _ => {
                // "all" or no preference set — notify
                eligible.push(user_id);
            }
        }
    }

    eligible
}
