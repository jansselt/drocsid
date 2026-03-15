const STORAGE_KEY = 'drocsid_instance_url';

// Default for local development (web mode)
const DEFAULT_INSTANCE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/v1$/, '')
  : 'http://localhost:8080';

let instanceUrl: string | null = null;

/** Whether we're running inside Electron (desktop app) */
export function isDesktop(): boolean {
  return !!(window as any).electronAPI;
}

/** @deprecated Use isDesktop() instead */
export const isTauri = isDesktop;

/** Whether we're on Linux (relevant for native voice — WebKit2GTK WebRTC is broken) */
export function isLinux(): boolean {
  return navigator.userAgent.includes('Linux') && !navigator.userAgent.includes('Android');
}

/** Get the configured instance URL, or null if none set (Tauri first-launch) */
export function getInstanceUrl(): string | null {
  if (instanceUrl) return instanceUrl;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    instanceUrl = stored;
    return instanceUrl;
  }

  // In web mode, always fall back to defaults so the app works without setup
  if (!isDesktop()) {
    instanceUrl = DEFAULT_INSTANCE;
    return instanceUrl;
  }

  // Desktop with no stored instance — needs setup
  return null;
}

/** Set the instance URL (called from instance picker or settings) */
export function setInstanceUrl(url: string) {
  // Normalize: strip trailing slash
  const normalized = url.replace(/\/+$/, '');
  instanceUrl = normalized;
  localStorage.setItem(STORAGE_KEY, normalized);
}

/** Clear the instance URL (for switching instances) */
export function clearInstanceUrl() {
  instanceUrl = null;
  localStorage.removeItem(STORAGE_KEY);
}

/** Whether an instance has been configured */
export function hasInstance(): boolean {
  return getInstanceUrl() !== null;
}

/** Get the REST API base URL (e.g. http://localhost:8080/api/v1) */
export function getApiUrl(): string {
  const base = getInstanceUrl() || DEFAULT_INSTANCE;
  return `${base}/api/v1`;
}

/** Get the WebSocket base URL (e.g. ws://localhost:8080) */
export function getWsUrl(): string {
  const base = getInstanceUrl() || DEFAULT_INSTANCE;
  // Convert http(s) to ws(s)
  return base.replace(/^http/, 'ws');
}

/** Validate an instance URL by hitting its health/info endpoint */
export async function validateInstance(url: string): Promise<boolean> {
  const normalized = url.replace(/\/+$/, '');
  try {
    const response = await fetch(`${normalized}/api/v1/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
