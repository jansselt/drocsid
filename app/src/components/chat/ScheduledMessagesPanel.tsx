import { useState, useEffect, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { Markdown } from './Markdown';
import type { ScheduledMessage } from '../../types';

interface ScheduledMessagesPanelProps {
  onClose: () => void;
}

export function ScheduledMessagesPanel({ onClose }: ScheduledMessagesPanelProps) {
  const scheduledMessages = useServerStore((s) => s.scheduledMessages);
  const loadScheduledMessages = useServerStore((s) => s.loadScheduledMessages);
  const cancelScheduledMessage = useServerStore((s) => s.cancelScheduledMessage);
  const updateScheduledMessage = useServerStore((s) => s.updateScheduledMessage);
  const channels = useServerStore((s) => s.channels);
  const dmChannels = useServerStore((s) => s.dmChannels);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSendAt, setEditSendAt] = useState('');

  useEffect(() => {
    setLoading(true);
    loadScheduledMessages().finally(() => setLoading(false));
  }, [loadScheduledMessages]);

  const getChannelName = useCallback(
    (channelId: string) => {
      // Check server channels
      for (const [, chans] of channels) {
        const ch = chans.find((c) => c.id === channelId);
        if (ch) return `#${ch.name}`;
      }
      // Check DM channels
      const dm = dmChannels.find((c) => c.id === channelId);
      if (dm) return dm.name || 'DM';
      return 'Unknown channel';
    },
    [channels, dmChannels],
  );

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' at ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  };

  const toLocalDatetimeString = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleEdit = (msg: ScheduledMessage) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
    setEditSendAt(toLocalDatetimeString(msg.send_at));
  };

  const handleSaveEdit = async (id: string) => {
    const original = scheduledMessages.find((m) => m.id === id);
    if (!original) return;

    const data: { content?: string; send_at?: string } = {};
    if (editContent !== original.content) data.content = editContent;

    const newSendAt = new Date(editSendAt).toISOString();
    if (newSendAt !== original.send_at) data.send_at = newSendAt;

    if (Object.keys(data).length > 0) {
      try {
        await updateScheduledMessage(id, data);
      } catch {
        // ignore
      }
    }
    setEditingId(null);
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelScheduledMessage(id);
    } catch {
      // ignore
    }
  };

  return (
    <div className="bookmarks-panel">
      <div className="bookmarks-panel-header">
        <h3>Scheduled Messages</h3>
        <button className="settings-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="bookmarks-body">
        {loading && <p className="pinned-empty">Loading...</p>}
        {!loading && scheduledMessages.length === 0 && (
          <p className="pinned-empty">No scheduled messages</p>
        )}
        {scheduledMessages.map((msg) => (
          <div key={msg.id} className="bookmark-card">
            <div className="bookmark-card-header">
              <span className="bookmark-card-author">
                {getChannelName(msg.channel_id)}
              </span>
              <button
                className="bookmark-remove-btn settings-close"
                title="Cancel scheduled message"
                onClick={() => handleCancel(msg.id)}
              >
                &times;
              </button>
            </div>

            {editingId === msg.id ? (
              <div className="scheduled-edit-form">
                <textarea
                  className="scheduled-edit-textarea"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={3}
                />
                <input
                  type="datetime-local"
                  className="schedule-picker-input"
                  value={editSendAt}
                  onChange={(e) => setEditSendAt(e.target.value)}
                />
                <div className="scheduled-edit-actions">
                  <button
                    className="scheduled-edit-save"
                    onClick={() => handleSaveEdit(msg.id)}
                  >
                    Save
                  </button>
                  <button
                    className="scheduled-edit-cancel"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="bookmark-card-content">
                  <Markdown content={msg.content} />
                </div>
                <div className="bookmark-card-footer">
                  <span className="bookmark-card-time">
                    Sends {formatTime(msg.send_at)}
                  </span>
                  <button className="scheduled-edit-btn" onClick={() => handleEdit(msg)}>
                    Edit
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
