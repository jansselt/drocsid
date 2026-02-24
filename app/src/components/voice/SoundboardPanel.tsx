import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import * as api from '../../api/client';
import { measureAudioDuration, preloadSounds, getSoundboardVolume, setSoundboardVolume } from '../../utils/soundboardAudio';
import type { SoundboardSound } from '../../types';
import './SoundboardPanel.css';

interface SoundboardPanelProps {
  serverId: string;
  onClose: () => void;
}

const MAX_DURATION_MS = 15_000;
const MAX_JOIN_SOUND_MS = 5_000;

export function SoundboardPanel({ serverId, onClose }: SoundboardPanelProps) {
  const sounds = useServerStore((s) => s.soundboardSounds.get(serverId)) || [];
  const loadSoundboard = useServerStore((s) => s.loadSoundboard);
  const playSoundboard = useServerStore((s) => s.playSoundboard);

  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [volume, setVolume] = useState(getSoundboardVolume);
  const [contextMenu, setContextMenu] = useState<{ sound: SoundboardSound; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  // Load sounds on mount
  useEffect(() => {
    loadSoundboard(serverId);
  }, [serverId, loadSoundboard]);

  // Preload audio when sounds change
  useEffect(() => {
    if (sounds.length > 0) preloadSounds(sounds);
  }, [sounds]);

  // Close on click outside
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handle);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handle = (e: MouseEvent) => {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [contextMenu]);

  const filtered = useMemo(() => {
    if (!search) return sounds;
    const q = search.toLowerCase();
    return sounds.filter((s) => s.name.toLowerCase().includes(q));
  }, [sounds, search]);

  const handlePlay = useCallback(
    (soundId: string) => {
      playSoundboard(serverId, soundId);
    },
    [serverId, playSoundboard],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, sound: SoundboardSound) => {
    e.preventDefault();
    setContextMenu({ sound, x: e.clientX, y: e.clientY });
  }, []);

  const handleSetJoinSound = useCallback(
    async (sound: SoundboardSound) => {
      setContextMenu(null);
      if (sound.duration_ms > MAX_JOIN_SOUND_MS) {
        alert(`Join sound must be ${MAX_JOIN_SOUND_MS / 1000} seconds or shorter`);
        return;
      }
      try {
        await api.setJoinSound(serverId, sound.id);
      } catch (e) {
        console.error('Failed to set join sound:', e);
      }
    },
    [serverId],
  );

  const handleDeleteSound = useCallback(
    async (sound: SoundboardSound) => {
      setContextMenu(null);
      try {
        await api.deleteSoundboardSound(serverId, sound.id);
      } catch (e) {
        console.error('Failed to delete sound:', e);
      }
    },
    [serverId],
  );

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setSoundboardVolume(v);
  }, []);

  return (
    <div className="soundboard-panel" ref={panelRef} onClick={(e) => e.stopPropagation()}>
      <div className="soundboard-header">
        <input
          className="soundboard-search"
          type="text"
          placeholder="Search sounds..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button className="soundboard-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="soundboard-grid">
        {filtered.map((sound) => (
          <button
            key={sound.id}
            className="soundboard-btn"
            onClick={() => handlePlay(sound.id)}
            onContextMenu={(e) => handleContextMenu(e, sound)}
            title={`${sound.name} (${(sound.duration_ms / 1000).toFixed(1)}s)`}
          >
            <span className="soundboard-btn-emoji">
              {sound.emoji_name || sound.name.charAt(0).toUpperCase()}
            </span>
            <span className="soundboard-btn-name">{sound.name}</span>
          </button>
        ))}
        {filtered.length === 0 && sounds.length > 0 && (
          <span className="soundboard-empty">No sounds match</span>
        )}
        {sounds.length === 0 && (
          <span className="soundboard-empty">No sounds yet</span>
        )}
      </div>

      <div className="soundboard-footer">
        <div className="soundboard-volume">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            className="soundboard-volume-slider"
          />
        </div>
        <button className="soundboard-upload-btn" onClick={() => setShowUpload(true)}>
          + Add Sound
        </button>
      </div>

      {showUpload && (
        <SoundUploadModal
          serverId={serverId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            loadSoundboard(serverId);
          }}
        />
      )}

      {contextMenu && (
        <div
          className="soundboard-context-menu"
          ref={contextRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.sound.duration_ms <= MAX_JOIN_SOUND_MS && (
            <button onClick={() => handleSetJoinSound(contextMenu.sound)}>
              Set as Join Sound
            </button>
          )}
          <button onClick={() => handleDeleteSound(contextMenu.sound)}>Delete Sound</button>
        </div>
      )}
    </div>
  );
}

// ── Upload Modal ────────────────────────────────────────

interface SoundUploadModalProps {
  serverId: string;
  onClose: () => void;
  onUploaded: () => void;
}

function SoundUploadModal({ serverId, onClose, onUploaded }: SoundUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [emojiName, setEmojiName] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError('');

    // Auto-set name from filename if empty
    if (!name) {
      const baseName = f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
      setName(baseName.slice(0, 32));
    }

    try {
      const ms = await measureAudioDuration(f);
      setDuration(ms);
      if (ms > MAX_DURATION_MS) {
        setError(`Audio is ${(ms / 1000).toFixed(1)}s — max is ${MAX_DURATION_MS / 1000}s`);
      }
    } catch {
      setError('Could not read audio file');
    }
  }, [name]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file || !name.trim() || duration === null) return;
      if (duration > MAX_DURATION_MS) return;

      setUploading(true);
      setError('');
      try {
        await api.uploadSoundboardSound(serverId, file, name.trim(), duration, emojiName || undefined);
        onUploaded();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [file, name, emojiName, duration, serverId, onUploaded],
  );

  return (
    <div className="soundboard-upload-overlay" onClick={onClose}>
      <form
        className="soundboard-upload-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h3>Add Sound</h3>
        <label className="soundboard-file-input">
          <span>{file ? file.name : 'Choose audio file...'}</span>
          <input
            type="file"
            accept="audio/mpeg,audio/ogg,audio/wav,audio/webm"
            onChange={handleFileChange}
          />
        </label>
        {duration !== null && (
          <span className="soundboard-duration">
            Duration: {(duration / 1000).toFixed(1)}s
          </span>
        )}
        <input
          type="text"
          className="soundboard-name-input"
          placeholder="Sound name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 32))}
          maxLength={32}
          required
        />
        <input
          type="text"
          className="soundboard-emoji-input"
          placeholder="Emoji (optional)"
          value={emojiName}
          onChange={(e) => setEmojiName(e.target.value)}
          maxLength={4}
        />
        {error && <span className="soundboard-error">{error}</span>}
        <div className="soundboard-upload-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!file || !name.trim() || uploading || !!error}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </form>
    </div>
  );
}
