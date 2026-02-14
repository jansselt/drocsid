import { useState, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore, themeNames, themeLabels, applyThemeToDOM, type ThemeName } from '../../stores/themeStore';
import * as api from '../../api/client';
import './UserSettings.css';

interface UserSettingsProps {
  onClose: () => void;
}

const themeSwatches: Record<ThemeName, { bg: string; accent: string; text: string }> = {
  dark:     { bg: '#1a1b1e', accent: '#6366f1', text: '#e4e4e7' },
  light:    { bg: '#f3f4f6', accent: '#4f46e5', text: '#111827' },
  midnight: { bg: '#110f2a', accent: '#7c3aed', text: '#e0def4' },
  forest:   { bg: '#0f1f17', accent: '#10b981', text: '#d4e7dc' },
  rose:     { bg: '#220f1b', accent: '#ec4899', text: '#f0dde6' },
};

export function UserSettings({ onClose }: UserSettingsProps) {
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [activeTab, setActiveTab] = useState<'profile' | 'appearance'>('profile');

  // Profile form state
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;

    setUploading(true);
    try {
      const { file_url } = await api.uploadAvatar(file);
      setAvatarUrl(file_url);
      // Auto-save avatar immediately
      const updated = await api.updateMe({ avatar_url: file_url });
      useAuthStore.setState({ user: updated });
    } catch {
      // Error handled silently
    }
    setUploading(false);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
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
                    onChange={handleAvatarUpload}
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
          </div>
        </div>
      </div>
    </div>
  );
}
