// Mirrors server/src/types/ — manual sync

// ── Users ──────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  status: string;
  custom_status: string | null;
  timezone: string | null;
  theme_preference?: string;
  is_admin?: boolean;
  bot: boolean;
}

export type PublicUser = User;

export interface RegistrationCode {
  id: string;
  code: string;
  creator_id: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

// ── Custom Themes ─────────────────────────────────────

export interface CustomTheme {
  id: string;
  user_id: string;
  name: string;
  colors: Record<string, string>;
  created_at: string;
  updated_at: string;
}

// ── Bookmarks ─────────────────────────────────────────

export interface Bookmark {
  message_id: string;
  tags: string[];
  note: string | null;
  bookmarked_at: string;
  // Flattened message fields
  id: string;
  instance_id: string;
  channel_id: string;
  author_id: string | null;
  content: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  pinned: boolean;
  created_at: string;
  // Author info
  author: User | null;
  // Context
  channel_name: string | null;
  server_id: string | null;
  server_name: string | null;
}

// ── Servers ────────────────────────────────────────────

export interface Server {
  id: string;
  instance_id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  banner_position: number;
  owner_id: string;
  default_channel_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Channels ───────────────────────────────────────────

export type ChannelType = 'text' | 'voice' | 'category' | 'dm' | 'groupdm';

export interface Channel {
  id: string;
  instance_id: string;
  server_id: string | null;
  parent_id: string | null;
  channel_type: ChannelType;
  name: string | null;
  topic: string | null;
  position: number;
  last_message_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Read States ─────────────────────────────────────────

export interface ReadState {
  channel_id: string;
  last_read_message_id: string | null;
  mention_count: number;
}

// ── Notification Preferences ────────────────────────────

export type NotificationLevel = 'all' | 'mentions' | 'nothing';

export interface NotificationPreference {
  target_id: string;
  target_type: 'channel' | 'server';
  notification_level: NotificationLevel;
  muted: boolean;
}

// ── Messages ───────────────────────────────────────────

export interface Message {
  id: string;
  instance_id: string;
  channel_id: string;
  author_id: string | null;
  content: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  pinned: boolean;
  created_at: string;
  // Populated by MESSAGE_CREATE event
  author?: User;
  // Populated by get_messages API response
  reactions?: ReactionGroup[];
}

// ── Server Members ─────────────────────────────────────

export interface ServerMember {
  server_id: string;
  user_id: string;
  nickname: string | null;
  joined_at: string;
}

// ── Roles ─────────────────────────────────────────────

export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  permissions: number;
  mentionable: boolean;
  is_default: boolean;
  created_at: string;
}

// ── Channel Overrides ─────────────────────────────────

export interface ChannelOverride {
  id: string;
  channel_id: string;
  target_type: string;
  target_id: string;
  allow: number;
  deny: number;
}

// ── Attachments ──────────────────────────────────────

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  url: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

// ── Reactions ────────────────────────────────────────

export interface ReactionGroup {
  emoji_name: string;
  emoji_id: string | null;
  count: number;
  me: boolean;
}

// ── Upload ───────────────────────────────────────────

export interface UploadUrlResponse {
  upload_url: string;
  file_url: string;
  attachment_id: string;
}

// ── Auth ───────────────────────────────────────────────

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

// ── Gateway ────────────────────────────────────────────

export const GatewayOpcode = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

export interface ReadyPayload {
  session_id: string;
  user: User;
  servers: Server[];
  read_states: ReadState[];
  notification_preferences?: NotificationPreference[];
  bookmarked_message_ids?: string[];
}

export interface MessageAckEvent {
  channel_id: string;
  message_id: string;
}

export interface MessageCreateEvent extends Message {
  author: User;
}

export interface ServerMemberAddEvent {
  server_id: string;
  member: ServerMember;
  user: User;
}

export interface ServerMemberRemoveEvent {
  server_id: string;
  user_id: string;
}

export interface RoleCreateEvent extends Role {
  server_id: string;
}

export interface RoleUpdateEvent extends Role {
  server_id: string;
}

export interface RoleDeleteEvent {
  server_id: string;
  role_id: string;
}

export interface MemberRoleUpdateEvent {
  server_id: string;
  user_id: string;
  role_ids: string[];
}

export interface ChannelOverrideUpdateEvent {
  server_id: string;
  channel_id: string;
  overrides: ChannelOverride[];
}

export interface MessageUpdateEvent extends Message {
  attachments: Attachment[];
  reactions: ReactionGroup[];
}

export interface MessageDeleteEvent {
  id: string;
  channel_id: string;
  server_id: string | null;
}

export interface ReactionAddEvent {
  message_id: string;
  channel_id: string;
  user_id: string;
  emoji_name: string;
  emoji_id: string | null;
}

export interface ReactionRemoveEvent {
  message_id: string;
  channel_id: string;
  user_id: string;
  emoji_name: string;
}

export interface MessagePinEvent {
  channel_id: string;
  message_id: string;
  pinned: boolean;
}

// ── Presence ────────────────────────────────────────

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface PresenceUpdateEvent {
  user_id: string;
  status: string;
  custom_status: string | null;
}

// ── Enriched Members ────────────────────────────────

export interface ServerMemberWithUser {
  server_id: string;
  user_id: string;
  nickname: string | null;
  joined_at: string;
  user: User;
  status: string;
  role_ids: string[];
}

// ── Relationships ───────────────────────────────────

export type RelationshipType = 'friend' | 'blocked' | 'pending_outgoing' | 'pending_incoming';

export interface Relationship {
  user_id: string;
  target_id: string;
  rel_type: RelationshipType;
  created_at: string;
}

export interface RelationshipWithUser extends Relationship {
  user: User;
}

// ── Threads ─────────────────────────────────────────

export interface ThreadMetadata {
  channel_id: string;
  parent_channel_id: string;
  starter_message_id: string | null;
  archived: boolean;
  locked: boolean;
  message_count: number;
  created_at: string;
}

// ── Search ──────────────────────────────────────────

export interface SearchResult {
  id: string;
  instance_id: string;
  channel_id: string;
  author_id: string | null;
  content: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  pinned: boolean;
  created_at: string;
  rank: number;
}

// ── DM/Relationship Gateway Events ──────────────────

export interface DmChannelCreateEvent {
  channel: Channel;
  recipients: User[];
}

export interface RelationshipUpdateEvent {
  user_id: string;
  target_id: string;
  rel_type: RelationshipType | null;
}

export interface ThreadCreateEvent {
  channel: Channel;
  metadata: ThreadMetadata;
  parent_channel_id: string;
  server_id: string | null;
}

export interface TypingStartEvent {
  channel_id: string;
  user_id: string;
  timestamp: number;
}

// ── Voice ───────────────────────────────────────────

export interface VoiceTokenResponse {
  token: string;
  url: string;
}

export interface VoiceState {
  user_id: string;
  channel_id: string;
  self_mute: boolean;
  self_deaf: boolean;
}

export interface VoiceStateUpdateEvent {
  server_id: string;
  channel_id: string | null;
  user_id: string;
  self_mute: boolean;
  self_deaf: boolean;
}

// ── Invites ─────────────────────────────────────────────

export interface Invite {
  id: string;
  server_id: string;
  channel_id: string | null;
  creator_id: string;
  code: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

export interface InviteResolve {
  code: string;
  server: {
    id: string;
    name: string;
    icon_url: string | null;
    description: string | null;
  };
}

// ── Bans ────────────────────────────────────────────────

export interface Ban {
  server_id: string;
  user_id: string;
  moderator_id: string;
  reason: string | null;
  created_at: string;
  user: PublicUser;
}

// ── Audit Log ───────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  server_id: string;
  user_id: string;
  action: string;
  target_id: string | null;
  reason: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
  user: PublicUser;
}

// ── Webhooks ────────────────────────────────────────────

export interface Webhook {
  id: string;
  server_id: string;
  channel_id: string;
  creator_id: string;
  name: string;
  avatar_url: string | null;
  token: string;
  created_at: string;
}

// ── GIFs ────────────────────────────────────────────────

export interface GifItem {
  id: string;
  title: string;
  url: string;
  mp4: string | null;
  width: number;
  height: number;
  preview_url: string;
  preview_width: number;
  preview_height: number;
}

export interface GifSearchResponse {
  gifs: GifItem[];
  total: number;
  provider: string;
}

// ── Link Preview ────────────────────────────────────────

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

// ── Soundboard ──────────────────────────────────────────

export interface SoundboardSound {
  id: string;
  server_id: string;
  uploader_id: string;
  name: string;
  audio_url: string;
  duration_ms: number;
  emoji_name: string | null;
  volume: number;
  created_at: string;
}

export interface SoundboardPlayEvent {
  server_id: string;
  channel_id: string;
  sound_id: string;
  audio_url: string;
  volume: number;
  user_id: string;
}

export interface SoundboardSoundCreateEvent extends SoundboardSound {
  server_id: string;
}

export interface SoundboardSoundDeleteEvent {
  server_id: string;
  sound_id: string;
}

// ── Permission Constants ──────────────────────────────

export const Permissions = {
  CREATE_INSTANT_INVITE: 1 << 0,
  KICK_MEMBERS: 1 << 1,
  BAN_MEMBERS: 1 << 2,
  ADMINISTRATOR: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_SERVER: 1 << 5,
  ADD_REACTIONS: 1 << 6,
  VIEW_AUDIT_LOG: 1 << 7,
  VIEW_CHANNEL: 1 << 10,
  SEND_MESSAGES: 1 << 11,
  MANAGE_MESSAGES: 1 << 13,
  EMBED_LINKS: 1 << 14,
  ATTACH_FILES: 1 << 15,
  READ_MESSAGE_HISTORY: 1 << 16,
  MENTION_EVERYONE: 1 << 17,
  USE_EXTERNAL_EMOJIS: 1 << 18,
  CONNECT: 1 << 20,
  SPEAK: 1 << 21,
  MUTE_MEMBERS: 1 << 22,
  DEAFEN_MEMBERS: 1 << 23,
  MOVE_MEMBERS: 1 << 24,
  CHANGE_NICKNAME: 1 << 26,
  MANAGE_NICKNAMES: 1 << 27,
  MANAGE_ROLES: 1 << 28,
  MANAGE_WEBHOOKS: 1 << 29,
  MANAGE_EXPRESSIONS: 1 << 30,
  USE_SOUNDBOARD: 2 ** 42,
  MANAGE_SOUNDBOARD: 2 ** 43,
} as const;

export const PermissionLabels: Record<number, string> = {
  [Permissions.CREATE_INSTANT_INVITE]: 'Create Invite',
  [Permissions.KICK_MEMBERS]: 'Kick Members',
  [Permissions.BAN_MEMBERS]: 'Ban Members',
  [Permissions.ADMINISTRATOR]: 'Administrator',
  [Permissions.MANAGE_CHANNELS]: 'Manage Channels',
  [Permissions.MANAGE_SERVER]: 'Manage Server',
  [Permissions.ADD_REACTIONS]: 'Add Reactions',
  [Permissions.VIEW_AUDIT_LOG]: 'View Audit Log',
  [Permissions.VIEW_CHANNEL]: 'View Channel',
  [Permissions.SEND_MESSAGES]: 'Send Messages',
  [Permissions.MANAGE_MESSAGES]: 'Manage Messages',
  [Permissions.EMBED_LINKS]: 'Embed Links',
  [Permissions.ATTACH_FILES]: 'Attach Files',
  [Permissions.READ_MESSAGE_HISTORY]: 'Read Message History',
  [Permissions.MENTION_EVERYONE]: 'Mention Everyone',
  [Permissions.USE_EXTERNAL_EMOJIS]: 'Use External Emojis',
  [Permissions.CONNECT]: 'Connect (Voice)',
  [Permissions.SPEAK]: 'Speak (Voice)',
  [Permissions.MUTE_MEMBERS]: 'Mute Members',
  [Permissions.DEAFEN_MEMBERS]: 'Deafen Members',
  [Permissions.MOVE_MEMBERS]: 'Move Members',
  [Permissions.CHANGE_NICKNAME]: 'Change Nickname',
  [Permissions.MANAGE_NICKNAMES]: 'Manage Nicknames',
  [Permissions.MANAGE_ROLES]: 'Manage Roles',
  [Permissions.MANAGE_WEBHOOKS]: 'Manage Webhooks',
  [Permissions.MANAGE_EXPRESSIONS]: 'Manage Expressions',
  [Permissions.USE_SOUNDBOARD]: 'Use Soundboard',
  [Permissions.MANAGE_SOUNDBOARD]: 'Manage Soundboard',
};
