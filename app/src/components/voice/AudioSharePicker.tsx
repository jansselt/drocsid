import { useEffect, useState, useCallback } from 'react';
import type { AudioApp } from '../../types/electron';
import './AudioSharePicker.css';

interface AudioSharePickerProps {
  onClose: () => void;
  onShare: (nodeIds: number[], systemMode: boolean) => void;
}

export function AudioSharePicker({ onClose, onShare }: AudioSharePickerProps) {
  const [apps, setApps] = useState<AudioApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [systemMode, setSystemMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchApps = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const electronAPI = window.electronAPI;
      if (!electronAPI?.listAudioApplications) {
        setError('Audio sharing is only available in the desktop app on Linux.');
        return;
      }
      const result = await electronAPI.listAudioApplications();
      setApps(result);
    } catch (e) {
      setError('Failed to list audio applications. Make sure PipeWire is running.');
      console.error('[AudioSharePicker] Error listing apps:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  const toggleApp = (nodeId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
    // Deselect system mode if user picks individual apps
    if (systemMode) setSystemMode(false);
  };

  const toggleSystemMode = () => {
    const newSystemMode = !systemMode;
    setSystemMode(newSystemMode);
    if (newSystemMode) {
      // Select all apps
      setSelected(new Set(apps.map((a) => a.nodeId)));
    } else {
      setSelected(new Set());
    }
  };

  const handleShare = () => {
    const nodeIds = Array.from(selected);
    if (nodeIds.length === 0 && !systemMode) return;
    onShare(nodeIds, systemMode);
  };

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="audio-share-backdrop" onClick={onClose}>
      <div className="audio-share-picker" onClick={(e) => e.stopPropagation()}>
        <div className="audio-share-header">
          <h3>Share Audio</h3>
          <button className="audio-share-close" onClick={onClose} title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {error && <div className="audio-share-error">{error}</div>}

        <div className="audio-share-list">
          {loading ? (
            <div className="audio-share-loading">Scanning audio applications...</div>
          ) : (
            <>
              {/* System Audio toggle */}
              <button
                className="audio-share-item"
                onClick={toggleSystemMode}
              >
                <div className={`audio-share-item-icon system`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                </div>
                <div className="audio-share-item-info">
                  <span className="audio-share-item-name">System Audio</span>
                  <span className="audio-share-item-desc">Share all application audio</span>
                </div>
                <input
                  type="checkbox"
                  checked={systemMode}
                  onChange={toggleSystemMode}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginLeft: 'auto', accentColor: 'var(--accent)' }}
                />
              </button>

              {apps.length > 0 && <div className="audio-share-divider" />}

              {apps.length === 0 && !loading && (
                <div className="audio-share-empty">
                  No audio applications detected. Start playing audio in an application and refresh.
                </div>
              )}

              {apps.map((app) => (
                <button
                  key={app.nodeId}
                  className="audio-share-item"
                  onClick={() => toggleApp(app.nodeId)}
                >
                  <div className="audio-share-item-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                  <div className="audio-share-item-info">
                    <span className="audio-share-item-name">{app.name}</span>
                    <span className="audio-share-item-desc">
                      {app.streamName || app.binary}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.has(app.nodeId)}
                    onChange={() => toggleApp(app.nodeId)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginLeft: 'auto', accentColor: 'var(--accent)' }}
                  />
                </button>
              ))}
            </>
          )}
        </div>

        <div className="audio-share-footer">
          <button
            className="audio-share-refresh"
            onClick={fetchApps}
            disabled={refreshing}
            title="Refresh application list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            </svg>
            Refresh
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="audio-share-refresh"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="audio-share-refresh"
            onClick={handleShare}
            disabled={selected.size === 0 && !systemMode}
            style={{
              background: 'var(--accent)',
              color: '#fff',
              opacity: selected.size === 0 && !systemMode ? 0.5 : 1,
            }}
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
