import { useState, useRef, useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import './CreateChannelModal.css';

interface CreateChannelModalProps {
  serverId: string;
  defaultType?: 'text' | 'voice';
  onClose: () => void;
}

export function CreateChannelModal({ serverId, defaultType = 'text', onClose }: CreateChannelModalProps) {
  const createChannel = useServerStore((s) => s.createChannel);
  const [name, setName] = useState('');
  const [channelType, setChannelType] = useState<'text' | 'voice'>(defaultType);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!trimmed) {
      setError('Channel name is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createChannel(serverId, trimmed, channelType);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
      setSubmitting(false);
    }
  };

  return (
    <div className="create-channel-overlay" onClick={onClose}>
      <div className="create-channel-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="create-channel-title">Create Channel</h2>

        <form onSubmit={handleSubmit}>
          <div className="create-channel-type">
            <label className="create-channel-label">Channel Type</label>
            <div className="create-channel-type-options">
              <button
                type="button"
                className={`create-channel-type-btn ${channelType === 'text' ? 'active' : ''}`}
                onClick={() => setChannelType('text')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.88 21l2.12-7H4l.76-2h4l1.52-5H6.24l.76-2h4l2.12-7h2l-2.12 7H17l2.12-7h2l-2.12 7H23l-.76 2h-4l-1.52 5h4l-.76 2h-4l-2.12 7h-2l2.12-7H9.88l-2.12 7h-2zM10.64 12l-1.52 5h4l1.52-5h-4z" />
                </svg>
                <span>Text</span>
              </button>
              <button
                type="button"
                className={`create-channel-type-btn ${channelType === 'voice' ? 'active' : ''}`}
                onClick={() => setChannelType('voice')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1zM6.56 7.56a1 1 0 0 0-1.41 0C3.14 9.57 2 12.18 2 15a1 1 0 0 0 2 0c0-2.28.92-4.34 2.56-5.97a1 1 0 0 0 0-1.41zM18.85 7.56a1 1 0 0 0-1.41 1.41C19.08 10.66 20 12.72 20 15a1 1 0 0 0 2 0c0-2.82-1.14-5.43-3.15-7.44zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
                </svg>
                <span>Voice</span>
              </button>
            </div>
          </div>

          <div className="create-channel-field">
            <label className="create-channel-label" htmlFor="channel-name">Channel Name</label>
            <div className="create-channel-input-wrapper">
              <span className="create-channel-input-prefix">
                {channelType === 'text' ? '#' : '🔊'}
              </span>
              <input
                ref={inputRef}
                id="channel-name"
                type="text"
                className="create-channel-input"
                placeholder="new-channel"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </div>
          </div>

          {error && <div className="create-channel-error">{error}</div>}

          <div className="create-channel-actions">
            <button type="button" className="create-channel-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="create-channel-submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
