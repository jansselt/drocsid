import { useState, useEffect, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import type { Role, Ban, AuditLogEntry, Webhook, Channel } from '../../types';
import { Permissions, PermissionLabels } from '../../types';
import { getApiUrl } from '../../api/instance';
import * as api from '../../api/client';
import { ImageCropModal } from '../shared/ImageCropModal';
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

  const channels = useServerStore((s) => s.channels.get(serverId) || []);
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'webhooks' | 'bans' | 'audit-log'>(isOwner ? 'overview' : 'roles');
  const [bans, setBans] = useState<Ban[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhookName, setWebhookName] = useState('');
  const [webhookChannel, setWebhookChannel] = useState('');
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);
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
  const [serverBannerUrl, setServerBannerUrl] = useState(server?.banner_url || '');
  const [bannerPosition, setBannerPosition] = useState(server?.banner_position ?? 50);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [savingOverview, setSavingOverview] = useState(false);
  const [cropFile, setCropFile] = useState<{ file: File; target: 'icon' } | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const bannerDragRef = useRef<{ startY: number; startPos: number } | null>(null);

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
      const updated = await api.updateRole(serverId, selectedRole.id, {
        name: editName !== selectedRole.name ? editName : undefined,
        permissions: editPerms !== selectedRole.permissions ? editPerms : undefined,
        color: editColor !== selectedRole.color ? editColor : undefined,
      });
      setSelectedRole(updated);
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
            <button
              className={`settings-nav-item ${activeTab === 'webhooks' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('webhooks');
                api.getServerWebhooks(serverId).then(setWebhooks).catch(() => {});
              }}
            >
              Webhooks
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
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return;
                      setCropFile({ file, target: 'icon' });
                      if (iconInputRef.current) iconInputRef.current.value = '';
                    }}
                  />
                </div>

                <div className="banner-upload-section">
                  <label className="banner-upload-label">Server Banner</label>
                  <div
                    className={`banner-upload-preview ${serverBannerUrl ? 'has-image' : ''}`}
                    onClick={() => { if (!serverBannerUrl) bannerInputRef.current?.click(); }}
                    style={serverBannerUrl ? {
                      backgroundImage: `url(${serverBannerUrl})`,
                      backgroundPosition: `center ${bannerPosition}%`,
                      cursor: 'grab',
                    } : undefined}
                    onMouseDown={(e) => {
                      if (!serverBannerUrl) return;
                      e.preventDefault();
                      bannerDragRef.current = { startY: e.clientY, startPos: bannerPosition };
                      const el = e.currentTarget;
                      el.style.cursor = 'grabbing';
                      const onMove = (ev: MouseEvent) => {
                        if (!bannerDragRef.current) return;
                        const delta = ev.clientY - bannerDragRef.current.startY;
                        // Map pixel delta to position percentage (negative delta = lower %)
                        const newPos = Math.max(0, Math.min(100, bannerDragRef.current.startPos - delta * 0.5));
                        setBannerPosition(Math.round(newPos));
                      };
                      const onUp = () => {
                        el.style.cursor = 'grab';
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        bannerDragRef.current = null;
                        // Compute final position from where the mouse ended up
                        setBannerPosition((currentPos) => {
                          api.updateServer(serverId, { banner_position: currentPos }).then(() => {
                            useServerStore.setState((state) => ({
                              servers: state.servers.map((s) =>
                                s.id === serverId ? { ...s, banner_position: currentPos } : s,
                              ),
                            }));
                          }).catch(() => {});
                          return currentPos;
                        });
                      };
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                    }}
                  >
                    {!serverBannerUrl && (
                      <span className="banner-upload-placeholder">
                        Click to upload a banner image
                      </span>
                    )}
                    {serverBannerUrl && (
                      <span className="banner-reposition-hint">Drag to reposition</span>
                    )}
                  </div>
                  <div className="banner-upload-actions">
                    <button
                      className="profile-avatar-upload-btn"
                      onClick={() => bannerInputRef.current?.click()}
                      disabled={uploadingBanner}
                    >
                      {uploadingBanner ? 'Uploading...' : serverBannerUrl ? 'Change Banner' : 'Upload Banner'}
                    </button>
                    {serverBannerUrl && (
                      <button
                        className="profile-reset-btn"
                        onClick={async () => {
                          setServerBannerUrl('');
                          try {
                            await api.updateServer(serverId, { banner_url: '' });
                            useServerStore.setState((state) => ({
                              servers: state.servers.map((s) =>
                                s.id === serverId ? { ...s, banner_url: null } : s,
                              ),
                            }));
                          } catch {
                            setServerBannerUrl(server.banner_url || '');
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return;
                      setUploadingBanner(true);
                      try {
                        const { file_url } = await api.uploadServerBanner(serverId, file);
                        setServerBannerUrl(file_url);
                        await api.updateServer(serverId, { banner_url: file_url });
                        useServerStore.setState((state) => ({
                          servers: state.servers.map((s) =>
                            s.id === serverId ? { ...s, banner_url: file_url } : s,
                          ),
                        }));
                      } catch {
                        // Error handled silently
                      }
                      setUploadingBanner(false);
                      if (bannerInputRef.current) bannerInputRef.current.value = '';
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
                      onClick={async () => {
                        if (selectedRole && selectedRole.id !== role.id && hasChanges) {
                          try {
                            await api.updateRole(serverId, selectedRole.id, {
                              name: editName !== selectedRole.name ? editName : undefined,
                              permissions: editPerms !== selectedRole.permissions ? editPerms : undefined,
                              color: editColor !== selectedRole.color ? editColor : undefined,
                            });
                          } catch {
                            // Error handled silently
                          }
                        }
                        setSelectedRole(role);
                      }}
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

            {activeTab === 'webhooks' && (
              <div className="bans-panel">
                <h3>Webhooks</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Webhooks allow external services to send messages to channels in this server.
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Webhook name"
                    value={webhookName}
                    onChange={(e) => setWebhookName(e.target.value)}
                    style={{ flex: 1, minWidth: 150 }}
                  />
                  <select
                    value={webhookChannel}
                    onChange={(e) => setWebhookChannel(e.target.value)}
                    style={{ minWidth: 150 }}
                  >
                    <option value="">Select channel</option>
                    {channels.filter((c: Channel) => c.channel_type === 'text').map((c: Channel) => (
                      <option key={c.id} value={c.id}>#{c.name}</option>
                    ))}
                  </select>
                  <button
                    className="profile-avatar-upload-btn"
                    disabled={!webhookName.trim() || !webhookChannel || creatingWebhook}
                    onClick={async () => {
                      setCreatingWebhook(true);
                      try {
                        const wh = await api.createWebhook(webhookChannel, webhookName.trim());
                        setWebhooks((prev) => [wh, ...prev]);
                        setWebhookName('');
                        setWebhookChannel('');
                      } catch { /* */ }
                      setCreatingWebhook(false);
                    }}
                  >
                    {creatingWebhook ? 'Creating...' : 'Create'}
                  </button>
                </div>

                {webhooks.length === 0 ? (
                  <p className="settings-empty">No webhooks yet</p>
                ) : (
                  <div className="bans-list">
                    {webhooks.map((wh) => {
                      const ch = channels.find((c: Channel) => c.id === wh.channel_id);
                      const webhookUrl = `${getApiUrl().replace('/api/v1', '')}/api/v1/webhooks/${wh.id}/${wh.token}`;
                      return (
                        <div key={wh.id} className="ban-item" style={{ flexDirection: 'column', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            <div>
                              <span className="ban-username">{wh.name}</span>
                              {ch && <span className="ban-reason">#{ch.name}</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                className="profile-avatar-upload-btn"
                                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                onClick={() => {
                                  navigator.clipboard.writeText(webhookUrl);
                                  setCopiedWebhookId(wh.id);
                                  setTimeout(() => setCopiedWebhookId(null), 2000);
                                }}
                              >
                                {copiedWebhookId === wh.id ? 'Copied!' : 'Copy URL'}
                              </button>
                              <button
                                className="ban-unban-btn"
                                onClick={async () => {
                                  await api.deleteWebhook(wh.channel_id, wh.id);
                                  setWebhooks((prev) => prev.filter((w) => w.id !== wh.id));
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {webhookUrl}
                          </div>
                        </div>
                      );
                    })}
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

        {cropFile && (
          <ImageCropModal
            file={cropFile.file}
            shape="circle"
            onCancel={() => setCropFile(null)}
            onSave={async (blob) => {
              setCropFile(null);
              const croppedFile = new File([blob], 'icon.png', { type: 'image/png' });
              setUploadingIcon(true);
              try {
                const { file_url } = await api.uploadServerIcon(serverId, croppedFile);
                setServerIconUrl(file_url);
                await api.updateServer(serverId, { icon_url: file_url });
                useServerStore.setState((state) => ({
                  servers: state.servers.map((s) =>
                    s.id === serverId ? { ...s, icon_url: file_url } : s,
                  ),
                }));
              } catch {
                // Error handled silently
              }
              setUploadingIcon(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
