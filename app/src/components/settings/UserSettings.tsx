import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { useThemeStore, themeNames, themeLabels, applyThemeToDOM, type ThemeName } from '../../stores/themeStore';
import { ImageCropModal } from '../shared/ImageCropModal';
import {
  playMessageSound,
  playMentionSound,
  playVoiceJoinSound,
  playVoiceLeaveSound,
  getNotificationVolume,
  setNotificationVolume,
} from '../../utils/notificationSounds';
import {
  getBrowserNotificationsEnabled,
  setBrowserNotificationsEnabled,
  getPermissionState,
  requestNotificationPermission,
} from '../../utils/browserNotifications';
import * as api from '../../api/client';
import type { RegistrationCode, Channel } from '../../types';
import { listAudioOutputs, listAudioInputs, saveSpeaker, saveMicrophone, type AudioOutputDevice, type AudioInputDevice } from '../../utils/audioDevices';
import { SHORTCUT_CATEGORIES, mod } from '../common/KeyboardShortcutsDialog';
import '../common/KeyboardShortcutsDialog.css';
import './UserSettings.css';

interface UserSettingsProps {
  onClose: () => void;
}

const themeSwatches: Record<ThemeName, { bg: string; accent: string; text: string }> = {
  dark:              { bg: '#1a1b1e', accent: '#6366f1', text: '#e4e4e7' },
  light:             { bg: '#f3f4f6', accent: '#4f46e5', text: '#111827' },
  midnight:          { bg: '#110f2a', accent: '#7c3aed', text: '#e0def4' },
  forest:            { bg: '#0f1f17', accent: '#10b981', text: '#d4e7dc' },
  rose:              { bg: '#220f1b', accent: '#ec4899', text: '#f0dde6' },
  'solarized-dark':  { bg: '#002b36', accent: '#268bd2', text: '#93a1a1' },
  'solarized-light': { bg: '#fdf6e3', accent: '#268bd2', text: '#073642' },
  dracula:           { bg: '#282a36', accent: '#bd93f9', text: '#f8f8f2' },
  monokai:           { bg: '#272822', accent: '#a6e22e', text: '#f8f8f2' },
  gruvbox:           { bg: '#282828', accent: '#fabd2f', text: '#ebdbb2' },
  nord:              { bg: '#2e3440', accent: '#88c0d0', text: '#d8dee9' },
  catppuccin:        { bg: '#1e1e2e', accent: '#cba6f7', text: '#cdd6f4' },
  'tokyo-night':     { bg: '#1a1b26', accent: '#7aa2f7', text: '#c0caf5' },
  terminal:          { bg: '#0d0d0d', accent: '#00ff00', text: '#00ff00' },
};

