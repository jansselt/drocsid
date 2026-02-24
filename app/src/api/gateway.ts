import { GatewayOpcode, type GatewayPayload, type ReadyPayload } from '../types';
import { getAccessToken } from './client';

import { getWsUrl } from './instance';

type EventHandler = (event: string, data: unknown) => void;

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private jitterTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence: number | null = null;
  private reconnectAttempts = 0;
  private handlers: EventHandler[] = [];
  private intentionalClose = false;

  onReady: ((data: ReadyPayload) => void) | null = null;

  connect() {
    const token = getAccessToken();
    if (!token) return;

    this.intentionalClose = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws = new WebSocket(`${getWsUrl()}/gateway`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const payload: GatewayPayload = JSON.parse(event.data);
      this.handlePayload(payload);
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.sequence = null;
  }

  addHandler(handler: EventHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private handlePayload(payload: GatewayPayload) {
    switch (payload.op) {
      case GatewayOpcode.Hello: {
        const { heartbeat_interval } = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(heartbeat_interval);
        this.sendIdentify();
        break;
      }
      case GatewayOpcode.Dispatch: {
        if (payload.s != null) {
          this.sequence = payload.s;
        }
        if (payload.t === 'READY') {
          const data = payload.d as ReadyPayload;
          this.onReady?.(data);
        }
        if (payload.t) {
          for (const handler of this.handlers) {
            handler(payload.t, payload.d);
          }
        }
        break;
      }
      case GatewayOpcode.HeartbeatAck:
        // Connection is alive
        break;
      case GatewayOpcode.Reconnect:
        this.ws?.close();
        break;
      case GatewayOpcode.InvalidSession: {
        const resumable = payload.d as boolean;
        if (!resumable) {
          this.sequence = null;
        }
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1000 + Math.random() * 4000);
        break;
      }
    }
  }

  private sendIdentify() {
    const token = getAccessToken();
    if (!token) return;

    this.send({
      op: GatewayOpcode.Identify,
      d: { token },
    });
  }

  private startHeartbeat(intervalMs: number) {
    this.stopHeartbeat();
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * intervalMs;
    this.jitterTimer = setTimeout(() => {
      this.jitterTimer = null;
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
      }, intervalMs);
    }, jitter);
  }

  private stopHeartbeat() {
    if (this.jitterTimer) {
      clearTimeout(this.jitterTimer);
      this.jitterTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendHeartbeat() {
    this.send({
      op: GatewayOpcode.Heartbeat,
      d: this.sequence,
    });
  }

  sendPresenceUpdate(status: string) {
    this.send({
      op: GatewayOpcode.PresenceUpdate,
      d: { status },
    });
  }

  private send(payload: GatewayPayload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// Singleton instance
export const gateway = new GatewayConnection();
