import { useServerStore } from '../../stores/serverStore';
import './VoiceControls.css';

export function VoiceControls() {
  const voiceChannelId = useServerStore((s) => s.voiceChannelId);
  const voiceSelfMute = useServerStore((s) => s.voiceSelfMute);
  const voiceSelfDeaf = useServerStore((s) => s.voiceSelfDeaf);
  const voiceLeave = useServerStore((s) => s.voiceLeave);
  const voiceToggleMute = useServerStore((s) => s.voiceToggleMute);
  const voiceToggleDeaf = useServerStore((s) => s.voiceToggleDeaf);
  const channels = useServerStore((s) => s.channels);
  if (!voiceChannelId) return null;

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
    <div className="voice-controls">
      <div className="voice-controls-info">
        <span className="voice-controls-status">Voice Connected</span>
        <span className="voice-controls-channel">{channelName}</span>
      </div>
      <div className="voice-controls-buttons">
        <button
          className={`voice-control-btn ${voiceSelfMute ? 'active' : ''}`}
          onClick={voiceToggleMute}
          title={voiceSelfMute ? 'Unmute' : 'Mute'}
        >
          {voiceSelfMute ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
          )}
        </button>
        <button
          className={`voice-control-btn ${voiceSelfDeaf ? 'active' : ''}`}
          onClick={voiceToggleDeaf}
          title={voiceSelfDeaf ? 'Undeafen' : 'Deafen'}
        >
          {voiceSelfDeaf ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          )}
        </button>
        <button
          className="voice-control-btn disconnect"
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
