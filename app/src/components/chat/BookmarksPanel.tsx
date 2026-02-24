import { useState, useEffect, useCallback, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { Markdown } from './Markdown';
import type { Bookmark } from '../../types';
import * as api from '../../api/client';

interface BookmarksPanelProps {
  onClose: () => void;
}

export function BookmarksPanel({ onClose }: BookmarksPanelProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const users = useServerStore((s) => s.users);

  const loadBookmarks = useCallback(async () => {
    setLoading(true);
    try {
      const [bookmarkResults, tagResults] = await Promise.all([
        api.getBookmarks({
          tag: activeTag || undefined,
          search: searchQuery || undefined,
        }),
        api.getBookmarkTags(),
      ]);
      setBookmarks(bookmarkResults);
      setTags(tagResults);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [activeTag, searchQuery]);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const handleSearchChange = useCallback((value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(value);
    }, 300);
  }, []);

  const handleTagClick = useCallback((tag: string) => {
    setActiveTag((prev) => (prev === tag ? null : tag));
  }, []);

  const navigateToMessage = useCallback((bookmark: Bookmark) => {
    const store = useServerStore.getState();
    if (bookmark.server_id) {
      store.setActiveServer(bookmark.server_id);
      // Wait for channels to load, then set channel
      setTimeout(() => {
        store.setActiveChannel(bookmark.channel_id);
        // Scroll to message after channel loads
        setTimeout(() => {
          const el = document.getElementById(`msg-${bookmark.message_id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-flash');
            setTimeout(() => el.classList.remove('highlight-flash'), 2000);
          }
        }, 300);
      }, 100);
    } else {
      // DM channel
      store.setView('home');
      store.setActiveChannel(bookmark.channel_id);
      setTimeout(() => {
        const el = document.getElementById(`msg-${bookmark.message_id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight-flash');
          setTimeout(() => el.classList.remove('highlight-flash'), 2000);
        }
      }, 300);
    }
    onClose();
  }, [onClose]);

  const handleRemoveBookmark = useCallback(async (e: React.MouseEvent, messageId: string) => {
    e.stopPropagation();
    try {
      await api.removeBookmark(messageId);
      setBookmarks((prev) => prev.filter((b) => b.message_id !== messageId));
      useServerStore.setState((state) => {
        const ids = new Set(state.bookmarkedMessageIds);
        ids.delete(messageId);
        return { bookmarkedMessageIds: ids };
      });
    } catch {
      // ignore
    }
  }, []);

  const getAuthorName = (bookmark: Bookmark) => {
    if (bookmark.author) return bookmark.author.display_name || bookmark.author.username;
    if (!bookmark.author_id) return 'Deleted User';
    const cached = users.get(bookmark.author_id);
    return cached?.display_name || cached?.username || 'Unknown User';
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getContext = (bookmark: Bookmark) => {
    const parts: string[] = [];
    if (bookmark.channel_name) parts.push(`#${bookmark.channel_name}`);
    if (bookmark.server_name) parts.push(bookmark.server_name);
    return parts.join(' \u00b7 ');
  };

  return (
    <div className="bookmarks-panel">
      <div className="bookmarks-panel-header">
        <h3>Bookmarks</h3>
        <button className="settings-close" onClick={onClose}>&times;</button>
      </div>

      <div className="bookmarks-search">
        <input
          type="text"
          placeholder="Search bookmarks..."
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {tags.length > 0 && (
        <div className="bookmarks-tags">
          {tags.map((tag) => (
            <button
              key={tag}
              className={`bookmark-tag-chip${activeTag === tag ? ' active' : ''}`}
              onClick={() => handleTagClick(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="bookmarks-body">
        {loading && <p className="pinned-empty">Loading...</p>}
        {!loading && bookmarks.length === 0 && (
          <p className="pinned-empty">
            {searchQuery || activeTag ? 'No matching bookmarks' : 'No bookmarks yet'}
          </p>
        )}
        {bookmarks.map((bookmark) => (
          <div
            key={bookmark.message_id}
            className="bookmark-card"
            onClick={() => navigateToMessage(bookmark)}
          >
            <div className="bookmark-card-header">
              <span className="bookmark-card-author">{getAuthorName(bookmark)}</span>
              <button
                className="bookmark-remove-btn settings-close"
                title="Remove bookmark"
                onClick={(e) => handleRemoveBookmark(e, bookmark.message_id)}
              >
                &times;
              </button>
            </div>
            <div className="bookmark-card-content">
              <Markdown content={bookmark.content || ''} />
            </div>
            <div className="bookmark-card-footer">
              {bookmark.tags.length > 0 && (
                <div className="bookmark-card-tags">
                  {bookmark.tags.map((tag) => (
                    <span key={tag} className="bookmark-inline-tag">{tag}</span>
                  ))}
                </div>
              )}
              <span className="bookmark-card-context">{getContext(bookmark)}</span>
              <span className="bookmark-card-time">{formatTime(bookmark.bookmarked_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
