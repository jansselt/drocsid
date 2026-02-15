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
const START_INDEX = 100_000;

const scrollLog = (...args: unknown[]) => console.debug('[scroll]', ...args);

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
  const activeServerId = useServerStore((s) => s.activeServerId);
  const members = useServerStore((s) => activeServerId ? s.members.get(activeServerId) : undefined);
  const roles = useServerStore((s) => activeServerId ? s.roles.get(activeServerId) : undefined);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [emojiPickerForId, setEmojiPickerForId] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const isLoadingMore = useRef(false);
  const atBottomRef = useRef(true);
  const prevChannelRef = useRef(channelId);
  const graceRef = useRef(true); // Grace period: always re-scroll on media load
  const graceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Reset state on channel switch
  useEffect(() => {
    scrollLog('channel switch →', channelId, '| msgs:', messages.length);
    setEditingId(null);
    setEmojiPickerForId(null);
    setHoveredId(null);
    setShowScrollBtn(false);
    setFirstItemIndex(START_INDEX);
    isLoadingMore.current = false;
    atBottomRef.current = true;
    prevChannelRef.current = channelId;

    // Grace period: for 5s after channel switch, always re-scroll when media
    // loads regardless of atBottom state. GIFs/images expand content height
    // after initial scroll, causing atBottom to flicker false before all media
    // has loaded. Without grace, subsequent loads see atBottom=false and skip
    // re-scrolling, leaving the user stuck mid-chat.
    graceRef.current = true;
    clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(() => {
      scrollLog('grace period ended');
      graceRef.current = false;
    }, 5000);
  }, [channelId]);

  // Re-scroll when images/embeds load (they change scrollHeight).
  // Virtuoso's followOutput handles new-item scrolling, but async media loads
  // can increase content height after the initial scroll, pushing the bottom
  // out of view (e.g. GIF messages). Re-scroll whenever at the bottom.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleLoad = (e: Event) => {
      const target = e.target as HTMLElement;
      // Skip avatar images — they're fixed-size and don't affect scroll height.
      // Virtuoso re-mounts them on scroll, creating a feedback loop.
      if (target.closest('.message-avatar')) return;

      const tag = target.tagName;
      const src = (target as HTMLImageElement)?.src?.slice(0, 80);
      const shouldScroll = atBottomRef.current || graceRef.current;
      scrollLog('media loaded', tag, src, '| atBottom:', atBottomRef.current, '| grace:', graceRef.current, '| willScroll:', shouldScroll);
      if (shouldScroll) {
        // Debounce: collapse rapid-fire load events (e.g. multiple GIFs in one
        // message) into a single scroll after things settle.
        clearTimeout(scrollDebounceRef.current);
        scrollDebounceRef.current = setTimeout(() => {
          const container = scrollContainerRef.current;
          if (!container) return;
          const gap = container.scrollHeight - container.scrollTop - container.clientHeight;
          if (gap < 1) return;
          scrollLog('re-scrolling after media load → scrollTop', container.scrollHeight, '| gap:', gap);
          container.scrollTop = container.scrollHeight;
        }, 150);
      }
    };

    // Capture phase catches load events from descendant img/iframe elements
    el.addEventListener('load', handleLoad, true);
    return () => {
      el.removeEventListener('load', handleLoad, true);
    };
  }, [channelId, messages.length]);

  // Auto-scroll for own messages even when scrolled up
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.author_id === currentUser?.id && !atBottomRef.current) {
      scrollLog('own message sent while scrolled up → scrolling to bottom');
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages.length, messages, currentUser?.id]);

  // Virtuoso callbacks
  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    if (atBottomRef.current !== atBottom) {
      scrollLog('atBottom changed:', atBottomRef.current, '→', atBottom);
    }
    atBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const handleStartReached = useCallback(() => {
    if (isLoadingMore.current || messages.length === 0) return;
    scrollLog('startReached — loading older messages, current count:', messages.length);
    isLoadingMore.current = true;
    const prevCount = messages.length;
    loadMoreMessages(channelId)
      .then((hasMore) => {
        if (hasMore !== false) {
          const newCount = useServerStore.getState().messages.get(channelId)?.length ?? 0;
          const added = newCount - prevCount;
          scrollLog('loaded', added, 'older messages, total:', newCount);
          if (added > 0) {
            setFirstItemIndex((prev) => prev - added);
          }
        } else {
          scrollLog('no more messages to load');
        }
        isLoadingMore.current = false;
      })
      .catch(() => {
        isLoadingMore.current = false;
      });
  }, [channelId, loadMoreMessages, messages.length]);

  const scrollerRefCallback = useCallback((el: HTMLElement | Window | null) => {
    scrollContainerRef.current = el as HTMLElement;
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollLog('scrollToBottom button clicked');
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // Helper functions
  const getAuthor = (msg: Message): { name: string; avatar_url: string | null } => {
    const user = msg.author ?? users.get(msg.author_id);
    return {
      name: user?.display_name || user?.username || 'Unknown User',
      avatar_url: user?.avatar_url ?? null,
    };
  };

  const getAuthorName = (msg: Message): string => getAuthor(msg).name;

  const getAuthorRoleColor = (msg: Message): string | undefined => {
    if (!members || !roles) return undefined;
    const member = members.find((m) => m.user_id === msg.author_id);
    if (!member || member.role_ids.length === 0) return undefined;
    let best: { color: number; position: number } | undefined;
    for (const rid of member.role_ids) {
      const role = roles.find((r) => r.id === rid);
      if (role && role.color && (!best || role.position > best.position)) {
        best = role;
      }
    }
    return best ? `#${best.color.toString(16).padStart(6, '0')}` : undefined;
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
    const arrayIndex = index - firstItemIndex;
    if (arrayIndex <= 0) return true;
    const prev = messages[arrayIndex - 1];
    if (!prev || prev.author_id !== msg.author_id) return true;
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

  const itemContent = useCallback(
    (index: number, msg: Message) => {
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
                {getAuthor(msg).avatar_url ? (
                  <img src={getAuthor(msg).avatar_url!} alt="" />
                ) : (
                  getAuthorName(msg).charAt(0).toUpperCase()
                )}
              </div>
              <div className="message-meta">
                <span
                  className={`message-author ${isOwn ? 'own' : ''}`}
                  style={!isOwn ? { color: getAuthorRoleColor(msg) } : undefined}
                >
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      messages, currentUser?.id, editingId, editContent, hoveredId,
      emojiPickerForId, reactions, users, channelId, handleEditKeyDown,
      handleDelete, handleReaction, handleRemoveReaction, handlePin, startEditing,
    ],
  );

  if (messages.length === 0) {
    scrollLog('render: no messages, showing empty state');
    return (
      <div className="message-list-wrapper">
        <div className="message-list">
          <div className="message-list-empty">
            <p>No messages yet. Say something!</p>
          </div>
        </div>
      </div>
    );
  }

  scrollLog('render: mounting Virtuoso | msgs:', messages.length, '| initialIndex:', messages.length - 1, '| firstItemIndex:', firstItemIndex);

  return (
    <div className="message-list-wrapper">
      <Virtuoso
        key={channelId}
        ref={virtuosoRef}
        className="message-list"
        data={messages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={messages.length - 1}
        followOutput={(isAtBottom: boolean) => {
          const result = isAtBottom ? 'smooth' : false;
          scrollLog('followOutput called | atBottom:', isAtBottom, '→', result);
          return result;
        }}
        startReached={handleStartReached}
        atBottomStateChange={handleAtBottomChange}
        atBottomThreshold={150}
        scrollerRef={scrollerRefCallback}
        increaseViewportBy={{ top: 200, bottom: 200 }}
        itemContent={itemContent}
      />

      {showScrollBtn && (
        <button
          className="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          title="Jump to latest messages"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </button>
      )}
    </div>
  );
}
