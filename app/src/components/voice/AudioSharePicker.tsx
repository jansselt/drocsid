import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './AudioSharePicker.css';

interface AudioApplication {
  node_id: number;
  name: string;
  binary: string;
  stream_name: string;
}

interface AudioSharePickerProps {
  onStart: (targetNodeIds: number[], systemMode: boolean) => void;
  onClose: () => void;
}

export function AudioSharePicker({ onStart, onClose }: AudioSharePickerProps) {
  const [apps, setApps] = useState<AudioApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadApps = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<AudioApplication[]>('list_audio_applications');
      setApps(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApps();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSelectApp = (app: AudioApplication) => {
    onStart([app.node_id], false);
  };

  const handleSelectSystemAudio = () => {
    const allNodeIds = apps.map((a) => a.node_id);
    onStart(allNodeIds, true);
  };

  return (
    <div className="audio-share-backdrop" onClick={onClose}>
      <div className="audio-share-picker" onClick={(e) => e.stopPropagation()}>
        <div className="audio-share-header">
          <h3>Share Audio</h3>
          <button className="audio-share-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="audio-share-error">{error}</div>
        )}

        <div className="audio-share-list">
          {loading ? (
            <div className="audio-share-loading">Scanning audio streams...</div>
          ) : apps.length === 0 ? (
            <div className="audio-share-empty">No audio applications detected</div>
          ) : (
            <>
              {/* System Audio option */}
              <button
                className="audio-share-item system"
                onClick={handleSelectSystemAudio}
              >
                <div className="audio-share-item-icon system">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                </div>
                <div className="audio-share-item-info">
                  <span className="audio-share-item-name">System Audio</span>
                  <span className="audio-share-item-desc">All apps (excludes Drocsid)</span>
                </div>
              </button>

              <div className="audio-share-divider" />

              {/* Individual apps */}
              {apps.map((app) => (
                <button
                  key={app.node_id}
                  className="audio-share-item"
                  onClick={() => handleSelectApp(app)}
                >
                  <div className="audio-share-item-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" />
                    </svg>
                  </div>
                  <div className="audio-share-item-info">
                    <span className="audio-share-item-name">{app.name}</span>
                    {app.stream_name && app.stream_name !== app.name && (
                      <span className="audio-share-item-desc">{app.stream_name}</span>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="audio-share-footer">
          <button className="audio-share-refresh" onClick={loadApps} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            </svg>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
