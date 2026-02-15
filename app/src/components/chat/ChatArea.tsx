import { useState, useEffect, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { ThreadPanel } from './ThreadPanel';
import { SearchModal } from './SearchModal';
import { VoicePanel } from '../voice/VoicePanel';
import { Markdown } from './Markdown';
import type { Message } from '../../types';
import * as api from '../../api/client';
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

  const servers = useServerStore((s) => s.servers);
  const showChannelSidebar = useServerStore((s) => s.showChannelSidebar);
  const toggleChannelSidebar = useServerStore((s) => s.toggleChannelSidebar);
  const showMemberSidebar = useServerStore((s) => s.showMemberSidebar);
  const toggleMemberSidebar = useServerStore((s) => s.toggleMemberSidebar);

  const activeServer = activeServerId ? servers.find((s) => s.id === activeServerId) : null;
  const bannerUrl = activeServer?.banner_url;
  const bannerPosition = activeServer?.banner_position ?? 50;

  const [showSearch, setShowSearch] = useState(false);
  const [showPins, setShowPins] = useState(false);

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

        <div
          className={`chat-header ${bannerUrl ? 'has-banner' : ''}`}
          style={bannerUrl ? { backgroundImage: `url(${bannerUrl})`, backgroundPosition: `center ${bannerPosition}%` } : undefined}
        >
          {!showChannelSidebar && (
            <button
              className="chat-header-action chat-header-expand"
              title="Show Channels (Ctrl+\)"
              onClick={toggleChannelSidebar}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
              </svg>
            </button>
          )}
          <span className="chat-header-hash">{channelPrefix}</span>
          <span className="chat-header-name">{channelName}</span>
          <div style={{ flex: 1 }} />
          {!isDm && (
            <>
              <button
                className={`chat-header-action ${showPins ? 'active' : ''}`}
                title="Pinned Messages"
                onClick={() => setShowPins(!showPins)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                </svg>
              </button>
              <button
                className="chat-header-action"
                title="Search"
                onClick={() => setShowSearch(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
              </button>
              {activeServerId && (
                <button
                  className={`chat-header-action ${showMemberSidebar ? 'active' : ''}`}
                  title="Toggle Member List (Ctrl+B)"
                  onClick={toggleMemberSidebar}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
        <MessageList channelId={activeChannelId} />
        <TypingIndicator channelId={activeChannelId} />
        <MessageInput channelId={activeChannelId} />
      </div>

      {activeThreadId && <ThreadPanel threadId={activeThreadId} />}

      {showPins && activeChannelId && (
        <PinnedMessagesPanel channelId={activeChannelId} onClose={() => setShowPins(false)} />
      )}

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
      <VoicePanel compact />
    </div>
  );
}

function PinnedMessagesPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [pins, setPins] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const users = useServerStore((s) => s.users);

  const loadPins = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getPinnedMessages(channelId);
      setPins(result);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    loadPins();
  }, [loadPins]);

  const getAuthorName = (msg: Message) => {
    if (!msg.author_id) return 'Deleted User';
    if (msg.author) return msg.author.display_name || msg.author.username;
    const cached = users.get(msg.author_id);
    return cached?.display_name || cached?.username || 'Unknown User';
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="pinned-panel">
      <div className="pinned-panel-header">
        <h3>Pinned Messages</h3>
        <button className="settings-close" onClick={onClose}>&times;</button>
      </div>
      <div className="pinned-panel-body">
        {loading && <p className="pinned-empty">Loading...</p>}
        {!loading && pins.length === 0 && <p className="pinned-empty">No pinned messages</p>}
        {pins.map((msg) => (
          <div key={msg.id} className="pinned-message">
            <div className="pinned-message-author">{getAuthorName(msg)}</div>
            <div className="pinned-message-content">
              <Markdown content={msg.content || ''} />
            </div>
            <div className="pinned-message-time">{formatTime(msg.created_at)}</div>
          </div>
        ))}
      </div>
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
