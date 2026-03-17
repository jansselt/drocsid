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
import {
  Track,
  RoomEvent,
  RemoteParticipant,
  AudioPresets,
  VideoPresets,
  ScreenSharePresets,
  type Participant,
  type RoomOptions,
} from 'livekit-client';
import { useServerStore } from '../../stores/serverStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { getNoiseSuppression } from '../../utils/audioDevices';
import { isDesktop } from '../../api/instance';
import { SoundboardPanel } from './SoundboardPanel';
import { AudioSharePicker } from './AudioSharePicker';
import './VoicePanel.css';

export function VoicePanel({ compact }: { compact?: boolean } = {}) {
  const voiceToken = useVoiceStore((s) => s.voiceToken);
  const voiceUrl = useVoiceStore((s) => s.voiceUrl);
  const voiceChannelId = useVoiceStore((s) => s.voiceChannelId);
  const voiceLeave = useVoiceStore((s) => s.voiceLeave);
  const channels = useServerStore((s) => s.channels);

  // Pass saved device ID + noise suppression directly to getUserMedia via LiveKit.
  const audioOptions = useMemo(() => {
    const savedMic = localStorage.getItem('drocsid_mic');
    const constraints: MediaTrackConstraints = {
      noiseSuppression: getNoiseSuppression(),
      autoGainControl: true,
      echoCancellation: true,
    };
    if (savedMic && savedMic !== 'default') {
      constraints.deviceId = { exact: savedMic };
    }
    return constraints;
  }, []);

  // Room options: prioritize audio quality, cap video bitrates to prevent audio starvation
  const roomOptions = useMemo<RoomOptions>(() => ({
    dynacast: true,
    adaptiveStream: true,
    // Force all media through TURN relay (UDP 443) — never attempt direct connections
    // or TCP fallback. This ensures consistent quality and avoids firewall issues.
    rtcConfig: {
      iceTransportPolicy: 'relay',
    },
    publishDefaults: {
      audioPreset: AudioPresets.music, // 48kbps Opus (up from ~24kbps default)
      dtx: true,  // discontinuous transmission — saves bandwidth when silent
      red: true,  // redundant audio data — helps recover from packet loss
      // Keep video bitrates LOW — audio is the priority, video is a bonus.
      // High video bitrate starves audio and causes choppiness for everyone.
      videoEncoding: { maxBitrate: 300_000, maxFramerate: 15 }, // camera: 300kbps
      screenShareEncoding: ScreenSharePresets.h720fps5.encoding, // screenshare: 720p@5fps ~400kbps
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180],
    },
  }), []);

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
      connect={true}
      audio={audioOptions}
      video={false}
      options={roomOptions}
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
  const voiceToggleMute = useVoiceStore((s) => s.voiceToggleMute);
  const voiceToggleDeaf = useVoiceStore((s) => s.voiceToggleDeaf);
  const voiceLeave = useVoiceStore((s) => s.voiceLeave);
  const voiceSelfMute = useVoiceStore((s) => s.voiceSelfMute);
  const voiceSelfDeaf = useVoiceStore((s) => s.voiceSelfDeaf);
  const users = useServerStore((s) => s.users);
  const setSpeakingUsers = useVoiceStore((s) => s.setSpeakingUsers);
  const speakingUsers = useVoiceStore((s) => s.speakingUsers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const room = useRoomContext();

  const [showSoundboard, setShowSoundboard] = useState(false);
  const [isAudioSharing, setIsAudioSharing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [showAudioSharePicker, setShowAudioSharePicker] = useState(false);
  const [showSystemAudioConfirm, setShowSystemAudioConfirm] = useState(false);
  const [audioShareModuleId, setAudioShareModuleId] = useState<number | null>(null);

  // Detect mic/camera access failures (e.g. WebView2 permissions not granted)
  useEffect(() => {
    if (!room) return;
    const onMediaError = (err: Error) => {
      console.error('[VoicePanel] Media device error:', err);
      setMicError('Microphone access denied. Check your system permissions and reload.');
    };
    room.on(RoomEvent.MediaDevicesError, onMediaError);
    return () => { room.off(RoomEvent.MediaDevicesError, onMediaError); };
  }, [room]);
  const voiceSetAudioSharing = useVoiceStore((s) => s.voiceSetAudioSharing);
  const voiceSetVideoActive = useVoiceStore((s) => s.voiceSetVideoActive);

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

  // Global speaker volume (from settings), stored as 0.0-2.0 multiplier
  const speakerVolumeRef = useRef(
    (() => { const s = localStorage.getItem('drocsid_speaker_volume'); return s ? Number(s) / 100 : 1.0; })()
  );

  // Apply effective volume (per-user × global) to all remote participants
  const applyAllVolumes = useCallback(() => {
    const saved = loadSavedVolumes();
    const globalVol = speakerVolumeRef.current;
    for (const p of participants) {
      if (p instanceof RemoteParticipant) {
        const userVol = (saved[p.identity] ?? 100) / 100;
        p.setVolume(userVol * globalVol);
      }
    }
  }, [participants]);

  // Apply saved volumes when remote participants join
  useEffect(() => {
    applyAllVolumes();
  }, [applyAllVolumes]);

  // Listen for global speaker volume changes from settings
  useEffect(() => {
    const handler = (e: Event) => {
      speakerVolumeRef.current = (e as CustomEvent<number>).detail / 100;
      applyAllVolumes();
    };
    window.addEventListener('drocsid-speaker-volume-changed', handler);
    return () => window.removeEventListener('drocsid-speaker-volume-changed', handler);
  }, [applyAllVolumes]);

  const setParticipantVolume = useCallback((identity: string, volume: number) => {
    setUserVolumes((prev) => {
      const next = { ...prev, [identity]: volume };
      if (volume === 100) delete next[identity];
      saveVolumes(next);
      return next;
    });
    const p = participants.find((p) => p.identity === identity);
    if (p instanceof RemoteParticipant) {
      p.setVolume((volume / 100) * speakerVolumeRef.current);
    }
  }, [participants]);

  // Push-to-talk: global key listener
  const pttActiveRef = useRef(false);
  useEffect(() => {
    const pttEnabled = localStorage.getItem('drocsid_ptt_enabled') === 'true';
    if (!pttEnabled || !localParticipant) return;

    const pttKey = localStorage.getItem('drocsid_ptt_key') || 'Space';

    // Start muted for PTT mode
    if (!useVoiceStore.getState().voiceSelfMute) {
      voiceToggleMute();
      localParticipant.setMicrophoneEnabled(false);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat || pttActiveRef.current) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      pttActiveRef.current = true;
      // Unmute
      if (useVoiceStore.getState().voiceSelfMute) {
        voiceToggleMute();
        localParticipant.setMicrophoneEnabled(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey || !pttActiveRef.current) return;
      e.preventDefault();
      pttActiveRef.current = false;
      // Mute
      if (!useVoiceStore.getState().voiceSelfMute) {
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
      // Filter out muted participants — LiveKit's server VAD can report
      // a muted participant as speaking due to residual audio signal
      const nowSpeaking = new Set(
        speakers
          .filter((s) => s.isMicrophoneEnabled !== false)
          .map((s) => s.identity)
      );
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

  // NOTE: Local audio level monitoring (client-side VAD) was removed.
  // It read from the raw MediaStream which doesn't reflect system-level
  // mutes (PipeWire/PulseAudio mute flags). LiveKit's server-side VAD
  // (ActiveSpeakersChanged event above) is the authoritative source for
  // speaking state — it only reports participants whose audio is actually
  // being received by the server.

  // Apply saved audio output device selection
  useEffect(() => {
    if (!room) return;

    const applySpeaker = async () => {
      const deviceId = localStorage.getItem('drocsid_speaker');
      if (!deviceId) return;

      try {
        await room.switchActiveDevice('audiooutput', deviceId);
      } catch (e) {
        console.warn('[VoicePanel] Failed to switch audio output:', e);
      }
    };

    applySpeaker();

    const handler = () => applySpeaker();
    window.addEventListener('drocsid-speaker-changed', handler);
    return () => window.removeEventListener('drocsid-speaker-changed', handler);
  }, [room]);

  // Re-publish mic track when user changes mic or noise suppression settings.
  useEffect(() => {
    if (!room || !localParticipant) return;

    const republishMic = async () => {
      const deviceId = localStorage.getItem('drocsid_mic');
      const constraints: MediaTrackConstraints = {
        noiseSuppression: getNoiseSuppression(),
        autoGainControl: true,
        echoCancellation: true,
      };
      if (deviceId && deviceId !== 'default') {
        constraints.deviceId = { exact: deviceId };
      }
      try {
        await localParticipant.setMicrophoneEnabled(false);
        await localParticipant.setMicrophoneEnabled(true, constraints);
      } catch (e) {
        console.warn('[VoicePanel] Failed to republish mic:', e);
      }
    };

    window.addEventListener('drocsid-mic-changed', republishMic);
    window.addEventListener('drocsid-noise-suppression-changed', republishMic);
    return () => {
      window.removeEventListener('drocsid-mic-changed', republishMic);
      window.removeEventListener('drocsid-noise-suppression-changed', republishMic);
    };
  }, [room, localParticipant]);

  // Get video tracks for screen sharing
  const screenShareTracks = useTracks([Track.Source.ScreenShare]);
  const cameraTrackRefs = useTracks([Track.Source.Camera]);

  const hasVideo = screenShareTracks.length > 0 || cameraTrackRefs.length > 0;

  // Sync video-active state to store (drives full-height layout in ChatArea)
  useEffect(() => {
    voiceSetVideoActive(hasVideo);
    return () => voiceSetVideoActive(false);
  }, [hasVideo, voiceSetVideoActive]);

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

  const handleStopAudioShare = useCallback(async () => {
    if (!localParticipant) return;

    // Unpublish screen share audio track and clean up capture resources
    for (const [, pub] of localParticipant.trackPublications) {
      if (pub.source === Track.Source.ScreenShareAudio && pub.track) {
        const track = pub.track.mediaStreamTrack;
        // Clean up parec IPC listeners and AudioContext
        if (track) {
          (track as any)._cleanupCapture?.();
          (track as any)._cleanupEnded?.();
          (track as any)._scriptNode?.disconnect();
          (track as any)._audioCtx?.close();
          track.stop();
        }
        await localParticipant.unpublishTrack(pub.track);
      }
    }

    // Stop parec capture in main process
    try {
      await window.electronAPI?.stopAudioCapture();
    } catch { /* ignore */ }

    // Clean up PipeWire null-sink if we created one
    if (audioShareModuleId !== null) {
      try {
        await window.electronAPI?.stopAudioShare(audioShareModuleId);
      } catch (e) {
        console.warn('[VoicePanel] Failed to stop PipeWire audio share:', e);
      }
      setAudioShareModuleId(null);
    }

    setIsAudioSharing(false);
    voiceSetAudioSharing(false);
  }, [localParticipant, audioShareModuleId, voiceSetAudioSharing]);

  const handleAudioShareSelected = useCallback(async (nodeIds: number[], systemMode: boolean) => {
    if (!localParticipant) return;
    setShowAudioSharePicker(false);

    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.startAudioShare) {
        throw new Error('Audio share API not available');
      }

      // 1. Create null-sink and link selected apps
      const { moduleId, sinkName } = await electronAPI.startAudioShare(nodeIds, systemMode);
      setAudioShareModuleId(moduleId);

      // 2. Wait for PipeWire to register the null-sink
      await new Promise((r) => setTimeout(r, 300));

      // 3. Capture audio from the null-sink monitor via parec in the main process.
      //    parec streams raw Float32 PCM at 48kHz stereo via IPC to the renderer.
      //    We wrap it into a MediaStreamTrack using AudioWorklet + MediaStreamDestination.
      await electronAPI.startAudioCapture(sinkName);

      const audioCtx = new AudioContext({ sampleRate: 48000 });
      const dest = audioCtx.createMediaStreamDestination();

      // ScriptProcessorNode for receiving IPC audio data (simpler than AudioWorklet for IPC)
      const bufferSize = 4096;
      const scriptNode = audioCtx.createScriptProcessor(bufferSize, 2, 2);
      const pendingChunks: Float32Array[] = [];

      const cleanupCapture = electronAPI.onAudioCaptureData((data: ArrayBuffer) => {
        pendingChunks.push(new Float32Array(data));
      });

      const cleanupEnded = electronAPI.onAudioCaptureEnded(() => {
        handleStopAudioShare();
      });

      scriptNode.onaudioprocess = (e) => {
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);
        let outIdx = 0;

        while (outIdx < outL.length && pendingChunks.length > 0) {
          const chunk = pendingChunks[0];
          const samplesNeeded = outL.length - outIdx;
          // chunk is interleaved stereo: [L, R, L, R, ...]
          const framesAvailable = Math.floor(chunk.length / 2);
          const framesToCopy = Math.min(samplesNeeded, framesAvailable);

          for (let i = 0; i < framesToCopy; i++) {
            outL[outIdx + i] = chunk[i * 2];
            outR[outIdx + i] = chunk[i * 2 + 1];
          }
          outIdx += framesToCopy;

          if (framesToCopy >= framesAvailable) {
            pendingChunks.shift();
          } else {
            // Partial consume — keep remainder
            pendingChunks[0] = chunk.subarray(framesToCopy * 2);
          }
        }

        // Fill remaining with silence
        for (let i = outIdx; i < outL.length; i++) {
          outL[i] = 0;
          outR[i] = 0;
        }
      };

      scriptNode.connect(dest);

      const audioTrack = dest.stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('Failed to create audio track from capture');

      // Store cleanup refs on the track for later
      (audioTrack as any)._cleanupCapture = cleanupCapture;
      (audioTrack as any)._cleanupEnded = cleanupEnded;
      (audioTrack as any)._audioCtx = audioCtx;
      (audioTrack as any)._scriptNode = scriptNode;

      if (!audioTrack) throw new Error('No audio track captured');

      await localParticipant.publishTrack(audioTrack, {
        source: Track.Source.ScreenShareAudio,
        name: 'audio-share',
      });

      audioTrack.addEventListener('ended', () => {
        handleStopAudioShare();
      });

      setIsAudioSharing(true);
      voiceSetAudioSharing(true);
    } catch (e) {
      console.warn('[VoicePanel] PipeWire audio sharing failed:', e);
      // Clean up the null-sink if we created one
      if (audioShareModuleId !== null) {
        try {
          await window.electronAPI?.stopAudioShare(audioShareModuleId);
        } catch { /* ignore */ }
        setAudioShareModuleId(null);
      }
    }
  }, [localParticipant, audioShareModuleId, voiceSetAudioSharing, handleStopAudioShare]);

  const handleSystemAudioShare = useCallback(async () => {
    if (!localParticipant) return;
    setShowSystemAudioConfirm(false);

    try {
      const electronAPI = window.electronAPI;
      const sourceId = await electronAPI?.getDesktopAudioStream();
      if (!sourceId) throw new Error('No desktop audio source available');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // @ts-expect-error — Electron-specific constraint
          mandatory: { chromeMediaSource: 'desktop' },
        },
        video: {
          // @ts-expect-error — Electron-specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: 1,
            maxHeight: 1,
            maxFrameRate: 1,
          },
        },
      });
      stream.getVideoTracks().forEach((t) => t.stop());

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('No audio track captured');

      await localParticipant.publishTrack(audioTrack, {
        source: Track.Source.ScreenShareAudio,
        name: 'audio-share',
      });

      audioTrack.addEventListener('ended', () => {
        setIsAudioSharing(false);
        voiceSetAudioSharing(false);
      });

      setIsAudioSharing(true);
      voiceSetAudioSharing(true);
    } catch (e) {
      console.warn('[VoicePanel] System audio sharing failed:', e);
    }
  }, [localParticipant, voiceSetAudioSharing]);

  const handleToggleAudioShare = async () => {
    if (!localParticipant) return;

    if (isAudioSharing) {
      await handleStopAudioShare();
    } else if (isDesktop() && navigator.userAgent.includes('Linux')) {
      // On Electron + Linux: show the PipeWire app picker
      setShowAudioSharePicker(true);
    } else if (isDesktop()) {
      // Windows Electron: show confirmation for system-wide audio capture
      setShowSystemAudioConfirm(true);
    } else {
      // Web browser: use getDisplayMedia
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
        stream.getVideoTracks().forEach((t) => t.stop());

        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) throw new Error('No audio track captured');

        await localParticipant.publishTrack(audioTrack, {
          source: Track.Source.ScreenShareAudio,
          name: 'audio-share',
        });

        audioTrack.addEventListener('ended', () => {
          setIsAudioSharing(false);
          voiceSetAudioSharing(false);
        });

        setIsAudioSharing(true);
        voiceSetAudioSharing(true);
      } catch (e) {
        console.warn('[VoicePanel] Audio sharing failed:', e);
      }
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

      {micError && (
        <div className="voice-mic-error">{micError}</div>
      )}

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

      {/* Participant list (hide when alone) */}
      {participants.length > 1 && (
      <div className="voice-participants">
        {participants.map((p) => {
          const user = users.get(p.identity);
          const isSpeaking = speakingUsers.has(p.identity) && p.isMicrophoneEnabled !== false;
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
      )}

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
          className={`voice-panel-btn ${isAudioSharing ? 'active-on' : ''}`}
          onClick={handleToggleAudioShare}
          title={isAudioSharing ? 'Stop Sharing Audio' : 'Share Audio'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
            <path d="M7.05 7.05a7 7 0 000 9.9l1.41-1.41a5 5 0 010-7.08L7.05 7.05zm9.9 0l-1.41 1.41a5 5 0 010 7.08l1.41 1.41a7 7 0 000-9.9z" />
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
        {window.electronAPI && (
          <button
            className="voice-panel-btn"
            onClick={() => window.electronAPI?.createVoicePopout()}
            title="Pop Out"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
            </svg>
          </button>
        )}
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
      {showAudioSharePicker && (
        <AudioSharePicker
          onClose={() => setShowAudioSharePicker(false)}
          onShare={handleAudioShareSelected}
        />
      )}
      {showSystemAudioConfirm && (
        <div className="audio-share-picker-overlay" onClick={() => setShowSystemAudioConfirm(false)}>
          <div className="audio-share-picker" onClick={(e) => e.stopPropagation()}>
            <div className="audio-share-picker-header">
              <h3>Share System Audio</h3>
              <button className="audio-share-picker-close" onClick={() => setShowSystemAudioConfirm(false)}>×</button>
            </div>
            <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
              This will share all system audio with everyone in the voice channel.
            </div>
            <div className="audio-share-picker-actions">
              <button className="audio-share-picker-btn" onClick={() => setShowSystemAudioConfirm(false)}>Cancel</button>
              <button className="audio-share-picker-btn audio-share-picker-btn-primary" onClick={handleSystemAudioShare}>Share</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
