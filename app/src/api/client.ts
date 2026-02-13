import type {
  AuthResponse, TokenResponse, Server, Channel, Message, Role, ChannelOverride,
  UploadUrlResponse, RelationshipWithUser, SearchResult, ThreadMetadata, User,
  VoiceTokenResponse, VoiceState, Invite, InviteResolve, Ban, AuditLogEntry,
  Webhook, GifSearchResponse, ServerMemberWithUser,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
}

export function loadTokens(): boolean {
  accessToken = localStorage.getItem('access_token');
  refreshToken = localStorage.getItem('refresh_token');
  return !!accessToken;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && refreshToken) {
    // Try refreshing the token
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      const retryResponse = await fetch(`${API_URL}${path}`, {
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
    const response = await fetch(`${API_URL}/auth/refresh`, {
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

export async function register(username: string, email: string, password: string): Promise<AuthResponse> {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
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

export async function updateMe(data: { status?: string; custom_status?: string }): Promise<User> {
  return request('/users/@me', { method: 'PATCH', body: JSON.stringify(data) });
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

export async function requestUploadUrl(
  channelId: string,
  filename: string,
  contentType: string,
  sizeBytes: number,
): Promise<UploadUrlResponse> {
  return request(`/channels/${channelId}/upload`, {
    method: 'POST',
    body: JSON.stringify({ filename, content_type: contentType, size_bytes: sizeBytes }),
  });
}

export async function uploadFile(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
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

export async function getDmRecipients(channelId: string): Promise<User[]> {
  return request(`/dms/${channelId}/recipients`);
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
): Promise<void> {
  return request(`/channels/${channelId}/voice/state`, {
    method: 'PATCH',
    body: JSON.stringify({ self_mute: selfMute, self_deaf: selfDeaf }),
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

export async function deleteWebhook(channelId: string, webhookId: string): Promise<void> {
  return request(`/channels/${channelId}/webhooks/${webhookId}`, { method: 'DELETE' });
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
