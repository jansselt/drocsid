use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::permissions::Permissions;

// ── Users ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub theme_preference: String,
    pub is_admin: bool,
    pub bot: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// User data safe to send to other users (no email, no password)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub theme_preference: Option<String>,
    pub bot: bool,
}

impl From<User> for PublicUser {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar_url: u.avatar_url,
            bio: u.bio,
            status: u.status,
            custom_status: u.custom_status,
            theme_preference: Some(u.theme_preference),
            bot: u.bot,
        }
    }
}

// ── Custom Themes ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserCustomTheme {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub colors: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCustomThemeRequest {
    pub name: String,
    pub colors: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCustomThemeRequest {
    pub name: Option<String>,
    pub colors: Option<serde_json::Value>,
}

// ── Message Bookmarks ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageBookmark {
    pub user_id: Uuid,
    pub message_id: Uuid,
    pub tags: Vec<String>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBookmarkRequest {
    pub tags: Option<Vec<String>>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBookmarkRequest {
    pub tags: Option<Vec<String>>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BookmarkListQuery {
    pub tag: Option<String>,
    pub search: Option<String>,
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

// ── Sessions ───────────────────────────────────────────

#[derive(Debug, Clone, FromRow)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub device_info: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// ── Servers (Guilds) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Server {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub banner_position: i16,
    pub owner_id: Uuid,
    pub default_channel_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Channels ───────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "channel_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ChannelType {
    Text,
    Voice,
    Category,
    Dm,
    GroupDm,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Channel {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub server_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub channel_type: ChannelType,
    pub name: Option<String>,
    pub topic: Option<String>,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_message_id: Option<Uuid>,
}

// ── Read States ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ReadState {
    pub channel_id: Uuid,
    pub last_read_message_id: Option<Uuid>,
    pub mention_count: i32,
}

#[derive(Debug, Deserialize)]
pub struct AckMessageRequest {
    pub message_id: Uuid,
}

// ── Messages ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Option<Uuid>,
    pub content: Option<String>,
    pub reply_to_id: Option<Uuid>,
    pub edited_at: Option<DateTime<Utc>>,
    pub pinned: bool,
    pub created_at: DateTime<Utc>,
}

// ── Server Members ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerMember {
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
}

/// Enriched member data with user info and presence for the member list
#[derive(Debug, Clone, Serialize)]
pub struct ServerMemberWithUser {
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
    pub user: PublicUser,
    pub status: String,
    pub role_ids: Vec<Uuid>,
}

// ── Roles ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Role {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub color: i32,
    pub hoist: bool,
    pub position: i32,
    pub permissions: i64,
    pub mentionable: bool,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
}

impl Role {
    pub fn permissions(&self) -> Permissions {
        Permissions::from_bits_truncate(self.permissions)
    }
}

// ── Channel Overrides ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelOverride {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub allow: i64,
    pub deny: i64,
}

// ── Attachments ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub url: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub created_at: DateTime<Utc>,
}

// ── Reactions ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Reaction {
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub emoji_name: String,
    pub emoji_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// Aggregated reaction counts for a message
#[derive(Debug, Clone, Serialize)]
pub struct ReactionGroup {
    pub emoji_name: String,
    pub emoji_id: Option<Uuid>,
    pub count: i64,
    pub me: bool,
}

// ── Custom Emojis ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CustomEmoji {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub image_url: String,
    pub animated: bool,
    pub creator_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

// ── Relationships ────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "relationship_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum RelationshipType {
    Friend,
    Blocked,
    PendingOutgoing,
    PendingIncoming,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Relationship {
    pub user_id: Uuid,
    pub target_id: Uuid,
    pub rel_type: RelationshipType,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelationshipWithUser {
    #[serde(flatten)]
    pub relationship: Relationship,
    pub user: PublicUser,
}

// ── DM Members ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmMember {
    pub channel_id: Uuid,
    pub user_id: Uuid,
}

// ── Thread Metadata ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ThreadMetadata {
    pub channel_id: Uuid,
    pub parent_channel_id: Uuid,
    pub starter_message_id: Option<Uuid>,
    pub archived: bool,
    pub locked: bool,
    pub message_count: i32,
    pub created_at: DateTime<Utc>,
}

