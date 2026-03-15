use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use uuid::Uuid;

use crate::api::admin::require_admin;
use crate::api::auth::AuthUser;
use crate::error::ApiError;
use crate::state::AppState;

// ── Health ──────────────────────────────────────────────

#[derive(Serialize)]
struct ServerHealth {
    uptime_secs: u64,
    connected_sessions: usize,
    connected_users: usize,
    voice_channels_active: usize,
    voice_users: usize,
    db_pool_size: u32,
    db_pool_idle: u32,
    redis_connected: bool,
    s3_configured: bool,
    livekit_configured: bool,
    memory_rss_kb: Option<u64>,
}

async fn dashboard_health(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let memory_rss_kb = read_rss_kb();

    // Check redis connectivity by pinging
    let redis_connected = {
        let mut conn = state.redis.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .is_ok()
    };

    let health = ServerHealth {
        uptime_secs: state.started_at.elapsed().as_secs(),
        connected_sessions: state.gateway.connection_count(),
        connected_users: state.gateway.user_count(),
        voice_channels_active: state.gateway.voice_channel_count(),
        voice_users: state.gateway.voice_user_count(),
        db_pool_size: state.db.size(),
        db_pool_idle: state.db.num_idle() as u32,
        redis_connected,
        s3_configured: state.s3.is_some(),
        livekit_configured: state.config.livekit.is_some(),
        memory_rss_kb,
    };

    Ok(Json(health))
}

#[cfg(target_os = "linux")]
fn read_rss_kb() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let trimmed = rest.trim().trim_end_matches(" kB").trim();
            return trimmed.parse().ok();
        }
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn read_rss_kb() -> Option<u64> {
    None
}

// ── LiveKit Rooms ───────────────────────────────────────

#[derive(Serialize)]
struct LiveKitRoomInfo {
    name: String,
    sid: String,
    num_participants: u32,
    num_publishers: u32,
    creation_time: i64,
    metadata: String,
    active_recording: bool,
}

async fn livekit_rooms(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let lk = state
        .config
        .livekit
        .as_ref()
        .ok_or(ApiError::InvalidInput("LiveKit not configured".into()))?;

    let http_url = lk
        .url
        .replace("ws://", "http://")
        .replace("wss://", "https://");

    let room_client =
        livekit_api::services::room::RoomClient::with_api_key(&http_url, &lk.api_key, &lk.api_secret);

    let rooms = room_client
        .list_rooms(Vec::new())
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("LiveKit API error: {e}")))?;

    let result: Vec<LiveKitRoomInfo> = rooms
        .into_iter()
        .map(|r| LiveKitRoomInfo {
            name: r.name,
            sid: r.sid,
            num_participants: r.num_participants,
            num_publishers: r.num_publishers,
            creation_time: r.creation_time,
            metadata: r.metadata,
            active_recording: r.active_recording,
        })
        .collect();

    Ok(Json(result))
}

// ── LiveKit Room Detail ─────────────────────────────────

#[derive(Serialize)]
struct LiveKitRoomDetail {
    room: LiveKitRoomInfo,
    participants: Vec<LiveKitParticipantInfo>,
}

#[derive(Serialize)]
struct LiveKitParticipantInfo {
    identity: String,
    name: String,
    state: String,
    joined_at: i64,
    tracks: Vec<LiveKitTrackInfo>,
}

#[derive(Serialize)]
struct LiveKitTrackInfo {
    sid: String,
    name: String,
    source: String,
    muted: bool,
    track_type: String,
}

fn track_type_name(t: i32) -> &'static str {
    match t {
        0 => "audio",
        1 => "video",
        2 => "data",
        _ => "unknown",
    }
}

fn track_source_name(s: i32) -> &'static str {
    match s {
        0 => "unknown",
        1 => "camera",
        2 => "microphone",
        3 => "screen_share",
        4 => "screen_share_audio",
        _ => "unknown",
    }
}

fn participant_state_name(s: i32) -> &'static str {
    match s {
        0 => "joining",
        1 => "joined",
        2 => "active",
        3 => "disconnected",
        _ => "unknown",
    }
}