export function UserSettings({ onClose }: UserSettingsProps) {
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [activeTab, setActiveTab] = useState<'profile' | 'appearance' | 'notifications' | 'voice' | 'keybinds' | 'admin'>('profile');

  // Profile form state
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const originalDisplayName = user.display_name || '';
  const originalBio = user.bio || '';
  const originalAvatarUrl = user.avatar_url || '';

  const isDirty =
    displayName !== originalDisplayName ||
    bio !== originalBio ||
    avatarUrl !== originalAvatarUrl;

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (displayName !== originalDisplayName) updates.display_name = displayName;
      if (bio !== originalBio) updates.bio = bio;
      if (avatarUrl !== originalAvatarUrl) updates.avatar_url = avatarUrl;

      const updated = await api.updateMe(updates);
      useAuthStore.setState({ user: updated });
    } catch {
      // Error handled silently
    }
    setSaving(false);
  };

  const handleResetProfile = () => {
    setDisplayName(originalDisplayName);
    setBio(originalBio);
    setAvatarUrl(originalAvatarUrl);
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;
    setCropFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCroppedAvatarSave = async (blob: Blob) => {
    setCropFile(null);
    const croppedFile = new File([blob], 'avatar.png', { type: 'image/png' });
    setUploading(true);
    try {
      const { file_url } = await api.uploadAvatar(croppedFile);
      setAvatarUrl(file_url);
      const updated = await api.updateMe({ avatar_url: file_url });
      useAuthStore.setState({ user: updated });
      useServerStore.setState((state) => {
        const users = new Map(state.users);
        users.set(updated.id, updated);
        return { users };
      });
    } catch {
      // Error handled silently
    }
    setUploading(false);
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError('Password is required');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteAccount(deletePassword);
      useAuthStore.getState().logout();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete account';
      setDeleteError(msg);
      setDeleting(false);
    }
  };

  const handleThemeChange = async (name: ThemeName) => {
    setTheme(name);
    try {
      const updated = await api.updateMe({ theme_preference: name });
      useAuthStore.setState({ user: updated });
    } catch {
      // Revert on failure
      applyThemeToDOM(theme);
      useThemeStore.setState({ theme });
    }
  };

  const userDisplayName = user.display_name || user.username;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>User Settings</h2>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-nav">
            <button
              className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveTab('profile')}
            >
              Profile
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
              onClick={() => setActiveTab('appearance')}
            >
              Appearance
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
              onClick={() => setActiveTab('notifications')}
            >
              Notifications
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'voice' ? 'active' : ''}`}
              onClick={() => setActiveTab('voice')}
            >
              Voice &amp; Video
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'keybinds' ? 'active' : ''}`}
              onClick={() => setActiveTab('keybinds')}
            >
              Keybinds
            </button>
            {user.is_admin && (
              <button
                className={`settings-nav-item ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin')}
              >
                Admin
              </button>
            )}
          </div>

          <div className="settings-content">
            {activeTab === 'profile' && (
              <div className="user-profile-panel">
                <div className="profile-avatar-section">
                  <div className="profile-avatar-large">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" />
                    ) : (
                      userDisplayName[0].toUpperCase()
                    )}
                  </div>
                  <button
                    className="profile-avatar-upload-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? 'Uploading...' : 'Upload Avatar'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleAvatarFileSelect}
                  />
                </div>

                <div className="profile-fields">
                  <div className="profile-field">
                    <label>Display Name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={user.username}
                      maxLength={32}
                    />
                    <span className="profile-field-hint">{displayName.length}/32</span>
                  </div>

                  <div className="profile-field">
                    <label>Bio</label>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Tell us about yourself"
                      maxLength={190}
                      rows={3}
                    />
                    <span className="profile-field-hint">{bio.length}/190</span>
                  </div>
                </div>

                {isDirty && (
                  <div className="profile-save-bar">
                    <button
                      className="profile-save-btn"
                      onClick={handleSaveProfile}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button className="profile-reset-btn" onClick={handleResetProfile}>
                      Reset
                    </button>
                  </div>
                )}

                <div className="danger-zone">
                  <h3>Danger Zone</h3>
                  {!showDeleteConfirm ? (
                    <button
                      className="delete-account-btn"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      Delete Account
                    </button>
                  ) : (
                    <div className="delete-confirm">
                      <p>This will permanently delete your account, messages will be preserved but shown as deleted user. Enter your password to confirm.</p>
                      <input
                        type="password"
                        placeholder="Enter your password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleDeleteAccount(); }}
                      />
                      {deleteError && <span className="delete-error">{deleteError}</span>}
                      <div className="delete-confirm-actions">
                        <button
                          className="delete-confirm-btn"
                          onClick={handleDeleteAccount}
                          disabled={deleting}
                        >
                          {deleting ? 'Deleting...' : 'Permanently Delete'}
                        </button>
                        <button
                          className="profile-reset-btn"
                          onClick={() => {
                            setShowDeleteConfirm(false);
                            setDeletePassword('');
                            setDeleteError('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="appearance-panel">
                <h3>Theme</h3>
                <div className="theme-grid">
                  {themeNames.map((name) => {
                    const swatch = themeSwatches[name];
                    return (
                      <button
                        key={name}
                        className={`theme-card ${theme === name ? 'active' : ''}`}
                        onClick={() => handleThemeChange(name)}
                      >
                        <div
                          className="theme-swatch"
                          style={{ background: swatch.bg }}
                        >
                          <div
                            className="theme-swatch-accent"
                            style={{ background: swatch.accent }}
                          />
                          <div
                            className="theme-swatch-text"
                            style={{ color: swatch.text }}
                          >
                            Aa
                          </div>
                        </div>
                        <span className="theme-card-label">{themeLabels[name]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'notifications' && <NotificationSettings />}
            {activeTab === 'voice' && <VoiceVideoSettings />}
            {activeTab === 'keybinds' && (
              <div className="voice-video-settings">
                <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                  Press <kbd className="shortcuts-kbd">{mod}</kbd> <span className="shortcuts-plus">+</span> <kbd className="shortcuts-kbd">?</kbd> anywhere to open this as a quick overlay.
                </p>
                {SHORTCUT_CATEGORIES.map((cat) => (
                  <div key={cat.name} className="shortcuts-category">
                    <h3 className="shortcuts-category-name">{cat.name}</h3>
                    {cat.shortcuts.map((shortcut, i) => (
                      <div key={i} className="shortcuts-row">
                        <span className="shortcuts-description">{shortcut.description}</span>
                        <span className="shortcuts-keys">
                          {shortcut.keys.map((key, j) => (
                            <span key={j}>
                              <kbd className="shortcuts-kbd">{key}</kbd>
                              {j < shortcut.keys.length - 1 && <span className="shortcuts-plus">+</span>}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {activeTab === 'admin' && <AdminPanel />}
          </div>
        </div>

        {cropFile && (
          <ImageCropModal
            file={cropFile}
            shape="circle"
            onCancel={() => setCropFile(null)}
            onSave={handleCroppedAvatarSave}
          />
        )}
      </div>
    </div>
  );
}

function NotificationSettings() {
  const [volume, setVolume] = useState(() => Math.round(getNotificationVolume() * 100));
  const [browserEnabled, setBrowserEnabled] = useState(() => getBrowserNotificationsEnabled());
  const [permState, setPermState] = useState(() => getPermissionState());

  const handleVolumeChange = (val: number) => {
    setVolume(val);
    setNotificationVolume(val / 100);
  };

  const handleBrowserToggle = async (enabled: boolean) => {
    if (enabled && permState !== 'granted') {
      const result = await requestNotificationPermission();
      setPermState(result === 'unsupported' ? 'unsupported' : result);
      if (result !== 'granted') return;
    }
    setBrowserEnabled(enabled);
    setBrowserNotificationsEnabled(enabled);
  };

  return (
    <div className="voice-video-settings">
      <h3>Notification Sounds</h3>
      <div className="profile-field">
        <label>Volume</label>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
        />
        <span className="profile-field-hint">{volume}%</span>
      </div>

      <h3>Browser Notifications</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
        Show desktop notifications for mentions and DMs when the tab is not focused.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={browserEnabled}
          onChange={(e) => handleBrowserToggle(e.target.checked)}
        />
        Enable browser notifications
      </label>
      {permState === 'denied' && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          Notifications are blocked by your browser. Allow them in your browser&apos;s site settings.
        </p>
      )}
      {permState === 'unsupported' && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          Your browser does not support desktop notifications.
        </p>
      )}

      <h3>Test Sounds</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
        Click to preview each notification sound.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <button className="profile-avatar-upload-btn" onClick={playMessageSound}>
          Message Sound
        </button>
        <button className="profile-avatar-upload-btn" onClick={playMentionSound}>
          Mention Sound
        </button>
        <button className="profile-avatar-upload-btn" onClick={playVoiceJoinSound}>
          Voice Join Sound
        </button>
        <button className="profile-avatar-upload-btn" onClick={playVoiceLeaveSound}>
          Voice Leave Sound
        </button>
      </div>
    </div>
  );
}

function VoiceVideoSettings() {
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputDevice[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem('drocsid_mic') || '');
  const [selectedSpeaker, setSelectedSpeaker] = useState(() => localStorage.getItem('drocsid_speaker') || '');
  const [selectedCamera, setSelectedCamera] = useState(() => localStorage.getItem('drocsid_camera') || '');
  const [micVolume, setMicVolume] = useState(100);
  const [speakerVolume, setSpeakerVolume] = useState(100);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [cameraPreview, setCameraPreview] = useState(false);

  // Push-to-talk settings
  const [pttEnabled, setPttEnabled] = useState(() => localStorage.getItem('drocsid_ptt_enabled') === 'true');
  const [pttKey, setPttKey] = useState(() => localStorage.getItem('drocsid_ptt_key') || 'Space');
  const [recordingKey, setRecordingKey] = useState(false);

  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const loadDevices = useCallback(async () => {
    if (navigator.mediaDevices) {
      try {
        // Request permission first so device labels are available
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(
          () => navigator.mediaDevices.getUserMedia({ audio: true }),
        );
        stream?.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied — enumerate anyway for whatever labels we can get
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoInputs(devices.filter((d) => d.kind === 'videoinput'));
      } catch {
        // enumerateDevices not available
      }
    }
    // Audio inputs/outputs: use platform abstraction (PipeWire/pactl on Tauri/Linux, enumerateDevices on web)
    const [inputs, outputs] = await Promise.all([listAudioInputs(), listAudioOutputs()]);
    setAudioInputs(inputs);
    setAudioOutputs(outputs);
  }, []);

  useEffect(() => {
    loadDevices();
    const onChange = () => loadDevices();
    navigator.mediaDevices?.addEventListener('devicechange', onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', onChange);
      stopMicTest();
      stopCameraPreview();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startMicTest = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      setMicTesting(true);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, (avg / 128) * 100 * (micVolume / 100)));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Mic access denied
    }
  };

  const stopMicTest = () => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
    setMicTesting(false);
    setMicLevel(0);
  };

  const startCameraPreview = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedCamera ? { deviceId: { exact: selectedCamera } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraStreamRef.current = stream;
      setCameraPreview(true);
    } catch {
      // Camera access denied
    }
  };

  // Attach the stream once the video element is rendered
  useEffect(() => {
    if (cameraPreview && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraPreview]);

  const stopCameraPreview = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraPreview(false);
  };

  return (
    <div className="voice-video-settings">
      <h3>Input Device</h3>
      <div className="profile-field">
        <label>Microphone</label>
        <select value={selectedMic} onChange={(e) => { setSelectedMic(e.target.value); saveMicrophone(e.target.value); }}>
          <option value="">Default</option>
          {audioInputs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="profile-field">
        <label>Input Volume</label>
        <input
          type="range"
          min={0}
          max={200}
          value={micVolume}
          onChange={(e) => setMicVolume(Number(e.target.value))}
        />
        <span className="profile-field-hint">{micVolume}%</span>
      </div>
      <div className="vv-mic-test">
        <button
          className="profile-avatar-upload-btn"
          onClick={micTesting ? stopMicTest : startMicTest}
        >
          {micTesting ? 'Stop Test' : 'Test Microphone'}
        </button>
        {micTesting && (
          <div className="vv-meter">
            <div className="vv-meter-fill" style={{ width: `${micLevel}%` }} />
          </div>
        )}
      </div>

      <h3>Input Mode</h3>
      <div className="profile-field">
        <label>Mode</label>
        <div className="vv-input-mode-toggle">
          <button
            className={`vv-mode-btn ${!pttEnabled ? 'active' : ''}`}
            onClick={() => {
              setPttEnabled(false);
              localStorage.setItem('drocsid_ptt_enabled', 'false');
            }}
          >
            Voice Activity
          </button>
          <button
            className={`vv-mode-btn ${pttEnabled ? 'active' : ''}`}
            onClick={() => {
              setPttEnabled(true);
              localStorage.setItem('drocsid_ptt_enabled', 'true');
            }}
          >
            Push to Talk
          </button>
        </div>
      </div>
      {pttEnabled && (
        <div className="profile-field">
          <label>Keybind</label>
          {recordingKey ? (
            <button
              className="vv-ptt-keybind recording"
              onKeyDown={(e) => {
                e.preventDefault();
                const key = e.code;
                setPttKey(key);
                localStorage.setItem('drocsid_ptt_key', key);
                setRecordingKey(false);
              }}
              onBlur={() => setRecordingKey(false)}
              autoFocus
            >
              Press a key...
            </button>
          ) : (
            <button
              className="vv-ptt-keybind"
              onClick={() => setRecordingKey(true)}
            >
              {pttKey}
            </button>
          )}
        </div>
      )}

      <h3>Output Device</h3>
      <div className="profile-field">
        <label>Speaker</label>
        <select value={selectedSpeaker} onChange={(e) => { setSelectedSpeaker(e.target.value); saveSpeaker(e.target.value); }}>
          <option value="">Default</option>
          {audioOutputs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="profile-field">
        <label>Output Volume</label>
        <input
          type="range"
          min={0}
          max={200}
          value={speakerVolume}
          onChange={(e) => setSpeakerVolume(Number(e.target.value))}
        />
        <span className="profile-field-hint">{speakerVolume}%</span>
      </div>

      <h3>Video</h3>
      <div className="profile-field">
        <label>Camera</label>
        <select value={selectedCamera} onChange={(e) => { setSelectedCamera(e.target.value); localStorage.setItem('drocsid_camera', e.target.value); }}>
          <option value="">Default</option>
          {videoInputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
      </div>
      <div className="vv-camera-section">
        <button
          className="profile-avatar-upload-btn"
          onClick={cameraPreview ? stopCameraPreview : startCameraPreview}
        >
          {cameraPreview ? 'Stop Preview' : 'Preview Camera'}
        </button>
        {cameraPreview && (
          <div className="vv-camera-preview">
            <video ref={videoRef} autoPlay muted playsInline />
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPanel() {
  const [codes, setCodes] = useState<RegistrationCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [maxUses, setMaxUses] = useState('');
  const [expiryHours, setExpiryHours] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const loadCodes = useCallback(async () => {
    try {
      const data = await api.getRegistrationCodes();
      setCodes(data);
    } catch {
      // silently fail
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCodes();
  }, [loadCodes]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const options: { max_uses?: number; max_age_secs?: number } = {};
      if (maxUses) options.max_uses = parseInt(maxUses, 10);
      if (expiryHours) options.max_age_secs = parseInt(expiryHours, 10) * 3600;
      const code = await api.createRegistrationCode(options);
      setCodes((prev) => [code, ...prev]);
      setMaxUses('');
      setExpiryHours('');
    } catch {
      // silently fail
    }
    setCreating(false);
  };

  const handleDelete = async (code: string) => {
    try {
      await api.deleteRegistrationCode(code);
      setCodes((prev) => prev.filter((c) => c.code !== code));
    } catch {
      // silently fail
    }
  };

  const copyLink = (code: string) => {
    const link = `${window.location.origin}?invite=${code}`;
    navigator.clipboard.writeText(link);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return 'Never';
    const d = new Date(expiresAt);
    if (d.getTime() < Date.now()) return 'Expired';
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <div className="admin-panel"><p>Loading...</p></div>;

  return (
    <div className="admin-panel">
      <h3>Registration Codes</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.85rem' }}>
        Generate codes to invite new users. Without a valid code, registration is blocked.
      </p>

      <div className="admin-create-code">
        <div className="admin-create-row">
          <div className="profile-field" style={{ flex: 1 }}>
            <label>Max Uses</label>
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Unlimited"
            />
          </div>
          <div className="profile-field" style={{ flex: 1 }}>
            <label>Expires After (hours)</label>
            <input
              type="number"
              min={1}
              value={expiryHours}
              onChange={(e) => setExpiryHours(e.target.value)}
              placeholder="Never"
            />
          </div>
          <button
            className="profile-save-btn"
            onClick={handleCreate}
            disabled={creating}
            style={{ alignSelf: 'flex-end', marginBottom: '0.25rem' }}
          >
            {creating ? 'Creating...' : 'Generate Code'}
          </button>
        </div>
      </div>

      {codes.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>No registration codes yet.</p>
      ) : (
        <div className="admin-codes-list">
          {codes.map((c) => {
            const expired = c.expires_at && new Date(c.expires_at).getTime() < Date.now();
            const maxedOut = c.max_uses !== null && c.uses >= c.max_uses;
            return (
              <div key={c.id} className={`admin-code-item ${expired || maxedOut ? 'admin-code-inactive' : ''}`}>
                <div className="admin-code-info">
                  <span className="admin-code-value">{c.code}</span>
                  <span className="admin-code-meta">
                    Uses: {c.uses}{c.max_uses !== null ? `/${c.max_uses}` : ''} &middot; Expires: {formatExpiry(c.expires_at)}
                  </span>
                </div>
                <div className="admin-code-actions">
                  <button className="admin-code-copy" onClick={() => copyLink(c.code)}>
                    {copiedCode === c.code ? 'Copied!' : 'Copy Link'}
                  </button>
                  <button className="admin-code-delete" onClick={() => handleDelete(c.code)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1.5rem 0' }} />
      <AdminDeleteUser />

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1.5rem 0' }} />
      <AdminPurgeChannel />
    </div>
  );
}

function AdminDeleteUser() {
  const currentUser = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<api.AdminUserInfo[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!search.trim()) return;
    try {
      const users = await api.adminSearchUsers(search.trim());
      setResults(users);
    } catch {
      // silently fail
    }
  };

  const handleDelete = async (userId: string) => {
    setDeleting(userId);
    try {
      await api.adminDeleteUser(userId);
      setResults((prev) => prev.filter((u) => u.id !== userId));
      setConfirmId(null);
    } catch {
      // silently fail
    }
    setDeleting(null);
  };

  const handleToggleAdmin = async (userId: string, currentlyAdmin: boolean) => {
    setTogglingAdmin(userId);
    try {
      const res = await api.adminSetUserAdmin(userId, !currentlyAdmin);
      setResults((prev) => prev.map((u) => u.id === userId ? { ...u, is_admin: res.is_admin } : u));
    } catch {
      // silently fail
    }
    setTogglingAdmin(null);
  };

  return (
    <>
      <h3>User Management</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.85rem' }}>
        Search for users to manage admin privileges or delete accounts.
      </p>
      <div className="admin-create-row">
        <div className="profile-field" style={{ flex: 1 }}>
          <label>Username</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search users..."
          />
        </div>
        <button
          className="profile-save-btn"
          onClick={handleSearch}
          disabled={!search.trim()}
          style={{ alignSelf: 'flex-end', marginBottom: '0.25rem' }}
        >
          Search
        </button>
      </div>
      {results.length > 0 && (
        <div className="admin-codes-list" style={{ marginTop: '0.75rem' }}>
          {results.map((u) => {
            const isSelf = u.id === currentUser?.id;
            return (
              <div key={u.id} className="admin-code-item">
                <div className="admin-code-info">
                  <span className="admin-code-value">
                    {u.username}
                    {u.is_admin && <span style={{ color: 'var(--accent)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>ADMIN</span>}
                  </span>
                  <span className="admin-code-meta">
                    {u.email || 'no email'} &middot; Last login: {u.last_login ? new Date(u.last_login).toLocaleDateString() + ' ' + new Date(u.last_login).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'never'}
                  </span>
                </div>
                <div className="admin-code-actions">
                  {confirmId === u.id ? (
                    <>
                      <button
                        className="admin-code-delete"
                        onClick={() => handleDelete(u.id)}
                        disabled={deleting === u.id}
                      >
                        {deleting === u.id ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                      <button className="admin-code-copy" onClick={() => setConfirmId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {!isSelf && (
                        <button
                          className="admin-code-copy"
                          onClick={() => handleToggleAdmin(u.id, u.is_admin)}
                          disabled={togglingAdmin === u.id}
                        >
                          {togglingAdmin === u.id ? '...' : u.is_admin ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                      )}
                      {!isSelf && (
                        <button className="admin-code-delete" onClick={() => setConfirmId(u.id)}>
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function AdminPurgeChannel() {
  const servers = useServerStore((s) => s.servers);
  const channels = useServerStore((s) => s.channels);
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const serverChannels: Channel[] = selectedServer
    ? (channels.get(selectedServer) || []).filter((c) => c.channel_type === 'text')
    : [];

  const handlePurge = async () => {
    if (!selectedChannel) return;
    setPurging(true);
    setResult(null);
    try {
      const res = await api.adminPurgeChannel(selectedChannel);
      setResult(`Purged ${res.purged} messages`);
      setConfirming(false);
    } catch {
      setResult('Failed to purge channel');
    }
    setPurging(false);
  };

  return (
    <>
      <h3>Purge Channel Messages</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.85rem' }}>
        Permanently delete all messages in a channel.
      </p>
      <div className="admin-create-row">
        <div className="profile-field" style={{ flex: 1 }}>
          <label>Server</label>
          <select
            value={selectedServer}
            onChange={(e) => { setSelectedServer(e.target.value); setSelectedChannel(''); setConfirming(false); setResult(null); }}
          >
            <option value="">Select server...</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="profile-field" style={{ flex: 1 }}>
          <label>Channel</label>
          <select
            value={selectedChannel}
            onChange={(e) => { setSelectedChannel(e.target.value); setConfirming(false); setResult(null); }}
            disabled={!selectedServer}
          >
            <option value="">Select channel...</option>
            {serverChannels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {confirming ? (
          <>
            <button className="admin-code-delete" onClick={handlePurge} disabled={purging}>
              {purging ? 'Purging...' : 'Confirm Purge'}
            </button>
            <button className="admin-code-copy" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            className="admin-code-delete"
            onClick={() => setConfirming(true)}
            disabled={!selectedChannel}
          >
            Purge All Messages
          </button>
        )}
        {result && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{result}</span>}
      </div>
    </>
  );
}
