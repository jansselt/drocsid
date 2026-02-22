import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useServerStore } from '../../stores/serverStore';
import { invalidateDeviceCache } from '../../utils/audioDevices';
import { SoundboardPanel } from './SoundboardPanel';
import './VoicePanel.css';

interface NativeVoicePanelProps {
  token: string;
  url: string;
  channelName: string;
  compact?: boolean;
}

interface ParticipantInfo {
  identity: string;
  name?: string;
  muted: boolean;
}

const VOLUMES_KEY = 'drocsid_user_volumes';

function loadSavedVolumes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VOLUMES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveVolumes(volumes: Record<string, number>) {
  localStorage.setItem(VOLUMES_KEY, JSON.stringify(volumes));
}

export function NativeVoicePanel({ token, url, channelName, compact }: NativeVoicePanelProps) {
  const voiceToggleMute = useServerStore((s) => s.voiceToggleMute);
  const voiceToggleDeaf = useServerStore((s) => s.voiceToggleDeaf);
  const voiceLeave = useServerStore((s) => s.voiceLeave);
  const voiceSelfMute = useServerStore((s) => s.voiceSelfMute);
  const voiceSelfDeaf = useServerStore((s) => s.voiceSelfDeaf);
  const users = useServerStore((s) => s.users);
  const setSpeakingUsers = useServerStore((s) => s.setSpeakingUsers);
  const speakingUsers = useServerStore((s) => s.speakingUsers);

  const activeServerId = useServerStore((s) => s.activeServerId);

  const [connectionState, setConnectionState] = useState<string>('connecting');
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [localIdentity, setLocalIdentity] = useState<string | null>(null);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const localIdentityRef = useRef<string | null>(null);

  // Per-user volume
  const [volumeMenu, setVolumeMenu] = useState<{ identity: string; x: number; y: number } | null>(null);
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>(loadSavedVolumes);
  const volumeMenuRef = useRef<HTMLDivElement>(null);

  // Speaking hold timers (anti-flicker)
  const speakingRef = useRef<Set<string>>(new Set());
  const holdTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const SPEAKING_HOLD_MS = 300;

  const updateSpeakingStore = useCallback((speaking: Set<string>) => {
    const prev = speakingRef.current;
    if (speaking.size !== prev.size || [...speaking].some((id) => !prev.has(id)) || [...prev].some((id) => !speaking.has(id))) {
      speakingRef.current = speaking;
      setSpeakingUsers(speaking);
    }
  }, [setSpeakingUsers]);

  // Track whether we intentionally disconnected (to ignore the resulting state event)
  const intentionalDisconnectRef = useRef(false);
  // Generation counter to handle StrictMode double-invocation and stale connects
  const connectGenRef = useRef(0);

  // Connect to native voice on mount
  useEffect(() => {
    const gen = ++connectGenRef.current;
    let connected = false;
    let abandoned = false;

    // Suppress disconnected events during connect (old session being replaced is expected)
    intentionalDisconnectRef.current = true;

    const connect = async () => {
      try {
        const micDeviceId = localStorage.getItem('drocsid_mic') || null;
        const speakerDeviceId = localStorage.getItem('drocsid_speaker') || null;

        await invoke('voice_connect', {
          url,
          token,
          micDeviceId,
          speakerDeviceId,
        });

        if (gen !== connectGenRef.current) {
          // A newer connect was issued (StrictMode or dep change).
          // The newer voice_connect already replaced our session in Rust.
          // Do NOT send voice_disconnect — it would kill the newer session.
          return;
        }

        if (abandoned) {
          // Component unmounted while we were connecting, and no re-mount happened.
          // Clean up the session we just created.
          invoke('voice_disconnect').catch(() => {});
          return;
        }

        connected = true;
        setConnectionState('connected');
        // Now connected — future disconnected events are unexpected (server kicked us)
        intentionalDisconnectRef.current = false;
      } catch (e) {
        console.error('[NativeVoicePanel] voice_connect failed:', e);
        if (gen === connectGenRef.current && !abandoned) {
          setConnectionState('disconnected');
        }
      }
    };

    connect();

    return () => {
      if (connected) {
        // Already connected — disconnect immediately
        intentionalDisconnectRef.current = true;
        invoke('voice_disconnect').catch(() => {});
        // Invalidate cached device list so next settings open re-enumerates
        // (safe since cpal streams are being torn down)
        invalidateDeviceCache();
      } else {
        // Connect still in progress — mark abandoned so callback handles it
        abandoned = true;
      }
    };
  }, [url, token]);

  // Listen for Tauri events from Rust
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      unlisteners.push(
        await listen<{ speakers: string[] }>('voice:active-speakers', (event) => {
          const nowSpeaking = new Set(event.payload.speakers);
          const next = new Set(speakingRef.current);

          // Add new speakers immediately
          for (const id of nowSpeaking) {
            const timer = holdTimersRef.current.get(id);
            if (timer) {
              clearTimeout(timer);
              holdTimersRef.current.delete(id);
            }
            next.add(id);
          }

          // Hold timer for speakers that stopped
          for (const id of speakingRef.current) {
            if (!nowSpeaking.has(id) && !holdTimersRef.current.has(id)) {
              holdTimersRef.current.set(id, setTimeout(() => {
                holdTimersRef.current.delete(id);
                const updated = new Set(speakingRef.current);
                updated.delete(id);
                updateSpeakingStore(updated);
              }, SPEAKING_HOLD_MS));
            }
          }

          updateSpeakingStore(next);
        })
      );

      unlisteners.push(
        await listen<{ identity: string; name?: string }>('voice:participant-joined', (event) => {
          setParticipants((prev) => {
            const next = new Map(prev);
            next.set(event.payload.identity, {
              identity: event.payload.identity,
              name: event.payload.name,
              muted: false,
            });
            return next;
          });
        })
      );

      unlisteners.push(
        await listen<{ identity: string }>('voice:participant-left', (event) => {
          setParticipants((prev) => {
            const next = new Map(prev);
            next.delete(event.payload.identity);
            return next;
          });
        })
      );

      unlisteners.push(
        await listen<{ state: string }>('voice:connection-state', (event) => {
          setConnectionState(event.payload.state);
          if (event.payload.state === 'disconnected') {
            invalidateDeviceCache();
            if (!intentionalDisconnectRef.current) {
              // Only leave the channel if the server disconnected us, not if we did it ourselves
              voiceLeave();
            }
          }
        })
      );

      unlisteners.push(
        await listen<{ identity: string; muted: boolean }>('voice:track-muted', (event) => {
          setParticipants((prev) => {
            const next = new Map(prev);
            const existing = next.get(event.payload.identity);
            if (existing) {
              next.set(event.payload.identity, { ...existing, muted: event.payload.muted });
            }
            return next;
          });
        })
      );

      // Local identity from Rust (for self-speaking indicator)
      unlisteners.push(
        await listen<string>('voice:local-identity', (event) => {
          localIdentityRef.current = event.payload;
          setLocalIdentity(event.payload);
        })
      );

      // Local mic level for self-speaking indicator
      const SPEAKING_THRESHOLD = 3.0;
      unlisteners.push(
        await listen<number>('voice:mic-level', (event) => {
          const id = localIdentityRef.current;
          if (!id) return;

          const level = event.payload;
          if (level > SPEAKING_THRESHOLD) {
            // Speaking — add immediately, cancel any pending removal
            const timer = holdTimersRef.current.get(id);
            if (timer) {
              clearTimeout(timer);
              holdTimersRef.current.delete(id);
            }
            if (!speakingRef.current.has(id)) {
              const next = new Set(speakingRef.current);
              next.add(id);
              updateSpeakingStore(next);
            }
          } else {
            // Silent — start hold timer if currently marked as speaking
            if (speakingRef.current.has(id) && !holdTimersRef.current.has(id)) {
              holdTimersRef.current.set(id, setTimeout(() => {
                holdTimersRef.current.delete(id);
                const updated = new Set(speakingRef.current);
                updated.delete(id);
                updateSpeakingStore(updated);
              }, SPEAKING_HOLD_MS));
            }
          }
        })
      );
    };

    setup();

    return () => {
      for (const unlisten of unlisteners) unlisten();
      for (const timer of holdTimersRef.current.values()) clearTimeout(timer);
      holdTimersRef.current.clear();
      setSpeakingUsers(new Set());
    };
  }, [updateSpeakingStore, setSpeakingUsers, voiceLeave]);

  // Sync mute state to Rust
  useEffect(() => {
    invoke('voice_set_mute', { muted: voiceSelfMute }).catch(() => {});
  }, [voiceSelfMute]);

  // Sync deaf state to Rust
  useEffect(() => {
    invoke('voice_set_deaf', { deaf: voiceSelfDeaf }).catch(() => {});
  }, [voiceSelfDeaf]);

  // Sync noise suppression setting to Rust
  useEffect(() => {
    // Apply initial value
    const initial = localStorage.getItem('drocsid_noise_suppression') !== 'false';
    invoke('voice_set_noise_suppression', { enabled: initial }).catch(() => {});

    // Listen for live changes from settings
    const handler = () => {
      const enabled = localStorage.getItem('drocsid_noise_suppression') !== 'false';
      invoke('voice_set_noise_suppression', { enabled }).catch(() => {});
    };
    window.addEventListener('drocsid-noise-suppression-changed', handler);
    return () => window.removeEventListener('drocsid-noise-suppression-changed', handler);
  }, []);

  // Push-to-talk
  const pttActiveRef = useRef(false);
  useEffect(() => {
    const pttEnabled = localStorage.getItem('drocsid_ptt_enabled') === 'true';
    if (!pttEnabled) return;

    const pttKey = localStorage.getItem('drocsid_ptt_key') || 'Space';

    // Start muted for PTT mode
    if (!useServerStore.getState().voiceSelfMute) {
      voiceToggleMute();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat || pttActiveRef.current) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      pttActiveRef.current = true;
      if (useServerStore.getState().voiceSelfMute) {
        voiceToggleMute();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey || !pttActiveRef.current) return;
      e.preventDefault();
      pttActiveRef.current = false;
      if (!useServerStore.getState().voiceSelfMute) {
        voiceToggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      pttActiveRef.current = false;
    };
  }, [voiceToggleMute]);

  // Close volume menu on outside click
  useEffect(() => {
    if (!volumeMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (volumeMenuRef.current && !volumeMenuRef.current.contains(e.target as Node)) {
        setVolumeMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [volumeMenu]);

  const handleParticipantContextMenu = useCallback((e: React.MouseEvent, identity: string) => {
    if (identity === localIdentity) return;
    e.preventDefault();
    setVolumeMenu({ identity, x: e.clientX, y: e.clientY });
  }, [localIdentity]);

  const setParticipantVolume = useCallback((identity: string, volume: number) => {
    setUserVolumes((prev) => {
      const next = { ...prev, [identity]: volume };
      if (volume === 100) delete next[identity];
      saveVolumes(next);
      return next;
    });
    invoke('voice_set_user_volume', { identity, volumePercent: volume }).catch(() => {});
  }, []);

  // Apply saved volumes when participants join
  useEffect(() => {
    const saved = loadSavedVolumes();
    for (const [identity] of participants) {
      if (saved[identity] !== undefined) {
        invoke('voice_set_user_volume', { identity, volumePercent: saved[identity] }).catch(() => {});
      }
    }
  }, [participants]);

  // Build participant list (include self)
  const allParticipants = Array.from(participants.values());

  return (
    <div className={`voice-panel ${compact ? 'compact' : ''}`}>
      <div className="voice-panel-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill={connectionState === 'connected' ? 'var(--success, #3ba55c)' : 'var(--text-muted)'}>
          <path d="M12 3a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1zM6.56 7.56a1 1 0 0 0-1.41 0C3.14 9.57 2 12.18 2 15a1 1 0 0 0 2 0c0-2.28.92-4.34 2.56-5.97a1 1 0 0 0 0-1.41zM18.85 7.56a1 1 0 0 0-1.41 1.41C19.08 10.66 20 12.72 20 15a1 1 0 0 0 2 0c0-2.82-1.14-5.43-3.15-7.44zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
        </svg>
        <span className="voice-panel-title">{channelName}</span>
        {connectionState === 'reconnecting' && (
          <span className="voice-panel-status">Reconnecting...</span>
        )}
      </div>

      {/* Participant list */}
      <div className="voice-participants">
        {allParticipants.map((p) => {
          const user = users.get(p.identity);
          const isSpeaking = speakingUsers.has(p.identity);
          const isLocal = p.identity === localIdentity;
          const customVolume = userVolumes[p.identity];
          return (
            <div
              key={p.identity}
              className={`voice-participant ${isSpeaking ? 'speaking' : ''}`}
              onContextMenu={(e) => handleParticipantContextMenu(e, p.identity)}
            >
              <div className={`voice-participant-avatar ${isSpeaking ? 'speaking' : ''}`}>
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" />
                ) : (
                  (user?.username || p.name || '?').charAt(0).toUpperCase()
                )}
              </div>
              <span className="voice-participant-name">
                {user?.username || p.name || p.identity}
              </span>
              {!isLocal && customVolume !== undefined && customVolume !== 100 && (
                <span className="voice-participant-volume">{customVolume}%</span>
              )}
              {p.muted && (
                <svg className="voice-participant-muted" width="14" height="14" viewBox="0 0 24 24" fill="var(--text-muted)">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                </svg>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-user volume menu */}
      {volumeMenu && (() => {
        const user = users.get(volumeMenu.identity);
        const volume = userVolumes[volumeMenu.identity] ?? 100;
        return (
          <div
            ref={volumeMenuRef}
            className="voice-user-menu"
            style={{ top: volumeMenu.y, left: volumeMenu.x }}
          >
            <div className="voice-user-menu-name">
              {user?.username || volumeMenu.identity}
            </div>
            <label className="voice-user-menu-label">
              User Volume
            </label>
            <div className="voice-user-menu-slider">
              <input
                type="range"
                min={0}
                max={200}
                value={volume}
                onChange={(e) => setParticipantVolume(volumeMenu.identity, Number(e.target.value))}
              />
              <span className="voice-user-menu-value">{volume}%</span>
            </div>
            {volume !== 100 && (
              <button
                className="voice-user-menu-reset"
                onClick={() => setParticipantVolume(volumeMenu.identity, 100)}
              >
                Reset Volume
              </button>
            )}
          </div>
        );
      })()}

      {/* Bottom controls */}
      <div className="voice-panel-controls">
        <button
          className={`voice-panel-btn ${voiceSelfMute ? 'active' : ''}`}
          onClick={() => voiceToggleMute()}
          title={voiceSelfMute ? 'Unmute' : 'Mute'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            {voiceSelfMute ? (
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            ) : (
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            )}
          </svg>
        </button>
        <button
          className={`voice-panel-btn ${voiceSelfDeaf ? 'active' : ''}`}
          onClick={() => voiceToggleDeaf()}
          title={voiceSelfDeaf ? 'Undeafen' : 'Deafen'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            {voiceSelfDeaf ? (
              <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12z" />
            ) : (
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            )}
          </svg>
        </button>
        <button
          className={`voice-panel-btn ${showSoundboard ? 'active-on' : ''}`}
          onClick={() => setShowSoundboard(!showSoundboard)}
          title="Soundboard"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </button>
        <button
          className="voice-panel-btn disconnect"
          onClick={voiceLeave}
          title="Disconnect"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.69 8.68 7.65 7 12 7s8.31 1.68 11.71 4.72c.38.37.38.98 0 1.36l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>
      {showSoundboard && activeServerId && (
        <SoundboardPanel
          serverId={activeServerId}
          onClose={() => setShowSoundboard(false)}
        />
      )}
    </div>
  );
}