async fn livekit_room_detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(room_name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let lk = state
        .config
        .livekit
        .as_ref()
        .ok_or(ApiError::InvalidInput("LiveKit not configured".into()))?;

    let http_url = lk
        .url
        .replace("ws://", "http://")
        .replace("wss://", "https://");

    let room_client =
        livekit_api::services::room::RoomClient::with_api_key(&http_url, &lk.api_key, &lk.api_secret);

    // Get room info by listing rooms with the specific name
    let rooms = room_client
        .list_rooms(vec![room_name.clone()])
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("LiveKit API error: {e}")))?;

    let room = rooms
        .into_iter()
        .next()
        .ok_or(ApiError::NotFound("LiveKit room"))?;

    let participants = room_client
        .list_participants(&room_name)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("LiveKit API error: {e}")))?;

    let participant_infos: Vec<LiveKitParticipantInfo> = participants
        .into_iter()
        .map(|p| LiveKitParticipantInfo {
            identity: p.identity,
            name: p.name,
            state: participant_state_name(p.state).to_string(),
            joined_at: p.joined_at,
            tracks: p
                .tracks
                .into_iter()
                .map(|t| LiveKitTrackInfo {
                    sid: t.sid,
                    name: t.name,
                    source: track_source_name(t.source).to_string(),
                    muted: t.muted,
                    track_type: track_type_name(t.r#type).to_string(),
                })
                .collect(),
        })
        .collect();

    let detail = LiveKitRoomDetail {
        room: LiveKitRoomInfo {
            name: room.name,
            sid: room.sid,
            num_participants: room.num_participants,
            num_publishers: room.num_publishers,
            creation_time: room.creation_time,
            metadata: room.metadata,
            active_recording: room.active_recording,
        },
        participants: participant_infos,
    };

    Ok(Json(detail))
}

// ── Gateway Voice ───────────────────────────────────────

#[derive(Serialize)]
struct VoiceStateInfo {
    user_id: Uuid,
    channel_id: Uuid,
    server_id: Option<Uuid>,
    self_mute: bool,
    self_deaf: bool,
    audio_sharing: bool,
}

async fn gateway_voice(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let states: Vec<VoiceStateInfo> = state
        .gateway
        .all_voice_states()
        .into_iter()
        .map(|vs| VoiceStateInfo {
            user_id: vs.user_id,
            channel_id: vs.channel_id,
            server_id: vs.server_id,
            self_mute: vs.self_mute,
            self_deaf: vs.self_deaf,
            audio_sharing: vs.audio_sharing,
        })
        .collect();

    Ok(Json(states))
}

// ── Log Streaming ───────────────────────────────────────

#[derive(serde::Deserialize)]
struct LogStreamQuery {
    level: Option<String>,
}

async fn logs_stream(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<LogStreamQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, user.user_id).await?;

    let sender = state
        .log_sender
        .as_ref()
        .ok_or(ApiError::InvalidInput(
            "Log streaming not configured".into(),
        ))?
        .clone();

    let level_filter = params.level.clone();

    Ok(ws.on_upgrade(move |socket| handle_log_stream(socket, sender, level_filter)))
}

async fn handle_log_stream(
    socket: WebSocket,
    sender: tokio::sync::broadcast::Sender<String>,
    level_filter: Option<String>,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let mut rx = sender.subscribe();

    let min_level = level_filter
        .as_deref()
        .and_then(parse_level_priority);

    // Cloudflare drops idle WebSockets after ~100s. Send a ping every 30s.
    let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
    ping_interval.tick().await; // consume the immediate first tick

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(line) => {
                        // Filter by level if specified
                        if let Some(min) = min_level {
                            if let Some(line_level) = extract_level_priority(&line) {
                                if line_level < min {
                                    continue;
                                }
                            }
                        }
                        if ws_sender.send(Message::Text(line.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // Skip missed messages
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = ping_interval.tick() => {
                if ws_sender.send(Message::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

/// Returns a priority number for the level (higher = more severe).
fn parse_level_priority(level: &str) -> Option<u8> {
    match level.to_uppercase().as_str() {
        "TRACE" => Some(0),
        "DEBUG" => Some(1),
        "INFO" => Some(2),
        "WARN" => Some(3),
        "ERROR" => Some(4),
        _ => None,
    }
}

/// Extract the level priority from a formatted log line.
/// Lines look like: "2024-01-01T12:00:00.000Z  INFO target: message"
fn extract_level_priority(line: &str) -> Option<u8> {
    // The level is right after the timestamp, roughly at position ~25
    // Look for known level strings
    if line.contains(" TRACE ") {
        Some(0)
    } else if line.contains(" DEBUG ") {
        Some(1)
    } else if line.contains("  INFO ") {
        Some(2)
    } else if line.contains("  WARN ") {
        Some(3)
    } else if line.contains(" ERROR ") {
        Some(4)
    } else {
        None
    }
}

// ── Routes ──────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(dashboard_health))
        .route("/livekit/rooms", get(livekit_rooms))
        .route("/livekit/rooms/{room_name}", get(livekit_room_detail))
        .route("/gateway/voice", get(gateway_voice))
        .route("/logs/stream", get(logs_stream))
}
