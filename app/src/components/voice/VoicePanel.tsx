import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { Track, RoomEvent, RemoteParticipant, type Participant } from 'livekit-client';
import { useServerStore } from '../../stores/serverStore';
import { isTauri } from '../../api/instance';
import { applyAudioOutputTauri, labelAudioStreamsTauri, createVoiceInputSink, destroyVoiceInputSink, getDefaultAudioSourceTauri, setDefaultAudioSourceTauri } from '../../utils/audioDevices';
import './VoicePanel.css';

export function VoicePanel({ compact }: { compact?: boolean } = {}) {
  const voiceToken = useServerStore((s) => s.voiceToken);
  const voiceUrl = useServerStore((s) => s.voiceUrl);
  const voiceChannelId = useServerStore((s) => s.voiceChannelId);
  const voiceLeave = useServerStore((s) => s.voiceLeave);
  const channels = useServerStore((s) => s.channels);

  // On Tauri/Linux, create a virtual PipeWire sink ("Drocsid Voice Sound In") for
  // optional advanced routing in qpwgraph. If the user selected a specific mic in
  // settings (including the virtual sink's monitor), set it as the default source
  // before LiveKit connects. Otherwise leave the default alone so the real mic works.
  const [sinkReady, setSinkReady] = useState(!isTauri());
  const savedDefaultSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauri() || !voiceToken) return;
    let cancelled = false;

    const setup = async () => {
      try {
        // Save the current default source so we can restore it on disconnect
        savedDefaultSourceRef.current = await getDefaultAudioSourceTauri();

        // Create the virtual null-sink (appears in qpwgraph as "Drocsid Voice Sound In")
        await createVoiceInputSink();

        // If user selected a specific mic in settings, set it as default source.
        // This works for both physical mics and drocsid_voice_in.monitor.
        // If nothing selected, leave the default unchanged (real mic works automatically).
        const selectedMic = localStorage.getItem('drocsid_mic');
        if (selectedMic) {
          await new Promise((r) => setTimeout(r, 300));
          await setDefaultAudioSourceTauri(selectedMic);
        }
      } catch (e) {
        console.warn('[VoicePanel] Tauri audio sink setup failed:', e);
      }
      if (!cancelled) setSinkReady(true);
    };

    setup();

    // Re-run when user changes mic in settings
    const handleMicChanged = () => {
      const mic = localStorage.getItem('drocsid_mic');
      if (mic) {
        setDefaultAudioSourceTauri(mic).catch(() => {});
      }
    };
    window.addEventListener('drocsid-mic-changed', handleMicChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('drocsid-mic-changed', handleMicChanged);
      // Restore previous default source and clean up the virtual sink
      const prev = savedDefaultSourceRef.current;
      if (prev) {
        setDefaultAudioSourceTauri(prev).catch(() => {});
      }
      destroyVoiceInputSink().catch(() => {});
    };
  }, [voiceToken]);

  // Read saved device selection for mic (web only — Tauri uses virtual sink monitor)
  const audioOptions = useMemo(() => {
    if (isTauri()) return true as const;
    const savedMic = localStorage.getItem('drocsid_mic');
    if (savedMic) return { deviceId: { exact: savedMic } } as MediaTrackConstraints;
    return true as const;
  }, []);

  if (!voiceToken || !voiceUrl || !voiceChannelId) return null;

  // Find channel name
  let channelName = 'Voice';
  for (const [, serverChannels] of channels) {
    const ch = serverChannels.find((c) => c.id === voiceChannelId);
    if (ch?.name) {
      channelName = ch.name;
      break;
    }
  }

  return (
    <LiveKitRoom
      token={voiceToken}
      serverUrl={voiceUrl}
      connect={sinkReady}
      audio={audioOptions}
      video={false}
      onDisconnected={() => voiceLeave()}
    >
      <VoicePanelContent channelName={channelName} compact={compact} />
    </LiveKitRoom>
  );
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

