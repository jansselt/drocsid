import { useEffect, useState, useCallback, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import type { Message, ReactionGroup } from '../../types';
import { Markdown } from './Markdown';
import { PollCard } from './PollCard';
import './MessageList.css';

interface MessageListProps {
  channelId: string;
}

const EMOJI_QUICK_PICKS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F44E}', '\u{1F389}', '\u{1F440}'];
const EMPTY_MESSAGES: Message[] = [];
const AT_BOTTOM_THRESHOLD = 150;

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
  const setReplyingTo = useServerStore((s) => s.setReplyingTo);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const members = useServerStore((s) => activeServerId ? s.members.get(activeServerId) : undefined);
  const roles = useServerStore((s) => activeServerId ? s.roles.get(activeServerId) : undefined);
  const bookmarkedMessageIds = useServerStore((s) => s.bookmarkedMessageIds);
  const toggleBookmark = useServerStore((s) => s.toggleBookmark);
  const polls = useServerStore((s) => s.polls);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [emojiPickerForId, setEmojiPickerForId] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isLoadingMore = useRef(false);
  const atBottomRef = useRef(true);
  const prevMsgCountRef = useRef(0);

  // ── Helpers ──────────────────────────────────────────────────────────

  const isAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // ── Channel switch: reset state ──────────────────────────────────────

  useEffect(() => {
    setEditingId(null);
    setEmojiPickerForId(null);
    setHoveredId(null);
    setShowScrollBtn(false);
    isLoadingMore.current = false;
    atBottomRef.current = true;
    prevMsgCountRef.current = 0;
  }, [channelId]);

  // ── Scroll to bottom when messages arrive ─────────────────────────────

  useEffect(() => {
    const count = messages.length;
    const prevCount = prevMsgCountRef.current;
    prevMsgCountRef.current = count;

    if (count <= prevCount || count === 0) return;

    // Older messages were prepended (history load) — don't scroll to bottom
    if (isLoadingMore.current) return;

    const lastMsg = messages[count - 1];
    const isOwn = lastMsg?.author_id === currentUser?.id;

    if (atBottomRef.current || isOwn) {
      const el = scrollRef.current;
      if (!el) return;

      if (isOwn && !atBottomRef.current) {
        // User sent a message while scrolled up — smooth scroll once
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        // At bottom: scroll immediately + grace period re-scrolls.
        // Images/embeds have no explicit dimensions and start at 0px,
        // so scrollHeight grows as media loads. The grace period catches
        // fast-loading media; the capture-phase load listener (below)
        // handles anything that finishes after the grace window.
        const doScroll = () => {
          if (!atBottomRef.current) return;
          el.scrollTop = el.scrollHeight;
        };
        doScroll();
        const timers = [50, 150, 400].map((ms) => setTimeout(doScroll, ms));
        return () => timers.forEach(clearTimeout);
      }
    }
  }, [messages.length, messages, currentUser?.id]);

  // When images/embeds finish loading they expand content height.
  // Re-scroll to bottom if user hasn't scrolled away. Uses capture
  // phase because the load event doesn't bubble.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleLoad = () => {
      if (atBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    };
    el.addEventListener('load', handleLoad, true);
    return () => el.removeEventListener('load', handleLoad, true);
  }, [channelId]);

  // ── Scroll event: track atBottom + load-more-on-scroll-up ───────────

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const bottom = isAtBottom();
      if (atBottomRef.current !== bottom) {
        atBottomRef.current = bottom;
        setShowScrollBtn(!bottom);
      }

      // Load more when near top
      if (el.scrollTop < 200 && !isLoadingMore.current && messages.length > 0) {
        isLoadingMore.current = true;
        const prevHeight = el.scrollHeight;
        loadMoreMessages(channelId)
          .then((hasMore) => {
            if (hasMore !== false) {
              // Preserve scroll position after prepending older messages.
              // Clear isLoadingMore INSIDE the rAF, after the scroll
              // restoration, so the scroll event doesn't immediately
              // re-trigger another load.
              requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight - prevHeight;
                isLoadingMore.current = false;
              });
            } else {
              isLoadingMore.current = false;
            }
          })
          .catch(() => {
            isLoadingMore.current = false;
          });
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [channelId, messages.length, isAtBottom, loadMoreMessages]);

  // ── Message rendering helpers ───────────────────────────────────────

  const getAuthor = (msg: Message): { name: string; avatar_url: string | null } => {
    if (!msg.author_id) return { name: 'Deleted User', avatar_url: null };
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

  const shouldShowHeader = (index: number): boolean => {
    if (index <= 0) return true;
    const msg = messages[index];
    const prev = messages[index - 1];
    if (!prev || prev.author_id !== msg.author_id) return true;
    const diff = new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff > 5 * 60 * 1000;
  };

  // ── Action handlers ─────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="message-list-wrapper">
      <div key={channelId} ref={scrollRef} className="message-list">
        {messages.length === 0 ? (
          <div className="message-list-empty">
            <p>No messages yet. Say something!</p>
          </div>
        ) : messages.map((msg, index) => {
          const showHeader = shouldShowHeader(index);
          const isOwn = msg.author_id === currentUser?.id;
          const isEditing = editingId === msg.id;
          const isHovered = hoveredId === msg.id;
          const msgReactions = reactions.get(msg.id) || [];

          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={`message ${showHeader ? 'with-header' : 'compact'} ${isEditing ? 'editing' : ''} ${msg.pinned ? 'pinned' : ''}`}
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
                    title="Reply"
                    onClick={() => setReplyingTo(msg)}
                  >
                    Reply
                  </button>
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
                  <button
                    className={`message-action-btn${bookmarkedMessageIds.has(msg.id) ? ' bookmarked' : ''}`}
                    title={bookmarkedMessageIds.has(msg.id) ? 'Remove Bookmark' : 'Bookmark'}
                    onClick={() => toggleBookmark(msg.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={bookmarkedMessageIds.has(msg.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  {isOwn && (
                    <button className="message-action-btn" title="Edit" onClick={() => startEditing(msg)}>
                      Edit
                    </button>
                  )}
                  {(isOwn || currentUser?.is_admin) && (
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

              {msg.reply_to_id && (() => {
                const replyMsg = messages.find((m) => m.id === msg.reply_to_id);
                const replyAuthor = replyMsg ? getAuthorName(replyMsg) : null;
                const replyPreview = replyMsg?.content
                  ? replyMsg.content.length > 100 ? replyMsg.content.slice(0, 100) + '...' : replyMsg.content
                  : null;
                return (
                  <div
                    className="reply-context"
                    onClick={() => {
                      if (replyMsg) {
                        document.getElementById(`msg-${replyMsg.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }}
                  >
                    <span className="reply-author">@{replyAuthor ?? 'Unknown'}</span>
                    <span className="reply-preview">{replyPreview ?? 'Message not loaded'}</span>
                  </div>
                );
              })()}

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

              {polls.has(msg.id) && (
                <PollCard messageId={msg.id} channelId={channelId} />
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
        })}
      </div>


      {showScrollBtn && (
        <button
          className="scroll-to-bottom-btn"
          onClick={() => scrollToBottom('smooth')}
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
