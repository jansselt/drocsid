import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { StatusIndicator } from '../common/StatusIndicator';
import './UserPanel.css';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'dnd', label: 'Do Not Disturb' },
  { value: 'invisible', label: 'Invisible' },
] as const;

interface UserPanelProps {
  onOpenSettings?: () => void;
}

export function UserPanel({ onOpenSettings }: UserPanelProps) {
  const user = useAuthStore((s) => s.user);
  const presences = useServerStore((s) => s.presences);
  const updateMyStatus = useServerStore((s) => s.updateMyStatus);
  const [showPicker, setShowPicker] = useState(false);

  if (!user) return null;

  const myStatus = presences.get(user.id) || 'online';
  const displayName = user.display_name || user.username;

  return (
    <div className="user-panel">
      <div className="user-panel-info" onClick={() => setShowPicker(!showPicker)}>
        <div className="user-panel-avatar-wrapper">
          <div className="user-panel-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" />
            ) : (
              displayName[0].toUpperCase()
            )}
          </div>
          <StatusIndicator status={myStatus} size="sm" />
        </div>
        <div className="user-panel-text">
          <span className="user-panel-name">{displayName}</span>
          <span className="user-panel-status">{myStatus === 'dnd' ? 'Do Not Disturb' : myStatus === 'invisible' ? 'Invisible' : myStatus}</span>
        </div>
      </div>

      {onOpenSettings && (
        <button
          className="user-panel-settings"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings();
          }}
          title="User Settings"
        >
          &#9881;
        </button>
      )}

      {showPicker && (
        <div className="status-picker">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`status-picker-item ${myStatus === opt.value ? 'active' : ''}`}
              onClick={() => {
                updateMyStatus(opt.value);
                setShowPicker(false);
              }}
            >
              <StatusIndicator status={opt.value} size="md" />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
