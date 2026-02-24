import { useState, useEffect, useCallback, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import type { ChannelLink } from '../../types';
import * as api from '../../api/client';

interface LinkCollectionPanelProps {
  channelId: string;
  onClose: () => void;
}

export function LinkCollectionPanel({ channelId, onClose }: LinkCollectionPanelProps) {
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const users = useServerStore((s) => s.users);
  const currentUser = useAuthStore((s) => s.user);

  // Add link form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState('');
  const [editNote, setEditNote] = useState('');

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const [linkResults, tagResults] = await Promise.all([
        api.getChannelLinks(channelId, {
          tag: activeTag || undefined,
          search: searchQuery || undefined,
        }),
        api.getChannelLinkTags(channelId),
      ]);
      setLinks(linkResults);
      setTags(tagResults);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [channelId, activeTag, searchQuery]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  // Listen for gateway LINK_COLLECTION_UPDATE events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { channel_id: string };
      if (detail.channel_id === channelId) {
        loadLinks();
      }
    };
    window.addEventListener('drocsid-link-collection-update', handler);
    return () => window.removeEventListener('drocsid-link-collection-update', handler);
  }, [channelId, loadLinks]);

  const handleSearchChange = useCallback((value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(value);
    }, 300);
  }, []);

  const handleTagClick = useCallback((tag: string) => {
    setActiveTag((prev) => (prev === tag ? null : tag));
  }, []);

  const handleAddLink = useCallback(async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      const tagList = newTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await api.addChannelLink(
        channelId,
        newUrl.trim(),
        tagList.length > 0 ? tagList : undefined,
        newNote.trim() || undefined,
      );
      setNewUrl('');
      setNewTags('');
      setNewNote('');
      setShowAddForm(false);
      loadLinks();
    } catch {
      // ignore
    }
    setAdding(false);
  }, [channelId, newUrl, newTags, newNote, loadLinks]);

  const handleDeleteLink = useCallback(async (e: React.MouseEvent, linkId: string) => {
    e.stopPropagation();
    try {
      await api.deleteChannelLink(channelId, linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch {
      // ignore
    }
  }, [channelId]);

  const startEdit = useCallback((e: React.MouseEvent, link: ChannelLink) => {
    e.stopPropagation();
    setEditingId(link.id);
    setEditTags(link.tags.join(', '));
    setEditNote(link.note || '');
  }, []);

  const handleSaveEdit = useCallback(async (linkId: string) => {
    try {
      const tagList = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await api.updateChannelLink(channelId, linkId, {
        tags: tagList,
        note: editNote.trim() || undefined,
      });
      setEditingId(null);
      loadLinks();
    } catch {
      // ignore
    }
  }, [channelId, editTags, editNote, loadLinks]);

  const getAdderName = (link: ChannelLink) => {
    const cached = users.get(link.added_by);
    return cached?.display_name || cached?.username || 'Unknown User';
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const canModify = (link: ChannelLink) => {
    return link.added_by === currentUser?.id || currentUser?.is_admin;
  };

  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  return (
    <div className="bookmarks-panel">
      <div className="bookmarks-panel-header">
        <h3>Links</h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            className="link-add-btn"
            title="Add Link"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            +
          </button>
          <button className="settings-close" onClick={onClose}>&times;</button>
        </div>
      </div>

      {showAddForm && (
        <div className="link-add-form">
          <input
            type="url"
            placeholder="https://example.com"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddLink()}
            autoFocus
          />
          <input
            type="text"
            placeholder="Tags (comma-separated)"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <div className="link-add-form-actions">
            <button
              className="scheduled-edit-save"
              onClick={handleAddLink}
              disabled={adding || !newUrl.trim()}
            >
              {adding ? 'Adding...' : 'Add Link'}
            </button>
            <button
              className="scheduled-edit-cancel"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bookmarks-search">
        <input
          type="text"
          placeholder="Search links..."
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
        {!loading && links.length === 0 && (
          <p className="pinned-empty">
            {searchQuery || activeTag ? 'No matching links' : 'No links yet. Click + to add one!'}
          </p>
        )}
        {links.map((link) => (
          <div
            key={link.id}
            className="bookmark-card link-card"
            onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
          >
            {link.image && (
              <div className="link-card-image">
                <img src={link.image} alt="" loading="lazy" />
              </div>
            )}
            <div className="bookmark-card-header">
              <span className="link-card-site">{link.site_name || getDomain(link.url)}</span>
              {canModify(link) && (
                <div className="link-card-actions">
                  <button
                    className="bookmark-remove-btn"
                    title="Edit"
                    onClick={(e) => startEdit(e, link)}
                    style={{ fontSize: '0.75rem', marginRight: '0.25rem' }}
                  >
                    Edit
                  </button>
                  <button
                    className="bookmark-remove-btn settings-close"
                    title="Remove link"
                    onClick={(e) => handleDeleteLink(e, link.id)}
                  >
                    &times;
                  </button>
                </div>
              )}
            </div>
            {link.title && (
              <div className="link-card-title">{link.title}</div>
            )}
            {link.description && (
              <div className="bookmark-card-content link-card-description">
                {link.description}
              </div>
            )}
            {link.note && (
              <div className="link-card-note">{link.note}</div>
            )}

            {editingId === link.id && (
              <div className="scheduled-edit-form" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  className="scheduled-edit-textarea"
                  placeholder="Tags (comma-separated)"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  style={{ resize: 'none', minHeight: 'unset' }}
                />
                <input
                  type="text"
                  className="scheduled-edit-textarea"
                  placeholder="Note (optional)"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  style={{ resize: 'none', minHeight: 'unset' }}
                />
                <div className="scheduled-edit-actions">
                  <button className="scheduled-edit-save" onClick={() => handleSaveEdit(link.id)}>Save</button>
                  <button className="scheduled-edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="bookmark-card-footer">
              {link.tags.length > 0 && (
                <div className="bookmark-card-tags">
                  {link.tags.map((tag) => (
                    <span key={tag} className="bookmark-inline-tag">{tag}</span>
                  ))}
                </div>
              )}
              <span className="bookmark-card-context">{getAdderName(link)}</span>
              <span className="bookmark-card-time">{formatTime(link.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
