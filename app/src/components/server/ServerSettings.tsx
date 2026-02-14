import { useState, useEffect, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import type { Role, Ban, AuditLogEntry } from '../../types';
import { Permissions, PermissionLabels } from '../../types';
import * as api from '../../api/client';
import './ServerSettings.css';

interface ServerSettingsProps {
  serverId: string;
  onClose: () => void;
}

export function ServerSettings({ serverId, onClose }: ServerSettingsProps) {
  const server = useServerStore((s) => s.servers.find((sv) => sv.id === serverId));
  const roles = useServerStore((s) => s.roles.get(serverId) || []);
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = server?.owner_id === currentUser?.id;

  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'bans' | 'audit-log'>(isOwner ? 'overview' : 'roles');
  const [bans, setBans] = useState<Ban[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [editPerms, setEditPerms] = useState<number>(0);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(0);
  const [saving, setSaving] = useState(false);

  // Overview tab state
  const [serverName, setServerName] = useState(server?.name || '');
  const [serverDescription, setServerDescription] = useState(server?.description || '');
  const [serverIconUrl, setServerIconUrl] = useState(server?.icon_url || '');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [savingOverview, setSavingOverview] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedRole) {
      setEditPerms(selectedRole.permissions);
      setEditName(selectedRole.name);
      setEditColor(selectedRole.color);
    }
  }, [selectedRole]);

  if (!server) return null;

  const sortedRoles = [...roles].sort((a, b) => a.position - b.position);

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    setCreating(true);
    try {
      const role = await api.createRole(serverId, newRoleName.trim());
      setSelectedRole(role);
      setNewRoleName('');
    } catch {
      // Error handled silently
    }
    setCreating(false);
  };

  const handleSaveRole = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await api.updateRole(serverId, selectedRole.id, {
        name: editName !== selectedRole.name ? editName : undefined,
        permissions: editPerms !== selectedRole.permissions ? editPerms : undefined,
        color: editColor !== selectedRole.color ? editColor : undefined,
      });
    } catch {
      // Error handled silently
    }
    setSaving(false);
  };

  const handleDeleteRole = async () => {
    if (!selectedRole || selectedRole.is_default) return;
    try {
      await api.deleteRole(serverId, selectedRole.id);
      setSelectedRole(null);
    } catch {
      // Error handled silently
    }
  };

  const togglePermission = (perm: number) => {
    if (editPerms & perm) {
      setEditPerms(editPerms & ~perm);
    } else {
      setEditPerms(editPerms | perm);
    }
  };

  const permissionEntries = Object.entries(Permissions).map(([, value]) => ({
    value: value as number,
    label: PermissionLabels[value as number] || String(value),
  }));

  const hasChanges =
    selectedRole &&
    (editName !== selectedRole.name ||
      editPerms !== selectedRole.permissions ||
      editColor !== selectedRole.color);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{server.name} — Settings</h2>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-nav">
            {isOwner && (
              <button
                className={`settings-nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </button>
            )}
            <button
              className={`settings-nav-item ${activeTab === 'roles' ? 'active' : ''}`}
              onClick={() => setActiveTab('roles')}
            >
              Roles
            </button>
            {isOwner && (
              <button
                className={`settings-nav-item ${activeTab === 'bans' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('bans');
                  api.getServerBans(serverId).then(setBans).catch(() => {});
                }}
              >
                Bans
              </button>
            )}
            {isOwner && (
              <button
                className={`settings-nav-item ${activeTab === 'audit-log' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('audit-log');
                  api.getAuditLog(serverId).then(setAuditLog).catch(() => {});
                }}
              >
                Audit Log
              </button>
            )}
          </div>

          <div className="settings-content">
            {activeTab === 'overview' && server && (
              <div className="overview-panel">
                <div className="profile-avatar-section">
                  <div className="profile-avatar-large">
                    {serverIconUrl ? (
                      <img src={serverIconUrl} alt="" />
                    ) : (
                      server.name[0].toUpperCase()
                    )}
                  </div>
                  <button
                    className="profile-avatar-upload-btn"
                    onClick={() => iconInputRef.current?.click()}
                    disabled={uploadingIcon}
                  >
                    {uploadingIcon ? 'Uploading...' : 'Upload Icon'}
                  </button>
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return;
                      setUploadingIcon(true);
                      try {
                        const { upload_url, file_url } = await api.requestServerIconUploadUrl(
                          serverId, file.name, file.type, file.size,
                        );
                        await api.uploadFile(upload_url, file);
                        setServerIconUrl(file_url);
                        await api.updateServer(serverId, { icon_url: file_url });
                      } catch {
                        // Error handled silently
                      }
                      setUploadingIcon(false);
                      if (iconInputRef.current) iconInputRef.current.value = '';
                    }}
                  />
                </div>

                <div className="profile-fields">
                  <div className="profile-field">
                    <label>Server Name</label>
                    <input
                      type="text"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      maxLength={100}
                    />
                  </div>

                  <div className="profile-field">
                    <label>Description</label>
                    <textarea
                      value={serverDescription}
                      onChange={(e) => setServerDescription(e.target.value)}
                      placeholder="What's this server about?"
                      rows={3}
                    />
                  </div>
                </div>

                {(serverName !== (server.name || '') || serverDescription !== (server.description || '')) && (
                  <div className="profile-save-bar">
                    <button
                      className="profile-save-btn"
                      onClick={async () => {
                        setSavingOverview(true);
                        try {
                          const updates: Record<string, string> = {};
                          if (serverName !== server.name) updates.name = serverName;
                          if (serverDescription !== (server.description || '')) updates.description = serverDescription;
                          await api.updateServer(serverId, updates);
                        } catch {
                          // Error handled silently
                        }
                        setSavingOverview(false);
                      }}
                      disabled={savingOverview}
                    >
                      {savingOverview ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      className="profile-reset-btn"
                      onClick={() => {
                        setServerName(server.name || '');
                        setServerDescription(server.description || '');
                      }}
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'roles' && (
              <div className="roles-panel">
                <div className="roles-list">
                  <div className="roles-list-header">
                    <h3>Roles</h3>
                    {isOwner && (
                      <div className="role-create">
                        <input
                          type="text"
                          placeholder="New role name..."
                          value={newRoleName}
                          onChange={(e) => setNewRoleName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateRole()}
                        />
                        <button onClick={handleCreateRole} disabled={creating || !newRoleName.trim()}>
                          +
                        </button>
                      </div>
                    )}
                  </div>

                  {sortedRoles.map((role) => (
                    <button
                      key={role.id}
                      className={`role-item ${selectedRole?.id === role.id ? 'active' : ''}`}
                      onClick={() => setSelectedRole(role)}
                    >
                      <span
                        className="role-color-dot"
                        style={{
                          background: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--text-muted)',
                        }}
                      />
                      <span className="role-name">
                        {role.is_default ? '@everyone' : role.name}
                      </span>
                    </button>
                  ))}
                </div>

                {selectedRole && (
                  <div className="role-editor">
                    <div className="role-editor-header">
                      <h3>Edit Role</h3>
                      {!selectedRole.is_default && isOwner && (
                        <button className="role-delete" onClick={handleDeleteRole}>
                          Delete
                        </button>
                      )}
                    </div>

                    <div className="role-field">
                      <label>Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={selectedRole.is_default}
                      />
                    </div>

                    <div className="role-field">
                      <label>Color</label>
                      <input
                        type="color"
                        value={`#${editColor.toString(16).padStart(6, '0')}`}
                        onChange={(e) => setEditColor(parseInt(e.target.value.slice(1), 16))}
                      />
                    </div>

                    <div className="role-permissions">
                      <h4>Permissions</h4>
                      <div className="permission-grid">
                        {permissionEntries.map(({ value, label }) => (
                          <label key={value} className="permission-toggle">
                            <input
                              type="checkbox"
                              checked={!!(editPerms & value)}
                              onChange={() => togglePermission(value)}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {hasChanges && (
                      <div className="role-save-bar">
                        <button
                          className="role-save-btn"
                          onClick={handleSaveRole}
                          disabled={saving}
                        >
                          {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button
                          className="role-reset-btn"
                          onClick={() => {
                            setEditPerms(selectedRole.permissions);
                            setEditName(selectedRole.name);
                            setEditColor(selectedRole.color);
                          }}
                        >
                          Reset
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'bans' && (
              <div className="bans-panel">
                <h3>Server Bans</h3>
                {bans.length === 0 ? (
                  <p className="settings-empty">No banned users</p>
                ) : (
                  <div className="bans-list">
                    {bans.map((ban) => (
                      <div key={ban.user_id} className="ban-item">
                        <div className="ban-user">
                          <span className="ban-username">{ban.user.username}</span>
                          {ban.reason && (
                            <span className="ban-reason">{ban.reason}</span>
                          )}
                        </div>
                        <button
                          className="ban-unban-btn"
                          onClick={async () => {
                            await api.unbanMember(serverId, ban.user_id);
                            setBans((prev) => prev.filter((b) => b.user_id !== ban.user_id));
                          }}
                        >
                          Unban
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'audit-log' && (
              <div className="audit-panel">
                <h3>Audit Log</h3>
                {auditLog.length === 0 ? (
                  <p className="settings-empty">No audit log entries</p>
                ) : (
                  <div className="audit-list">
                    {auditLog.map((entry) => (
                      <div key={entry.id} className="audit-item">
                        <span className="audit-user">{entry.user.username}</span>
                        <span className="audit-action">{entry.action.replace(/_/g, ' ')}</span>
                        {entry.reason && (
                          <span className="audit-reason">— {entry.reason}</span>
                        )}
                        <span className="audit-time">
                          {new Date(entry.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
