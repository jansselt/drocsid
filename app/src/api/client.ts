import type {
  AuthResponse, TokenResponse, Server, Channel, Message, Role, ChannelOverride,
  UploadUrlResponse, RelationshipWithUser, SearchResult, ThreadMetadata, User,
  VoiceTokenResponse, VoiceState, Invite, InviteResolve, Ban, AuditLogEntry,
  Webhook, GifSearchResponse, ServerMemberWithUser, RegistrationCode,
  NotificationPreference, NotificationLevel, LinkPreviewData,
  SoundboardSound, CustomTheme, Bookmark, ScheduledMessage, ChannelLink, Poll,
} from '../types';
import type { PollType } from '../types';

import { getApiUrl } from './instance';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// Margin before expiry to trigger proactive refresh (5 minutes)
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Decode JWT payload without verification (just to read expiry) */
function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null; // convert to ms
  } catch {
    return null;
  }
}

function scheduleProactiveRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!accessToken || !refreshToken) return;

  const expiry = getTokenExpiry(accessToken);
  if (!expiry) return;

  const delay = expiry - Date.now() - REFRESH_MARGIN_MS;
  if (delay <= 0) {
    // Already near expiry — refresh immediately
    refreshAccessToken().catch(() => {});
    return;
  }

  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshAccessToken().catch(() => {});
  }, delay);
}

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
  scheduleProactiveRefresh();
}

export function loadTokens(): boolean {
  accessToken = localStorage.getItem('access_token');
  refreshToken = localStorage.getItem('refresh_token');
  if (accessToken) scheduleProactiveRefresh();
  return !!accessToken;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Check if the current access token is expired or about to expire */
export function isTokenExpired(): boolean {
  if (!accessToken) return true;
  const expiry = getTokenExpiry(accessToken);
  if (!expiry) return true;
  return Date.now() >= expiry - 30_000; // 30s grace
}

/** Try to ensure we have a valid access token. Returns true if token is valid. */
export async function ensureValidToken(): Promise<boolean> {
  if (!accessToken) return false;
  if (!isTokenExpired()) return true;
  return refreshAccessToken();
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && refreshToken) {
    // Try refreshing the token
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      const retryResponse = await fetch(`${getApiUrl()}${path}`, {
        ...options,
        headers,
      });
      if (!retryResponse.ok) {
        throw new ApiError(retryResponse.status, await retryResponse.json());
      }
      return retryResponse.json();
    }
    throw new ApiError(401, { error: 'Session expired' });
  }

  if (!response.ok) {
    throw new ApiError(response.status, await response.json());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${getApiUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      clearTokens();
      return false;
    }

    const data: TokenResponse = await response.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export class ApiError extends Error {
  status: number;
  data: { error: string; code?: number };

  constructor(status: number, data: { error: string; code?: number }) {
    super(data.error);
    this.status = status;
    this.data = data;
  }
}

// ── Auth ───────────────────────────────────────────────

export async function register(username: string, email: string, password: string, inviteCode?: string): Promise<AuthResponse> {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password, invite_code: inviteCode || undefined }),
  });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe() {
  return request<AuthResponse['user']>('/users/@me');
}

// ── Password Reset ────────────────────────────────────

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

// ── Servers ────────────────────────────────────────────