function VoicePanelContent({ channelName, compact }: { channelName: string; compact?: boolean }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const voiceToggleMute = useServerStore((s) => s.voiceToggleMute);
  const voiceToggleDeaf = useServerStore((s) => s.voiceToggleDeaf);
  const voiceLeave = useServerStore((s) => s.voiceLeave);
  const voiceSelfMute = useServerStore((s) => s.voiceSelfMute);
  const voiceSelfDeaf = useServerStore((s) => s.voiceSelfDeaf);
  const users = useServerStore((s) => s.users);
  const setSpeakingUsers = useServerStore((s) => s.setSpeakingUsers);
  const speakingUsers = useServerStore((s) => s.speakingUsers);
  const room = useRoomContext();

  // Per-user volume control
  const [volumeMenu, setVolumeMenu] = useState<{ identity: string; x: number; y: number } | null>(null);
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>(loadSavedVolumes);
  const volumeMenuRef = useRef<HTMLDivElement>(null);

  const handleParticipantContextMenu = useCallback((e: React.MouseEvent, identity: string) => {
    if (identity === localParticipant?.identity) return;
    e.preventDefault();
    setVolumeMenu({ identity, x: e.clientX, y: e.clientY });
  }, [localParticipant?.identity]);

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

  // Apply saved volumes when remote participants join
  useEffect(() => {
    const saved = loadSavedVolumes();
    for (const p of participants) {
      if (p instanceof RemoteParticipant && saved[p.identity] !== undefined) {
        p.setVolume(saved[p.identity] / 100);
      }
    }
  }, [participants]);

  const setParticipantVolume = useCallback((identity: string, volume: number) => {
    setUserVolumes((prev) => {
      const next = { ...prev, [identity]: volume };
      if (volume === 100) delete next[identity];
      saveVolumes(next);
      return next;
    });
    const p = participants.find((p) => p.identity === identity);
    if (p instanceof RemoteParticipant) {
      p.setVolume(volume / 100);
    }
  }, [participants]);

  // Push-to-talk: global key listener
  const pttActiveRef = useRef(false);
  useEffect(() => {
    const pttEnabled = localStorage.getItem('drocsid_ptt_enabled') === 'true';
    if (!pttEnabled || !localParticipant) return;

    const pttKey = localStorage.getItem('drocsid_ptt_key') || 'Space';

    // Start muted for PTT mode
    if (!useServerStore.getState().voiceSelfMute) {
      voiceToggleMute();
      localParticipant.setMicrophoneEnabled(false);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat || pttActiveRef.current) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      pttActiveRef.current = true;
      // Unmute
      if (useServerStore.getState().voiceSelfMute) {
        voiceToggleMute();
        localParticipant.setMicrophoneEnabled(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey || !pttActiveRef.current) return;
      e.preventDefault();
      pttActiveRef.current = false;
      // Mute
      if (!useServerStore.getState().voiceSelfMute) {
        voiceToggleMute();
        localParticipant.setMicrophoneEnabled(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      pttActiveRef.current = false;
    };
  }, [localParticipant, voiceToggleMute]);

  // Sync speaking state to store so sidebar can show it.
  // Uses LiveKit's ActiveSpeakersChanged event instead of polling for instant response,
  // plus a hold timer so the indicator doesn't flicker between syllables.
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

  useEffect(() => {
    if (!room) return;

    const onActiveSpeakers = (speakers: Participant[]) => {
      const nowSpeaking = new Set(speakers.map((s) => s.identity));
      const next = new Set(speakingRef.current);

      // Add new speakers immediately
      for (const id of nowSpeaking) {
        // Clear any pending removal timer
        const timer = holdTimersRef.current.get(id);
        if (timer) {
          clearTimeout(timer);
          holdTimersRef.current.delete(id);
        }
        next.add(id);
      }

      // For speakers that stopped, start a hold timer instead of removing instantly
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
    };

    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      // Clear all hold timers
      for (const timer of holdTimersRef.current.values()) clearTimeout(timer);
      holdTimersRef.current.clear();
      setSpeakingUsers(new Set());
    };
  }, [room, setSpeakingUsers, updateSpeakingStore]);

  // Local audio level monitoring for the local participant.
  // LiveKit's server-side VAD has round-trip latency; this detects local speaking
  // instantly using the same AnalyserNode approach as the mic test.
  useEffect(() => {
    if (!localParticipant) return;
    const audioTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    const mediaStream = audioTrack?.mediaStream;
    if (!mediaStream) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(mediaStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const LOCAL_SPEAK_THRESHOLD = 8; // average frequency bin value (0-255)
    let localSpeaking = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let raf = 0;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const nowSpeaking = avg > LOCAL_SPEAK_THRESHOLD;

      if (nowSpeaking && !localSpeaking) {
        localSpeaking = true;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        const next = new Set(speakingRef.current);
        next.add(localParticipant.identity);
        updateSpeakingStore(next);
      } else if (!nowSpeaking && localSpeaking) {
        if (!holdTimer) {
          holdTimer = setTimeout(() => {
            localSpeaking = false;
            holdTimer = null;
            // Only remove if server VAD also says not speaking
            if (!localParticipant.isSpeaking) {
              const next = new Set(speakingRef.current);
              next.delete(localParticipant.identity);
              updateSpeakingStore(next);
            }
          }, SPEAKING_HOLD_MS);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      if (holdTimer) clearTimeout(holdTimer);
      ctx.close();
    };
  }, [localParticipant, localParticipant?.getTrackPublication(Track.Source.Microphone)?.track?.mediaStream, updateSpeakingStore]);

  // Apply saved audio output device selection
  useEffect(() => {
    if (!room) return;

    const applySpeaker = async () => {
      const deviceId = localStorage.getItem('drocsid_speaker');
      if (!deviceId) return;

      if (isTauri()) {
        // Tauri/Linux: route via PulseAudio — retry since sink-input may appear after a delay
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await applyAudioOutputTauri(deviceId);
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      } else {
        // Web: use LiveKit SDK's setSinkId-based switching
        try {
          await room.switchActiveDevice('audiooutput', deviceId);
        } catch (e) {
          console.warn('[VoicePanel] Failed to switch audio output:', e);
        }
      }
    };

    applySpeaker();

    const handler = () => applySpeaker();
    window.addEventListener('drocsid-speaker-changed', handler);
    return () => window.removeEventListener('drocsid-speaker-changed', handler);
  }, [room]);

  // Label PipeWire audio streams with distinct names (best-effort, after connection)
  useEffect(() => {
    if (!room || !isTauri()) return;

    const label = async () => {
      // Wait a moment for audio streams to register in PipeWire
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await labelAudioStreamsTauri();
      } catch {
        // pw-cli not available — PULSE_PROP baseline naming still applies
      }
    };

    label();
  }, [room]);

  // Get video tracks for screen sharing
  const screenShareTracks = useTracks([Track.Source.ScreenShare]);
  const cameraTrackRefs = useTracks([Track.Source.Camera]);

  const hasVideo = screenShareTracks.length > 0 || cameraTrackRefs.length > 0;

  const handleToggleMute = async () => {
    if (localParticipant) {
      const newMute = !voiceSelfMute;
      await localParticipant.setMicrophoneEnabled(!newMute);
    }
    voiceToggleMute();
  };

  const handleToggleCamera = async () => {
    if (localParticipant) {
      const isEnabled = localParticipant.isCameraEnabled;
      await localParticipant.setCameraEnabled(!isEnabled);
    }
  };

  const handleToggleScreenShare = async () => {
    if (localParticipant) {
      const isEnabled = localParticipant.isScreenShareEnabled;
      await localParticipant.setScreenShareEnabled(!isEnabled);
    }
  };

  return (
    <div className={`voice-panel ${compact ? 'compact' : ''}`}>
      <RoomAudioRenderer />

      <div className="voice-panel-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--success, #3ba55c)">
          <path d="M12 3a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1zM6.56 7.56a1 1 0 0 0-1.41 0C3.14 9.57 2 12.18 2 15a1 1 0 0 0 2 0c0-2.28.92-4.34 2.56-5.97a1 1 0 0 0 0-1.41zM18.85 7.56a1 1 0 0 0-1.41 1.41C19.08 10.66 20 12.72 20 15a1 1 0 0 0 2 0c0-2.82-1.14-5.43-3.15-7.44zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
        </svg>
        <span className="voice-panel-title">{channelName}</span>
      </div>

      {/* Video grid (screen share or cameras) */}
      {hasVideo && (
        <div className="voice-video-grid">
          {screenShareTracks.map((trackRef) => (
            <div key={trackRef.publication.trackSid} className="voice-video-tile screen-share">
              <VideoTrack trackRef={trackRef} />
            </div>
          ))}
          {cameraTrackRefs.map((trackRef) => (
            <div key={trackRef.publication.trackSid} className="voice-video-tile">
              <VideoTrack trackRef={trackRef} />
              <span className="voice-video-label">
                {trackRef.participant.name || trackRef.participant.identity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Participant list */}
      <div className="voice-participants">
        {participants.map((p) => {
          const user = users.get(p.identity);
          const isSpeaking = speakingUsers.has(p.identity);
          const isLocal = p.identity === localParticipant?.identity;
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
              {p.isMicrophoneEnabled === false && (
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
          onClick={handleToggleMute}
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
          onClick={voiceToggleDeaf}
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
          className={`voice-panel-btn ${localParticipant?.isCameraEnabled ? 'active-on' : ''}`}
          onClick={handleToggleCamera}
          title="Toggle Camera"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        </button>
        <button
          className={`voice-panel-btn ${localParticipant?.isScreenShareEnabled ? 'active-on' : ''}`}
          onClick={handleToggleScreenShare}
          title="Screen Share"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
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
    </div>
  );
}