// ── Search ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SearchResult {
    pub id: Uuid,
    pub instance_id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Option<Uuid>,
    pub content: Option<String>,
    pub reply_to_id: Option<Uuid>,
    pub edited_at: Option<DateTime<Utc>>,
    pub pinned: bool,
    pub created_at: DateTime<Utc>,
    pub rank: f32,
}

// ── API Request/Response types ─────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    pub invite_code: Option<String>,
}

// ── Registration Codes ────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RegistrationCode {
    pub id: Uuid,
    pub code: String,
    pub creator_id: Uuid,
    pub max_uses: Option<i32>,
    pub uses: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRegistrationCodeRequest {
    pub max_uses: Option<i32>,
    pub max_age_secs: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: PublicUser,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub channel_type: Option<ChannelType>,
    pub topic: Option<String>,
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub topic: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct MessageQuery {
    pub before: Option<Uuid>,
    pub after: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    pub color: Option<i32>,
    pub hoist: Option<bool>,
    pub permissions: Option<i64>,
    pub mentionable: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub color: Option<i32>,
    pub hoist: Option<bool>,
    pub position: Option<i32>,
    pub permissions: Option<i64>,
    pub mentionable: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SetChannelOverrideRequest {
    pub allow: i64,
    pub deny: i64,
}

#[derive(Debug, Deserialize)]
pub struct RoleAssignment {
    pub role_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct UploadUrlResponse {
    pub upload_url: String,
    pub file_url: String,
    pub attachment_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
}

#[derive(Debug, Deserialize)]
pub struct AttachmentIds {
    pub attachment_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Serialize)]
pub struct MessageWithExtras {
    #[serde(flatten)]
    pub message: Message,
    pub attachments: Vec<Attachment>,
    pub reactions: Vec<ReactionGroup>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDmRequest {
    pub recipient_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct CreateGroupDmRequest {
    pub recipient_ids: Vec<Uuid>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddGroupDmRecipientsRequest {
    pub recipient_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateThreadRequest {
    pub name: String,
    pub message_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub channel_id: Option<Uuid>,
    pub server_id: Option<Uuid>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct VoiceJoinRequest {
    pub self_mute: Option<bool>,
    pub self_deaf: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct VoiceStateUpdate {
    pub self_mute: Option<bool>,
    pub self_deaf: Option<bool>,
}

// ── Invites ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Invite {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub creator_id: Uuid,
    pub code: String,
    pub max_uses: Option<i32>,
    pub uses: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i32>,
    pub max_age_secs: Option<i64>,
}

// ── Bans ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Ban {
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub moderator_id: Uuid,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BanWithUser {
    #[serde(flatten)]
    pub ban: Ban,
    pub user: PublicUser,
}

#[derive(Debug, Deserialize)]
pub struct CreateBanRequest {
    pub reason: Option<String>,
}

// ── Audit Log ───────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "audit_action", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    ServerUpdate,
    ChannelCreate,
    ChannelUpdate,
    ChannelDelete,
    RoleCreate,
    RoleUpdate,
    RoleDelete,
    MemberKick,
    MemberBan,
    MemberUnban,
    InviteCreate,
    InviteDelete,
    WebhookCreate,
    WebhookUpdate,
    WebhookDelete,
    MessageDelete,
    MessagePin,
    MessageUnpin,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLogEntry {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub action: AuditAction,
    pub target_id: Option<Uuid>,
    pub reason: Option<String>,
    pub changes: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditLogEntryWithUser {
    #[serde(flatten)]
    pub entry: AuditLogEntry,
    pub user: PublicUser,
}

#[derive(Debug, Deserialize)]
pub struct AuditLogQuery {
    pub action: Option<AuditAction>,
    pub user_id: Option<Uuid>,
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

// ── Webhooks ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Webhook {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Uuid,
    pub creator_id: Uuid,
    pub name: String,
    pub avatar_url: Option<String>,
    pub token: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWebhookRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWebhookRequest {
    pub name: Option<String>,
    pub channel_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteWebhookRequest {
    pub content: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
}

// ── Soundboard ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SoundboardSound {
    pub id: Uuid,
    pub server_id: Uuid,
    pub uploader_id: Uuid,
    pub name: String,
    pub audio_url: String,
    pub duration_ms: i32,
    pub emoji_name: Option<String>,
    pub volume: f32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SetJoinSoundRequest {
    pub sound_id: Uuid,
}