export async function createServer(name: string, description?: string): Promise<Server> {
  return request('/servers', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function getServer(serverId: string): Promise<Server> {
  return request(`/servers/${serverId}`);
}

export async function getServerChannels(serverId: string): Promise<Channel[]> {
  return request(`/servers/${serverId}/channels`);
}

export async function getServerMembers(serverId: string): Promise<ServerMemberWithUser[]> {
  return request(`/servers/${serverId}/members`);
}

export async function updateMe(data: {
  status?: string;
  custom_status?: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  theme_preference?: string;
  timezone?: string;
}): Promise<User> {
  return request('/users/@me', { method: 'PATCH', body: JSON.stringify(data) });
}

export async function uploadAvatar(
  file: File,
): Promise<{ file_url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  return request('/users/@me/avatar', { method: 'POST', body: formData });
}

export async function updateServer(
  serverId: string,
  data: { name?: string; description?: string; icon_url?: string; banner_url?: string; banner_position?: number },
): Promise<Server> {
  return request(`/servers/${serverId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function uploadServerIcon(
  serverId: string,
  file: File,
): Promise<{ file_url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  return request(`/servers/${serverId}/icon`, { method: 'POST', body: formData });
}

export async function uploadServerBanner(
  serverId: string,
  file: File,
): Promise<{ file_url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  return request(`/servers/${serverId}/banner`, { method: 'POST', body: formData });
}

export async function joinServer(serverId: string): Promise<void> {
  return request(`/servers/${serverId}/members/@me`, { method: 'POST' });
}

export async function leaveServer(serverId: string): Promise<void> {
  return request(`/servers/${serverId}/members/@me`, { method: 'DELETE' });
}

// ── Channels ───────────────────────────────────────────

export async function getMessages(
  channelId: string,
  options?: { before?: string; after?: string; limit?: number },
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (options?.before) params.set('before', options.before);
  if (options?.after) params.set('after', options.after);
  if (options?.limit) params.set('limit', String(options.limit));

  const query = params.toString();
  return request(`/channels/${channelId}/messages${query ? `?${query}` : ''}`);
}

export async function sendMessage(
  channelId: string,
  content: string,
  replyToId?: string,
): Promise<Message> {
  return request(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, reply_to_id: replyToId }),
  });
}

export async function createChannel(
  serverId: string,
  name: string,
  channelType?: string,
  topic?: string,
): Promise<Channel> {
  return request(`/servers/${serverId}/channels`, {
    method: 'POST',
    body: JSON.stringify({ name, channel_type: channelType, topic }),
  });
}

export async function updateChannel(
  channelId: string,
  data: { name?: string; topic?: string },
): Promise<Channel> {
  return request(`/channels/${channelId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteChannel(channelId: string): Promise<void> {
  return request(`/channels/${channelId}`, { method: 'DELETE' });
}

// ── Read State / Ack ─────────────────────────────────

export async function ackChannel(channelId: string, messageId: string): Promise<void> {
  return request(`/channels/${channelId}/ack`, {
    method: 'PUT',
    body: JSON.stringify({ message_id: messageId }),
  });
}

// ── Message Edit / Delete ─────────────────────────────

export async function editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
  return request(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  return request(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
}

// ── Reactions ─────────────────────────────────────────

export async function addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  return request(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'PUT',
  });
}

export async function removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  return request(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
  });
}

// ── Pins ──────────────────────────────────────────────

export async function pinMessage(channelId: string, messageId: string): Promise<void> {
  return request(`/channels/${channelId}/messages/${messageId}/pin`, { method: 'PUT' });
}

export async function unpinMessage(channelId: string, messageId: string): Promise<void> {
  return request(`/channels/${channelId}/messages/${messageId}/pin`, { method: 'DELETE' });
}

export async function getPinnedMessages(channelId: string): Promise<Message[]> {
  return request(`/channels/${channelId}/pins`);
}

// ── File Upload ───────────────────────────────────────

export async function uploadChannelFile(
  channelId: string,
  file: File,
): Promise<UploadUrlResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return request(`/channels/${channelId}/upload`, { method: 'POST', body: formData });
}

// ── Roles ─────────────────────────────────────────────

export async function getServerRoles(serverId: string): Promise<Role[]> {
  return request(`/servers/${serverId}/roles`);
}

export async function createRole(
  serverId: string,
  name: string,
  options?: { color?: number; hoist?: boolean; permissions?: number; mentionable?: boolean },
): Promise<Role> {
  return request(`/servers/${serverId}/roles`, {
    method: 'POST',
    body: JSON.stringify({ name, ...options }),
  });
}

export async function updateRole(
  serverId: string,
  roleId: string,
  updates: { name?: string; color?: number; hoist?: boolean; position?: number; permissions?: number; mentionable?: boolean },
): Promise<Role> {
  return request(`/servers/${serverId}/roles/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteRole(serverId: string, roleId: string): Promise<void> {
  return request(`/servers/${serverId}/roles/${roleId}`, { method: 'DELETE' });
}

export async function getMemberRoles(serverId: string, userId: string): Promise<Role[]> {
  return request(`/servers/${serverId}/members/${userId}/roles`);
}

export async function assignRole(serverId: string, userId: string, roleId: string): Promise<void> {
  return request(`/servers/${serverId}/members/${userId}/roles/${roleId}`, { method: 'POST' });
}

export async function removeRole(serverId: string, userId: string, roleId: string): Promise<void> {
  return request(`/servers/${serverId}/members/${userId}/roles/${roleId}`, { method: 'DELETE' });
}

// ── Channel Overrides ─────────────────────────────────

export async function getChannelOverrides(channelId: string): Promise<ChannelOverride[]> {
  return request(`/channels/${channelId}/overrides`);
}

export async function setChannelOverride(
  channelId: string,
  targetType: string,
  targetId: string,
  allow: number,
  deny: number,
): Promise<ChannelOverride> {
  return request(`/channels/${channelId}/overrides/${targetType}/${targetId}`, {
    method: 'PUT',
    body: JSON.stringify({ allow, deny }),
  });
}

export async function deleteChannelOverride(
  channelId: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  return request(`/channels/${channelId}/overrides/${targetType}/${targetId}`, {
    method: 'DELETE',
  });
}

// ── DMs ──────────────────────────────────────────────

export async function getDmChannels(): Promise<Channel[]> {
  return request('/dms');
}

export async function createDm(recipientId: string): Promise<Channel> {
  return request('/dms', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: recipientId }),
  });
}

export async function createGroupDm(recipientIds: string[], name?: string): Promise<Channel> {
  return request('/dms/group', {
    method: 'POST',
    body: JSON.stringify({ recipient_ids: recipientIds, name }),
  });
}

export async function closeDm(channelId: string): Promise<void> {
  return request(`/dms/${channelId}`, { method: 'DELETE' });
}

export async function getDmRecipients(channelId: string): Promise<User[]> {
  return request(`/dms/${channelId}/recipients`);
}

export async function addGroupDmRecipients(
  channelId: string,
  recipientIds: string[],
): Promise<User[]> {
  return request(`/dms/${channelId}/recipients`, {
    method: 'PUT',
    body: JSON.stringify({ recipient_ids: recipientIds }),
  });
}

// ── User Search ─────────────────────────────────────

export async function searchUsers(query: string): Promise<User[]> {
  return request(`/users/search?q=${encodeURIComponent(query)}`);
}

// ── Relationships ────────────────────────────────────

export async function getRelationships(): Promise<RelationshipWithUser[]> {
  return request('/relationships');
}

export async function sendFriendRequest(targetId: string): Promise<RelationshipWithUser> {
  return request(`/relationships/${targetId}`, { method: 'PUT' });
}

export async function acceptFriendRequest(targetId: string): Promise<RelationshipWithUser> {
  return request(`/relationships/${targetId}/accept`, { method: 'POST' });
}

export async function blockUser(targetId: string): Promise<RelationshipWithUser> {
  return request(`/relationships/${targetId}/block`, { method: 'PUT' });
}

export async function removeRelationship(targetId: string): Promise<void> {
  return request(`/relationships/${targetId}`, { method: 'DELETE' });
}

// ── Threads ──────────────────────────────────────────

export async function createThread(
  channelId: string,
  name: string,
  messageId?: string,
): Promise<{ channel: Channel; metadata: ThreadMetadata }> {
  return request(`/channels/${channelId}/threads`, {
    method: 'POST',
    body: JSON.stringify({ name, message_id: messageId }),
  });
}

export async function getThreads(channelId: string): Promise<Channel[]> {
  return request(`/channels/${channelId}/threads`);
}

// ── Search ───────────────────────────────────────────

export async function searchMessages(
  query: string,
  options?: { channel_id?: string; server_id?: string; limit?: number; offset?: number },
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (options?.channel_id) params.set('channel_id', options.channel_id);
  if (options?.server_id) params.set('server_id', options.server_id);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  return request(`/search?${params}`);
}

// ── Typing ───────────────────────────────────────────

export async function sendTyping(channelId: string): Promise<void> {
  return request(`/channels/${channelId}/typing`, { method: 'POST' });
}

// ── Voice ───────────────────────────────────────────

export async function voiceJoin(
  channelId: string,
  selfMute = false,
  selfDeaf = false,
): Promise<VoiceTokenResponse> {
  return request(`/channels/${channelId}/voice/join`, {
    method: 'POST',
    body: JSON.stringify({ self_mute: selfMute, self_deaf: selfDeaf }),
  });
}

export async function voiceLeave(channelId: string): Promise<void> {
  return request(`/channels/${channelId}/voice/leave`, { method: 'POST' });
}

export async function voiceUpdateState(
  channelId: string,
  selfMute?: boolean,
  selfDeaf?: boolean,
  audioSharing?: boolean,
): Promise<void> {
  return request(`/channels/${channelId}/voice/state`, {
    method: 'PATCH',
    body: JSON.stringify({ self_mute: selfMute, self_deaf: selfDeaf, audio_sharing: audioSharing }),
  });
}

export async function voiceGetStates(channelId: string): Promise<VoiceState[]> {
  return request(`/channels/${channelId}/voice/states`);
}

// ── Invites ─────────────────────────────────────────

export async function createInvite(
  serverId: string,
  options?: { max_uses?: number; max_age_secs?: number },
): Promise<Invite> {
  return request(`/servers/${serverId}/invites`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

export async function getServerInvites(serverId: string): Promise<Invite[]> {
  return request(`/servers/${serverId}/invites`);
}

export async function resolveInvite(code: string): Promise<InviteResolve> {
  return request(`/invites/${code}`);
}

export async function useInvite(code: string): Promise<Server> {
  return request(`/invites/${code}`, { method: 'POST' });
}

export async function deleteInvite(serverId: string, code: string): Promise<void> {
  return request(`/servers/${serverId}/invites/${code}`, { method: 'DELETE' });
}

// ── Bans ────────────────────────────────────────────

export async function getServerBans(serverId: string): Promise<Ban[]> {
  return request(`/servers/${serverId}/bans`);
}

export async function banMember(
  serverId: string,
  userId: string,
  reason?: string,
): Promise<Ban> {
  return request(`/servers/${serverId}/bans/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ reason }),
  });
}

