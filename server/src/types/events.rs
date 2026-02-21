use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::entities::{
    Attachment, ChannelOverride, Message, PublicUser, ReactionGroup, Role, Server, ServerMember,
    SoundboardSound,
};

// ── Gateway Opcodes ────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum GatewayOpcode {
    Dispatch = 0,
    Heartbeat = 1,
    Identify = 2,
    PresenceUpdate = 3,
    Resume = 6,
    Reconnect = 7,
    InvalidSession = 9,
    Hello = 10,
    HeartbeatAck = 11,
}

// ── Gateway Payload (wire format) ──────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayPayload {
    pub op: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub d: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub s: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t: Option<String>,
}

impl GatewayPayload {
    pub fn hello(heartbeat_interval: u64) -> Self {
        Self {
            op: GatewayOpcode::Hello as u8,
            d: Some(serde_json::json!({ "heartbeat_interval": heartbeat_interval })),
            s: None,
            t: None,
        }
    }

    pub fn heartbeat_ack() -> Self {
        Self {
            op: GatewayOpcode::HeartbeatAck as u8,
            d: None,
            s: None,
            t: None,
        }
    }

    pub fn ready(data: ReadyPayload, seq: u64) -> Self {
        Self {
            op: GatewayOpcode::Dispatch as u8,
            d: Some(serde_json::to_value(data).unwrap()),
            s: Some(seq),
            t: Some("READY".into()),
        }
    }

    pub fn dispatch(event: &str, data: impl Serialize, seq: u64) -> Self {
        Self {
            op: GatewayOpcode::Dispatch as u8,
            d: Some(serde_json::to_value(data).unwrap()),
            s: Some(seq),
            t: Some(event.into()),
        }
    }

    pub fn invalid_session(resumable: bool) -> Self {
        Self {
            op: GatewayOpcode::InvalidSession as u8,
            d: Some(serde_json::json!(resumable)),
            s: None,
            t: None,
        }
    }
}

// ── Client -> Server messages ──────────────────────────

#[derive(Debug, Deserialize)]
pub struct IdentifyPayload {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct ResumePayload {
    pub token: String,
    pub session_id: Uuid,
    pub seq: u64,
}

// ── Server -> Client messages ──────────────────────────

#[derive(Debug, Serialize)]
pub struct ReadyPayload {
    pub session_id: Uuid,
    pub user: PublicUser,
    pub servers: Vec<Server>,
    pub read_states: Vec<super::entities::ReadState>,
    pub notification_preferences: Vec<crate::db::queries::NotificationPreference>,
    pub bookmarked_message_ids: Vec<Uuid>,
}

// ── Dispatch Events ────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct MessageAckEvent {
    pub channel_id: Uuid,
    pub message_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageCreateEvent {
    #[serde(flatten)]
    pub message: Message,
    pub author: PublicUser,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageCreateWithExtrasEvent {
    #[serde(flatten)]
    pub message: Message,
    pub author: PublicUser,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageUpdateEvent {
    #[serde(flatten)]
    pub message: Message,
    pub attachments: Vec<Attachment>,
    pub reactions: Vec<ReactionGroup>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageDeleteEvent {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReactionAddEvent {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub emoji_name: String,
    pub emoji_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReactionRemoveEvent {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub emoji_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessagePinEvent {
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TypingStartEvent {
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerMemberAddEvent {
    pub server_id: Uuid,
    pub member: ServerMember,
    pub user: PublicUser,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerMemberRemoveEvent {
    pub server_id: Uuid,
    pub user_id: Uuid,
}

// ── Role Events ───────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct RoleCreateEvent {
    pub server_id: Uuid,
    #[serde(flatten)]
    pub role: Role,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoleUpdateEvent {
    pub server_id: Uuid,
    #[serde(flatten)]
    pub role: Role,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoleDeleteEvent {
    pub server_id: Uuid,
    pub role_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemberRoleUpdateEvent {
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub role_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelOverrideUpdateEvent {
    pub server_id: Uuid,
    pub channel_id: Uuid,
    pub overrides: Vec<ChannelOverride>,
}

// ── DM & Relationship Events ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct DmChannelCreateEvent {
    pub channel: super::entities::Channel,
    pub recipients: Vec<PublicUser>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelationshipUpdateEvent {
    pub user_id: Uuid,
    pub target_id: Uuid,
    pub rel_type: Option<String>,
}

// ── Thread Events ─────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ThreadCreateEvent {
    pub channel: super::entities::Channel,
    pub metadata: super::entities::ThreadMetadata,
    pub parent_channel_id: Uuid,
    pub server_id: Option<Uuid>,
}

// ── Voice Events ──────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct VoiceStateUpdateEvent {
    pub server_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub user_id: Uuid,
    pub self_mute: bool,
    pub self_deaf: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceTokenResponse {
    pub token: String,
    pub url: String,
}

// ── Invite Events ─────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct InviteCreateEvent {
    pub server_id: Uuid,
    #[serde(flatten)]
    pub invite: super::entities::Invite,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteDeleteEvent {
    pub server_id: Uuid,
    pub code: String,
}

// ── Presence Events ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresenceUpdateEvent {
    pub user_id: Uuid,
    pub status: String,
    pub custom_status: Option<String>,
}

/// Client -> Server presence update payload (opcode 3)
#[derive(Debug, Deserialize)]
pub struct ClientPresenceUpdate {
    pub status: String,
}

// ── Ban Events ────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct BanCreateEvent {
    pub server_id: Uuid,
    pub user_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct BanDeleteEvent {
    pub server_id: Uuid,
    pub user_id: Uuid,
}

// ── Soundboard Events ──────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SoundboardSoundCreateEvent {
    pub server_id: Uuid,
    #[serde(flatten)]
    pub sound: SoundboardSound,
}

#[derive(Debug, Clone, Serialize)]
pub struct SoundboardSoundDeleteEvent {
    pub server_id: Uuid,
    pub sound_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct SoundboardPlayEvent {
    pub server_id: Uuid,
    pub channel_id: Uuid,
    pub sound_id: Uuid,
    pub audio_url: String,
    pub volume: f32,
    pub user_id: Uuid,
}

// ── Internal event for Redis pub/sub ───────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BroadcastEvent {
    pub event_name: String,
    pub data: Value,
    /// Server ID for server-scoped events, None for DM events
    pub server_id: Option<Uuid>,
    /// Channel ID the event relates to (for permission filtering)
    pub channel_id: Option<Uuid>,
    /// User ID that triggered the event (to avoid echoing back)
    pub source_user_id: Option<Uuid>,
}
