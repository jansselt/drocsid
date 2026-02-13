import { useEffect, useState, useCallback, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import type { Message, ReactionGroup } from '../../types';
import { Markdown } from './Markdown';
import './MessageList.css';

interface MessageListProps {
  channelId: string;
}

const EMOJI_QUICK_PICKS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F44E}', '\u{1F389}', '\u{1F440}'];
const EMPTY_MESSAGES: Message[] = [];

export function MessageList({ channelId }: MessageListProps) {
  const messages = useServerStore((s) => s.messages.get(channelId) ?? EMPTY_MESSAGES);
  const reactions = useServerStore((s) => s.reactions);
  const users = useServerStore((s) => s.users);
  const currentUser = useAuthStore((s) => s.user);
  const editMessage = useServerStore((s) => s.editMessage);
  const removeMessage = useServerStore((s) => s.removeMessage);
  const addReaction = useServerStore((s) => s.addReaction);
  const removeReaction = useServerStore((s) => s.removeReaction);
  const pinMessage = useServerStore((s) => s.pinMessage);
  const unpinMessage = useServerStore((s) => s.unpinMessage);
  const loadMoreMessages = useServerStore((s) => s.loadMoreMessages);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [emojiPickerForId, setEmojiPickerForId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const isLoadingMore = useRef(false);

  // Cancel editing on channel switch
  useEffect(() => {
    setEditingId(null);
    setEmojiPickerForId(null);
    setHoveredId(null);
  }, [channelId]);

  const getAuthorName = (msg: Message): string => {
    if (msg.author) return msg.author.display_name || msg.author.username;
    const cached = users.get(msg.author_id);
    if (cached) return cached.display_name || cached.username;
    return 'Unknown User';
  };

  const formatTime = (iso: string): string => {
    const date = new Date(iso);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const shouldShowHeader = (msg: Message, index: number): boolean => {
    if (index === 0) return true;
    const prev = messages[index - 1];
    if (prev.author_id !== msg.author_id) return true;
    const diff = new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff > 5 * 60 * 1000;
  };

  const startEditing = useCallback((msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content || '');
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editContent.trim();
    if (!trimmed) return;
    try {
      await editMessage(channelId, editingId, trimmed);
    } catch (err) {
      console.error('Failed to edit message:', err);
    }
    setEditingId(null);
  }, [editingId, editContent, channelId, editMessage]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave();
    }
    if (e.key === 'Escape') {
      setEditingId(null);
    }
  }, [handleEditSave]);

  const handleDelete = useCallback(async (messageId: string) => {
    try {
      await removeMessage(channelId, messageId);
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  }, [channelId, removeMessage]);

  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    setEmojiPickerForId(null);
    try {
      await addReaction(channelId, messageId, emoji);
    } catch (err) {
      console.error('Failed to add reaction:', err);
    }
  }, [channelId, addReaction]);

  const handleRemoveReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await removeReaction(channelId, messageId, emoji);
    } catch (err) {
      console.error('Failed to remove reaction:', err);
    }
  }, [channelId, removeReaction]);

  const handlePin = useCallback(async (messageId: string, isPinned: boolean) => {
    try {
      if (isPinned) {
        await unpinMessage(channelId, messageId);
      } else {
        await pinMessage(channelId, messageId);
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  }, [channelId, pinMessage, unpinMessage]);

  const handleStartReached = useCallback(async () => {
    if (isLoadingMore.current) return;
    isLoadingMore.current = true;
    try {
      await loadMoreMessages(channelId);
    } finally {
      isLoadingMore.current = false;
    }
  }, [channelId, loadMoreMessages]);

  if (messages.length === 0) {
    return (
      <div className="message-list">
        <div className="message-list-empty">
          <p>No messages yet. Say something!</p>
        </div>
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="message-list"
      data={messages}
      startReached={handleStartReached}
      initialTopMostItemIndex={messages.length - 1}
      followOutput={atBottom ? 'smooth' : false}
      atBottomStateChange={setAtBottom}
      increaseViewportBy={{ top: 200, bottom: 0 }}
      itemContent={(index, msg) => {
        const showHeader = shouldShowHeader(msg, index);
        const isOwn = msg.author_id === currentUser?.id;
        const isEditing = editingId === msg.id;
        const isHovered = hoveredId === msg.id;
        const msgReactions = reactions.get(msg.id) || [];

        return (
          <div
            className={`message ${showHeader ? 'with-header' : 'compact'} ${isEditing ? 'editing' : ''}`}
            onMouseEnter={() => setHoveredId(msg.id)}
            onMouseLeave={() => {
              setHoveredId(null);
              if (emojiPickerForId === msg.id) setEmojiPickerForId(null);
            }}
          >
            {isHovered && !isEditing && (
              <div className="message-actions">
                <button
                  className="message-action-btn"
                  title="Add reaction"
                  onClick={() => setEmojiPickerForId(emojiPickerForId === msg.id ? null : msg.id)}
                >
                  +
                </button>
                {msg.pinned ? (
                  <button className="message-action-btn" title="Unpin" onClick={() => handlePin(msg.id, true)}>
                    Unpin
                  </button>
                ) : (
                  <button className="message-action-btn" title="Pin" onClick={() => handlePin(msg.id, false)}>
                    Pin
                  </button>
                )}
                {isOwn && (
                  <button className="message-action-btn" title="Edit" onClick={() => startEditing(msg)}>
                    Edit
                  </button>
                )}
                {isOwn && (
                  <button className="message-action-btn danger" title="Delete" onClick={() => handleDelete(msg.id)}>
                    Del
                  </button>
                )}
              </div>
            )}

            {emojiPickerForId === msg.id && (
              <div className="emoji-quick-picker">
                {EMOJI_QUICK_PICKS.map((emoji) => (
                  <button
                    key={emoji}
                    className="emoji-pick-btn"
                    onClick={() => handleReaction(msg.id, emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {showHeader && (
              <div className="message-header">
                <div className="message-avatar">
                  {getAuthorName(msg).charAt(0).toUpperCase()}
                </div>
                <div className="message-meta">
                  <span className={`message-author ${isOwn ? 'own' : ''}`}>
                    {getAuthorName(msg)}
                  </span>
                  <span className="message-timestamp">
                    {formatTime(msg.created_at)}
                  </span>
                </div>
              </div>
            )}

            {isEditing ? (
              <div className="message-edit-wrapper">
                <textarea
                  className="message-edit-input"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  autoFocus
                  rows={1}
                />
                <div className="message-edit-actions">
                  <span className="message-edit-hint">
                    Escape to cancel, Enter to save
                  </span>
                </div>
              </div>
            ) : (
              <div className="message-content">
                {msg.pinned && <span className="message-pin-badge">Pinned</span>}
                {msg.content && <Markdown content={msg.content} />}
                {msg.edited_at && <span className="message-edited">(edited)</span>}
              </div>
            )}

            {msgReactions.length > 0 && (
              <div className="message-reactions">
                {msgReactions.map((r: ReactionGroup) => (
                  <button
                    key={r.emoji_name}
                    className={`reaction-chip ${r.me ? 'me' : ''}`}
                    onClick={() =>
                      r.me
                        ? handleRemoveReaction(msg.id, r.emoji_name)
                        : handleReaction(msg.id, r.emoji_name)
                    }
                  >
                    <span className="reaction-emoji">{r.emoji_name}</span>
                    <span className="reaction-count">{r.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