export async function unbanMember(serverId: string, userId: string): Promise<void> {
  return request(`/servers/${serverId}/bans/${userId}`, { method: 'DELETE' });
}

export async function kickMember(serverId: string, userId: string): Promise<void> {
  return request(`/servers/${serverId}/kick/${userId}`, { method: 'POST' });
}

// ── Audit Log ───────────────────────────────────────

export async function getAuditLog(
  serverId: string,
  options?: { action?: string; user_id?: string; before?: string; limit?: number },
): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (options?.action) params.set('action', options.action);
  if (options?.user_id) params.set('user_id', options.user_id);
  if (options?.before) params.set('before', options.before);
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return request(`/servers/${serverId}/audit-log${qs ? `?${qs}` : ''}`);
}

// ── Webhooks ────────────────────────────────────────

export async function getChannelWebhooks(channelId: string): Promise<Webhook[]> {
  return request(`/channels/${channelId}/webhooks`);
}

export async function createWebhook(channelId: string, name: string): Promise<Webhook> {
  return request(`/channels/${channelId}/webhooks`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateWebhook(channelId: string, webhookId: string, data: { name?: string; channel_id?: string }): Promise<Webhook> {
  return request(`/channels/${channelId}/webhooks/${webhookId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteWebhook(channelId: string, webhookId: string): Promise<void> {
  return request(`/channels/${channelId}/webhooks/${webhookId}`, { method: 'DELETE' });
}

export async function getServerWebhooks(serverId: string): Promise<Webhook[]> {
  return request(`/servers/${serverId}/webhooks`);
}

// ── GIFs ────────────────────────────────────────────

export async function gifSearch(query: string, limit = 25, offset = 0): Promise<GifSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) });
  return request(`/gif/search?${params}`);
}

export async function gifTrending(limit = 25, offset = 0): Promise<GifSearchResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request(`/gif/trending?${params}`);
}

// ── Link Unfurl ──────────────────────────────────

export async function unfurlUrl(url: string): Promise<LinkPreviewData> {
  return request(`/unfurl?url=${encodeURIComponent(url)}`);
}

// ── Bug Reports ──────────────────────────────────

export async function submitBugReport(
  title: string,
  description?: string,
  systemInfo?: string,
): Promise<{ number: number; url: string }> {
  return request('/bug-reports', {
    method: 'POST',
    body: JSON.stringify({ title, description, system_info: systemInfo }),
  });
}

// ── Account Deletion ──────────────────────────────

export async function deleteAccount(password: string): Promise<void> {
  return request('/users/@me', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}

// ── Admin: Registration Codes ─────────────────────

export async function getRegistrationCodes(): Promise<RegistrationCode[]> {
  return request('/admin/registration-codes');
}

export async function createRegistrationCode(
  options?: { max_uses?: number; max_age_secs?: number },
): Promise<RegistrationCode> {
  return request('/admin/registration-codes', {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

export async function deleteRegistrationCode(code: string): Promise<void> {
  return request(`/admin/registration-codes/${code}`, { method: 'DELETE' });
}

// ── Admin: User & Channel Management ─────────────────

export interface AdminUserInfo {
  id: string;
  username: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
  last_login: string | null;
}

export async function adminSearchUsers(query: string): Promise<AdminUserInfo[]> {
  return request(`/admin/users?q=${encodeURIComponent(query)}`);
}

export async function adminDeleteUser(userId: string): Promise<void> {
  return request(`/admin/users/${userId}`, { method: 'DELETE' });
}

export async function adminSetUserAdmin(userId: string, isAdmin: boolean): Promise<{ is_admin: boolean }> {
  return request(`/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_admin: isAdmin }),
  });
}

