import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './VoicePopout.css';

export const POPOUT_BC_CHANNEL = 'drocsid-voice-popout';

interface RemoteVideoTrack {
  identity: string;
  source: string;
}

export function VoicePopout() {
  const [remoteVideoTracks, setRemoteVideoTracks] = useState<Map<string, RemoteVideoTrack>>(new Map());
  const [cameraActive, setCameraActive] = useState(false);
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deaf, setDeaf] = useState(false);

  const remoteImgRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const localCameraRef = useRef<HTMLImageElement>(null);
  const localScreenRef = useRef<HTMLImageElement>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  // Setup BroadcastChannel
  useEffect(() => {
    const bc = new BroadcastChannel(POPOUT_BC_CHANNEL);
    bcRef.current = bc;

    bc.onmessage = (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'state':
          setMuted(msg.muted);
          setDeaf(msg.deaf);
          setCameraActive(msg.cameraActive);
          setScreenShareActive(msg.screenShareActive);
          break;
        case 'localCameraFrame':
          if (localCameraRef.current) {
            localCameraRef.current.src = `data:image/jpeg;base64,${msg.data}`;
          }
          break;
        case 'theme': {
          const root = document.documentElement;
          for (const [prop, value] of Object.entries(msg.colors as Record<string, string>)) {
            root.style.setProperty(prop, value);
          }
          break;
        }
        case 'voiceEnded':
          window.close();
          break;
      }
    };

    // Tell main window we're ready
    bc.postMessage({ type: 'popoutReady' });

    const handleUnload = () => {
      bc.postMessage({ type: 'popoutClosed' });
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      bc.postMessage({ type: 'popoutClosed' });
      bc.close();
    };
  }, []);

  // Listen to Tauri events (remote video frames come from Rust, broadcast to all windows)
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      // Remote video frames
      unlisteners.push(
        await listen<{ identity: string; source: string; data: string }>('voice:remote-video-frame', (event) => {
          const { identity, source, data } = event.payload;
          const key = `${identity}:${source}`;
          const img = remoteImgRefs.current.get(key);
          if (img) {
            img.src = `data:image/jpeg;base64,${data}`;
          }
        })
      );

      // Remote video track add/remove
      unlisteners.push(
        await listen<{ identity: string; source: string; active: boolean }>('voice:remote-video-track', (event) => {
          const { identity, source, active } = event.payload;
          const key = `${identity}:${source}`;
          setRemoteVideoTracks((prev) => {
            const next = new Map(prev);
            if (active) {
              next.set(key, { identity, source });
            } else {
              next.delete(key);
              remoteImgRefs.current.delete(key);
            }
            return next;
          });
        })
      );

      // Local screen preview (emitted from Rust GStreamer capture)
      unlisteners.push(
        await listen<string>('voice:local-screen-preview', (event) => {
          if (localScreenRef.current) {
            localScreenRef.current.src = `data:image/jpeg;base64,${event.payload}`;
          }
        })
      );

      // Screen share ended
      unlisteners.push(
        await listen<void>('voice:screenshare-ended', () => {
          setScreenShareActive(false);
        })
      );

      // Connection state — close popout if voice disconnected
      unlisteners.push(
        await listen<{ state: string }>('voice:connection-state', (event) => {
          if (event.payload.state === 'disconnected') {
            window.close();
          }
        })
      );
    };

    setup();
    return () => { unlisteners.forEach((fn) => fn()); };
  }, []);

  const handlePopIn = () => {
    bcRef.current?.postMessage({ type: 'popIn' });
    window.close();
  };

  const handleToggleMute = () => {
    bcRef.current?.postMessage({ type: 'toggleMute' });
  };

  const handleToggleDeaf = () => {
    bcRef.current?.postMessage({ type: 'toggleDeaf' });
  };

  const handleDisconnect = () => {
    bcRef.current?.postMessage({ type: 'disconnect' });
    window.close();
  };

  const hasVideo = cameraActive || screenShareActive || remoteVideoTracks.size > 0;

  return (
    <div className="voice-popout">
      {hasVideo ? (
        <div className="voice-popout-grid">
          {cameraActive && (
            <div className="voice-video-tile">
              <img ref={localCameraRef} alt="Camera" style={{ transform: 'scaleX(-1)' }} />
              <span className="voice-video-label">You (Camera)</span>
            </div>
          )}
          {screenShareActive && (
            <div className="voice-video-tile screen-share">
              <img ref={localScreenRef} alt="Screen" />
              <span className="voice-video-label">You (Screen)</span>
            </div>
          )}
          {Array.from(remoteVideoTracks.entries()).map(([key, track]) => {
            const isScreenShare = track.source === 'screenshare';
            return (
              <div key={key} className={`voice-video-tile ${isScreenShare ? 'screen-share' : ''}`}>
                <img
                  ref={(el) => {
                    if (el) remoteImgRefs.current.set(key, el);
                    else remoteImgRefs.current.delete(key);
                  }}
                  alt={`${track.identity} ${track.source}`}
                />
                <span className="voice-video-label">
                  {track.identity} ({isScreenShare ? 'Screen' : 'Camera'})
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="voice-popout-empty">
          <p>No active video</p>
        </div>
      )}

      <div className="voice-popout-controls">
        <button
          className={`voice-panel-btn ${muted ? 'active' : ''}`}
          onClick={handleToggleMute}
          title={muted ? 'Unmute' : 'Mute'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            {muted ? (
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            ) : (
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            )}
          </svg>
        </button>
        <button
          className={`voice-panel-btn ${deaf ? 'active' : ''}`}
          onClick={handleToggleDeaf}
          title={deaf ? 'Undeafen' : 'Deafen'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            {deaf ? (
              <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12z" />
            ) : (
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            )}
          </svg>
        </button>
        <button
          className="voice-panel-btn"
          onClick={handlePopIn}
          title="Return to main window"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
          </svg>
        </button>
        <button
          className="voice-panel-btn disconnect"
          onClick={handleDisconnect}
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
