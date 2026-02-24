import { useState } from 'react';
import { getBuiltinThemeColors, themeNames, themeLabels, type ThemeName } from '../../stores/themeStore';
import type { CustomTheme } from '../../types';
import './ThemeEditor.css';

interface ThemeEditorProps {
  /** If provided, we are editing an existing theme. Otherwise creating new. */
  existing?: CustomTheme;
  onSave: (name: string, colors: Record<string, string>) => void;
  onCancel: () => void;
}

const COLOR_GROUPS = [
  {
    label: 'Backgrounds',
    keys: [
      { key: '--bg-darkest', label: 'Darkest' },
      { key: '--bg-base', label: 'Base' },
      { key: '--bg-primary', label: 'Primary' },
      { key: '--bg-secondary', label: 'Secondary' },
      { key: '--bg-tertiary', label: 'Tertiary' },
      { key: '--bg-hover', label: 'Hover', isRgba: true },
      { key: '--bg-active', label: 'Active', isRgba: true },
    ],
  },
  {
    label: 'Text',
    keys: [
      { key: '--text-primary', label: 'Primary' },
      { key: '--text-secondary', label: 'Secondary' },
      { key: '--text-muted', label: 'Muted' },
    ],
  },
  {
    label: 'UI',
    keys: [
      { key: '--border', label: 'Border' },
      { key: '--accent', label: 'Accent' },
      { key: '--accent-hover', label: 'Accent Hover' },
      { key: '--danger', label: 'Danger' },
    ],
  },
];

/** Parse an rgba() string into hex + opacity, or return the hex as-is. */
function parseColor(value: string): { hex: string; opacity: number } {
  const rgbaMatch = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    return { hex, opacity: a };
  }
  // Ensure hex is 7 chars for color input
  let hex = value;
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return { hex, opacity: 1 };
}

/** Convert hex + opacity back to a CSS color string. */
function toColorString(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`;
}

const DEFAULT_BASE = 'dark';

export function ThemeEditor({ existing, onSave, onCancel }: ThemeEditorProps) {
  const [name, setName] = useState(existing?.name || '');
  const [colors, setColors] = useState<Record<string, string>>(() => {
    if (existing) return { ...existing.colors };
    return getBuiltinThemeColors(DEFAULT_BASE);
  });
  const [startFrom, setStartFrom] = useState<ThemeName>(DEFAULT_BASE);

  const handleStartFromChange = (themeName: ThemeName) => {
    setStartFrom(themeName);
    setColors(getBuiltinThemeColors(themeName));
  };

  const setColor = (key: string, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, colors);
  };

  return (
    <div className="theme-editor-overlay" onClick={onCancel}>
      <div className="theme-editor" onClick={(e) => e.stopPropagation()}>
        <div className="theme-editor-header">
          <h3>{existing ? 'Edit Theme' : 'Create Theme'}</h3>
          <button className="theme-editor-close" onClick={onCancel}>&times;</button>
        </div>

        <div className="theme-editor-body">
          <div className="theme-editor-row">
            <div className="profile-field">
              <label>Theme Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Custom Theme"
                maxLength={32}
              />
            </div>
            {!existing && (
              <div className="profile-field">
                <label>Start From</label>
                <select
                  value={startFrom}
                  onChange={(e) => handleStartFromChange(e.target.value as ThemeName)}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit',
                  }}
                >
                  {themeNames.map((t) => (
                    <option key={t} value={t}>{themeLabels[t]}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Live Preview */}
          <div className="theme-editor-section">
            <h4>Preview</h4>
            <div
              className="theme-preview"
              style={{ border: `1px solid ${colors['--border']}` }}
            >
              <div className="theme-preview-sidebar" style={{ background: colors['--bg-darkest'] }}>
                <div className="theme-preview-icon" style={{ background: colors['--accent'] }} />
                <div className="theme-preview-icon" style={{ background: colors['--bg-tertiary'] }} />
              </div>
              <div className="theme-preview-channels" style={{ background: colors['--bg-base'] }}>
                <div className="theme-preview-channel" style={{ background: colors['--text-muted'], opacity: 0.4 }} />
                <div className="theme-preview-channel theme-preview-channel-active" style={{ background: colors['--text-primary'], opacity: 0.6 }} />
                <div className="theme-preview-channel" style={{ background: colors['--text-muted'], opacity: 0.4 }} />
              </div>
              <div className="theme-preview-chat" style={{ background: colors['--bg-primary'] }}>
                <div className="theme-preview-message">
                  <div className="theme-preview-avatar" style={{ background: colors['--accent'] }} />
                  <div className="theme-preview-text" style={{ background: colors['--text-primary'], opacity: 0.6 }} />
                </div>
                <div className="theme-preview-message">
                  <div className="theme-preview-avatar" style={{ background: colors['--bg-tertiary'] }} />
                  <div className="theme-preview-text" style={{ background: colors['--text-secondary'], opacity: 0.4, width: '60%' }} />
                </div>
                <div className="theme-preview-btn" style={{ background: colors['--accent'] }} />
              </div>
            </div>
          </div>

          {/* Color Groups */}
          {COLOR_GROUPS.map((group) => (
            <div key={group.label} className="theme-editor-section">
              <h4>{group.label}</h4>
              <div className="theme-editor-colors">
                {group.keys.map(({ key, label, isRgba }) => {
                  const currentVal = colors[key] || '#000000';
                  const { hex, opacity } = parseColor(currentVal);

                  return (
                    <div key={key} className="theme-color-field">
                      <label title={key}>{label}</label>
                      <input
                        type="color"
                        value={hex}
                        onChange={(e) => {
                          setColor(key, isRgba ? toColorString(e.target.value, opacity) : e.target.value);
                        }}
                      />
                      {isRgba && (
                        <input
                          type="text"
                          value={Math.round(opacity * 100) + '%'}
                          style={{ width: 48 }}
                          onChange={(e) => {
                            const pct = parseInt(e.target.value);
                            if (!isNaN(pct)) {
                              setColor(key, toColorString(hex, Math.min(100, Math.max(0, pct)) / 100));
                            }
                          }}
                          title="Opacity"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="theme-editor-footer">
          <button className="profile-reset-btn" onClick={onCancel}>Cancel</button>
          <button
            className="profile-save-btn"
            onClick={handleSubmit}
            disabled={!name.trim()}
          >
            {existing ? 'Save Changes' : 'Create Theme'}
          </button>
        </div>
      </div>
    </div>
  );
}