export async function adminPurgeChannel(channelId: string): Promise<{ purged: number }> {
  return request(`/admin/channels/${channelId}/messages`, { method: 'DELETE' });
}

// ── Notification Preferences ──────────────────────────

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  return request('/users/@me/notification-preferences');
}

export async function setNotificationPreference(
  targetId: string,
  targetType: 'channel' | 'server',
  notificationLevel: NotificationLevel,
  muted: boolean,
): Promise<NotificationPreference> {
  return request('/users/@me/notification-preferences', {
    method: 'PUT',
    body: JSON.stringify({
      target_id: targetId,
      target_type: targetType,
      notification_level: notificationLevel,
      muted,
    }),
  });
}

// ── Soundboard ──────────────────────────────────────────

export async function getSoundboardSounds(serverId: string): Promise<SoundboardSound[]> {
  return request(`/servers/${serverId}/soundboard`);
}

export async function uploadSoundboardSound(
  serverId: string,
  file: File,
  name: string,
  durationMs: number,
  emojiName?: string,
): Promise<SoundboardSound> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  formData.append('duration_ms', String(durationMs));
  if (emojiName) formData.append('emoji_name', emojiName);
  return request(`/servers/${serverId}/soundboard`, { method: 'POST', body: formData });
}

export async function deleteSoundboardSound(serverId: string, soundId: string): Promise<void> {
  return request(`/servers/${serverId}/soundboard/${soundId}`, { method: 'DELETE' });
}

