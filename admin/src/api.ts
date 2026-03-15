const BASE = '/api/v1/admin/dashboard';

let authToken: string | null = localStorage.getItem('drocsid_admin_token');

export function setToken(token: string) {
  authToken = token;
  localStorage.setItem('drocsid_admin_token', token);
}

export function getToken(): string | null {
  return authToken;
}

export function clearToken() {
  authToken = null;
  localStorage.removeItem('drocsid_admin_token');
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearToken();
      throw new Error('Unauthorized');
    }
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// --- Types ---

export interface ServerHealth {
  uptime_secs: number;
  connected_sessions: number;
  connected_users: number;
  voice_channels_active: number;
  voice_users: number;
  db_pool_size: number;
  db_pool_idle: number;
  redis_connected: boolean;
  s3_configured: boolean;
  livekit_configured: boolean;
  memory_rss_kb: number | null;
}

export interface LiveKitRoom {
  name: string;
  num_participants: number;
  num_publishers: number;
  creation_time: number;
  metadata: string;
}

export interface TrackInfo {
  sid: string;
  name: string;
  source: string;
  track_type: string;
  muted: boolean;
  width: number;
  height: number;
}

export interface ParticipantInfo {
  identity: string;
  name: string;
  state: string;
  joined_at: number;
  tracks: TrackInfo[];
  is_publisher: boolean;
}

export interface RoomDetail {
  room: LiveKitRoom;
  participants: ParticipantInfo[];
}

export interface VoiceState {
  user_id: string;
  channel_id: string;
  server_id: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  audio_sharing: boolean;
}

// --- API Calls ---

export const api = {
  health: () => fetchApi<ServerHealth>('/health'),
  livekitRooms: () => fetchApi<LiveKitRoom[]>('/livekit/rooms'),
  livekitRoomDetail: (name: string) => fetchApi<RoomDetail>(`/livekit/rooms/${encodeURIComponent(name)}`),
  gatewayVoice: () => fetchApi<VoiceState[]>('/gateway/voice'),
};

// --- Log WebSocket ---

export function connectLogStream(
  onMessage: (line: string) => void,
  onError?: (err: Event) => void,
  level?: string,
): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = `${proto}//${location.host}/api/v1/admin/dashboard/logs/stream`;
  const params = new URLSearchParams();
  if (authToken) params.set('token', authToken);
  if (level) params.set('level', level);
  if (params.toString()) url += `?${params}`;

  const ws = new WebSocket(url);
  ws.onmessage = (e) => onMessage(e.data);
  ws.onerror = (e) => onError?.(e);
  return ws;
}
