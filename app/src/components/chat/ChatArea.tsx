import { useState } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { ThreadPanel } from './ThreadPanel';
import { SearchModal } from './SearchModal';
import { VoicePanel } from '../voice/VoicePanel';
import './ChatArea.css';

export function ChatArea() {
  const view = useServerStore((s) => s.view);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeThreadId = useServerStore((s) => s.activeThreadId);
  const channels = useServerStore((s) => s.channels);
  const dmRecipients = useServerStore((s) => s.dmRecipients);
  const dmChannels = useServerStore((s) => s.dmChannels);
  const voiceChannelId = useServerStore((s) => s.voiceChannelId);
  const currentUser = useAuthStore((s) => s.user);

  const [showSearch, setShowSearch] = useState(false);

  // If connected to voice and no text channel selected, show voice panel full-width
  if (voiceChannelId && !activeChannelId) {
    return (
      <div className="chat-area-wrapper">
        <div className="chat-area">
          <VoicePanel />
        </div>
      </div>
    );
  }

  if (!activeChannelId) {
    return (
      <div className="chat-area">
        <div className="chat-empty">
          <p>{view === 'home' ? 'Select a conversation' : 'Select a channel to start chatting'}</p>
        </div>
      </div>
    );
  }

  // Determine channel info
  let channelName = 'Unknown';
  let channelPrefix = '#';
  let isDm = false;

  if (view === 'home') {
    // DM channel
    isDm = true;
    channelPrefix = '@';
    const dm = dmChannels.find((c) => c.id === activeChannelId);
    const recipients = dmRecipients.get(activeChannelId) || [];
    const otherUsers = recipients.filter((r) => r.id !== currentUser?.id);

    if (dm?.channel_type === 'groupdm') {
      channelName = dm.name || otherUsers.map((u) => u.username).join(', ');
    } else {
      channelName = otherUsers[0]?.username || 'Unknown';
    }
  } else if (activeServerId) {
    const serverChannels = channels.get(activeServerId) || [];
    const channel = serverChannels.find((c) => c.id === activeChannelId);
    channelName = channel?.name || 'Unknown';
  }

  return (
    <div className="chat-area-wrapper">
      <div className="chat-area">
        {/* Voice panel pinned at top when connected */}
        {voiceChannelId && <VoicePanelCompact />}

        <div className="chat-header">
          <span className="chat-header-hash">{channelPrefix}</span>
          <span className="chat-header-name">{channelName}</span>
          <div style={{ flex: 1 }} />
          {!isDm && (
            <button
              className="chat-header-action"
              title="Search"
              onClick={() => setShowSearch(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            </button>
          )}
        </div>
        <MessageList channelId={activeChannelId} />
        <TypingIndicator channelId={activeChannelId} />
        <MessageInput channelId={activeChannelId} />
      </div>

      {activeThreadId && <ThreadPanel threadId={activeThreadId} />}

      {showSearch && (
        <SearchModal
          serverId={activeServerId || undefined}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}

/** Compact voice panel that shows at top of chat area when browsing text while in voice */
function VoicePanelCompact() {
  const voiceChannelId = useServerStore((s) => s.voiceChannelId);
  const voiceToken = useServerStore((s) => s.voiceToken);
  const voiceUrl = useServerStore((s) => s.voiceUrl);
  if (!voiceToken || !voiceUrl || !voiceChannelId) return null;

  // We still need the LiveKitRoom for audio, but we render it minimally
  return (
    <div className="voice-compact-bar">
      <VoicePanel />
    </div>
  );
}

function TypingIndicator({ channelId }: { channelId: string }) {
  const typingUsers = useServerStore((s) => s.typingUsers);
  const users = useServerStore((s) => s.users);
  const currentUser = useAuthStore((s) => s.user);

  const typing = (typingUsers.get(channelId) || []).filter(
    (t) => t.userId !== currentUser?.id,
  );

  if (typing.length === 0) return null;

  const names = typing
    .map((t) => users.get(t.userId)?.username || 'Someone')
    .slice(0, 3);

  let text: string;
  if (names.length === 1) {
    text = `${names[0]} is typing...`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing...`;
  } else {
    text = 'Several people are typing...';
  }

  return <div className="typing-indicator">{text}</div>;
}
