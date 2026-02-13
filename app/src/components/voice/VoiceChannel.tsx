import { useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import './VoiceChannel.css';

interface VoiceChannelProps {
  channelId: string;
  channelName: string;
}

export function VoiceChannel({ channelId, channelName }: VoiceChannelProps) {
  const voiceChannelId = useServerStore((s) => s.voiceChannelId);
  const voiceStates = useServerStore((s) => s.voiceStates);
  const voiceJoin = useServerStore((s) => s.voiceJoin);
  const loadVoiceStates = useServerStore((s) => s.loadVoiceStates);
  const users = useServerStore((s) => s.users);
  const currentUser = useAuthStore((s) => s.user);

  const isConnected = voiceChannelId === channelId;
  const channelVoiceStates = voiceStates.get(channelId) || [];

  useEffect(() => {
    loadVoiceStates(channelId);
  }, [channelId, loadVoiceStates]);

  const handleClick = () => {
    if (!isConnected) {
      voiceJoin(channelId);
    }
  };

  return (
    <div className="voice-channel">
      <button
        className={`voice-channel-btn ${isConnected ? 'connected' : ''}`}
        onClick={handleClick}
      >
        <svg className="voice-channel-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1zM6.56 7.56a1 1 0 0 0-1.41 0C3.14 9.57 2 12.18 2 15a1 1 0 0 0 2 0c0-2.28.92-4.34 2.56-5.97a1 1 0 0 0 0-1.41zM18.85 7.56a1 1 0 0 0-1.41 1.41C19.08 10.66 20 12.72 20 15a1 1 0 0 0 2 0c0-2.82-1.14-5.43-3.15-7.44zM9.4 10.4a1 1 0 0 0-1.41 0A5.98 5.98 0 0 0 6 15a1 1 0 0 0 2 0c0-1.2.52-2.34 1.4-3.19a1 1 0 0 0 0-1.41zM15.6 10.4a1 1 0 0 0 0 1.41c.88.85 1.4 1.99 1.4 3.19a1 1 0 0 0 2 0c0-1.74-.72-3.38-1.99-4.6a1 1 0 0 0-1.41 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
        </svg>
        <span className="voice-channel-name">{channelName}</span>
      </button>

      {channelVoiceStates.length > 0 && (
        <div className="voice-users">
          {channelVoiceStates.map((vs) => {
            const user = users.get(vs.user_id);
            const isMe = vs.user_id === currentUser?.id;
            return (
              <div key={vs.user_id} className={`voice-user ${isMe ? 'me' : ''}`}>
                <div className="voice-user-avatar">
                  {(user?.username || '?').charAt(0).toUpperCase()}
                </div>
                <span className="voice-user-name">
                  {user?.username || 'Unknown'}
                </span>
                {vs.self_mute && (
                  <svg className="voice-user-status" width="14" height="14" viewBox="0 0 24 24" fill="var(--text-muted)">
                    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                  </svg>
                )}
                {vs.self_deaf && (
                  <svg className="voice-user-status" width="14" height="14" viewBox="0 0 24 24" fill="var(--text-muted)">
                    <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