export async function playSoundboardSound(serverId: string, soundId: string): Promise<void> {
  return request(`/servers/${serverId}/soundboard/${soundId}/play`, { method: 'POST' });
}

export async function setJoinSound(serverId: string, soundId: string): Promise<void> {
  return request(`/servers/${serverId}/soundboard/join-sound`, {
    method: 'PUT',
    body: JSON.stringify({ sound_id: soundId }),
  });
}

export async function clearJoinSound(serverId: string): Promise<void> {
  return request(`/servers/${serverId}/soundboard/join-sound`, { method: 'DELETE' });
}

// ── Custom Themes ─────────────────────────────────────

export async function getCustomThemes(): Promise<CustomTheme[]> {
  return request('/users/@me/themes');
}

export async function createCustomTheme(data: { name: string; colors: Record<string, string> }): Promise<CustomTheme> {
  return request('/users/@me/themes', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateCustomTheme(themeId: string, data: { name?: string; colors?: Record<string, string> }): Promise<CustomTheme> {
  return request(`/users/@me/themes/${themeId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteCustomTheme(themeId: string): Promise<void> {
  return request(`/users/@me/themes/${themeId}`, { method: 'DELETE' });
}

// ── Bookmarks ─────────────────────────────────────────

export async function getBookmarks(params?: {
  tag?: string;
  search?: string;
  before?: string;
  limit?: number;
}): Promise<Bookmark[]> {
  const sp = new URLSearchParams();
  if (params?.tag) sp.set('tag', params.tag);
  if (params?.search) sp.set('search', params.search);
  if (params?.before) sp.set('before', params.before);
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return request(`/users/@me/bookmarks${qs ? `?${qs}` : ''}`);
}

export async function addBookmark(
  messageId: string,
  data?: { tags?: string[]; note?: string },
): Promise<void> {
  return request(`/users/@me/bookmarks/${messageId}`, {
    method: 'PUT',
    body: JSON.stringify(data || {}),
  });
}

export async function updateBookmark(
  messageId: string,
  data: { tags?: string[]; note?: string },
): Promise<void> {
  return request(`/users/@me/bookmarks/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function removeBookmark(messageId: string): Promise<void> {
  return request(`/users/@me/bookmarks/${messageId}`, { method: 'DELETE' });
}

export async function getBookmarkTags(): Promise<string[]> {
  return request('/users/@me/bookmarks/tags');
}

// ── Scheduled Messages ────────────────────────────────

export async function createScheduledMessage(
  channelId: string,
  content: string,
  sendAt: string,
  replyToId?: string,
): Promise<ScheduledMessage> {
  return request(`/channels/${channelId}/scheduled-messages`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      reply_to_id: replyToId,
      send_at: sendAt,
    }),
  });
}

export async function getScheduledMessages(): Promise<ScheduledMessage[]> {
  return request('/users/@me/scheduled-messages');
}

export async function updateScheduledMessage(
  scheduledId: string,
  data: { content?: string; send_at?: string },
): Promise<ScheduledMessage> {
  return request(`/users/@me/scheduled-messages/${scheduledId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteScheduledMessage(
  scheduledId: string,
): Promise<void> {
  return request(`/users/@me/scheduled-messages/${scheduledId}`, {
    method: 'DELETE',
  });
}

// ── Channel Links ─────────────────────────────────────

export async function getChannelLinks(
  channelId: string,
  options?: { tag?: string; search?: string; limit?: number },
): Promise<ChannelLink[]> {
  const params = new URLSearchParams();
  if (options?.tag) params.set('tag', options.tag);
  if (options?.search) params.set('search', options.search);
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return request(`/channels/${channelId}/links${query ? `?${query}` : ''}`);
}

export async function getChannelLinkTags(
  channelId: string,
): Promise<string[]> {
  return request(`/channels/${channelId}/links/tags`);
}

export async function addChannelLink(
  channelId: string,
  url: string,
  tags?: string[],
  note?: string,
): Promise<ChannelLink> {
  return request(`/channels/${channelId}/links`, {
    method: 'POST',
    body: JSON.stringify({ url, tags, note }),
  });
}

export async function updateChannelLink(
  channelId: string,
  linkId: string,
  data: { tags?: string[]; note?: string },
): Promise<ChannelLink> {
  return request(`/channels/${channelId}/links/${linkId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteChannelLink(
  channelId: string,
  linkId: string,
): Promise<void> {
  return request(`/channels/${channelId}/links/${linkId}`, {
    method: 'DELETE',
  });
}

// ── Polls ─────────────────────────────────────────────

export async function createPoll(
  channelId: string,
  data: {
    question: string;
    options: { label: string }[];
    poll_type?: PollType;
    anonymous?: boolean;
    closes_at?: string;
  },
): Promise<Poll> {
  return request(`/channels/${channelId}/polls`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getPoll(
  channelId: string,
  pollId: string,
): Promise<Poll> {
  return request(`/channels/${channelId}/polls/${pollId}`);
}

export async function castVote(
  channelId: string,
  pollId: string,
  optionIds: string[],
): Promise<Poll> {
  return request(`/channels/${channelId}/polls/${pollId}/votes`, {
    method: 'POST',
    body: JSON.stringify({ option_ids: optionIds }),
  });
}

export async function retractVote(
  channelId: string,
  pollId: string,
): Promise<void> {
  return request(`/channels/${channelId}/polls/${pollId}/votes`, {
    method: 'DELETE',
  });
}

export async function closePoll(
  channelId: string,
  pollId: string,
): Promise<Poll> {
  return request(`/channels/${channelId}/polls/${pollId}/close`, {
    method: 'POST',
  });
}
