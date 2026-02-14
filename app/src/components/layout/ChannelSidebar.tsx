import { useState, useRef, useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import * as api from '../../api/client';
import { ServerSettings } from '../server/ServerSettings';
import { InviteModal } from '../server/InviteModal';
import { CreateChannelModal } from '../channel/CreateChannelModal';
import { UserSettings } from '../settings/UserSettings';
import { FriendList } from '../dm/FriendList';
import { CreateGroupDmModal } from '../dm/CreateGroupDmModal';
import { VoiceChannel } from '../voice/VoiceChannel';
import { VoiceControls } from '../voice/VoiceControls';
import { UserPanel } from './UserPanel';
import './ChannelSidebar.css';

type HomeTab = 'dms' | 'friends';

export function ChannelSidebar() {
  const view = useServerStore((s) => s.view);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const channels = useServerStore((s) => s.channels);
  const servers = useServerStore((s) => s.servers);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);
  const dmChannels = useServerStore((s) => s.dmChannels);
  const dmRecipients = useServerStore((s) => s.dmRecipients);
  const setActiveDmChannel = useServerStore((s) => s.setActiveDmChannel);
  const closeDm = useServerStore((s) => s.closeDm);
  const toggleChannelSidebar = useServerStore((s) => s.toggleChannelSidebar);
  const currentUser = useAuthStore((s) => s.user);

  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState<'text' | 'voice' | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [homeTab, setHomeTab] = useState<HomeTab>('dms');
  const [showCreateGroupDm, setShowCreateGroupDm] = useState(false);

  // ── Home view (DMs + Friends) ──────────────────────
  if (view === 'home') {
    return (
      <>
      <div className="channel-sidebar">
        <div className="channel-header">
          <button
            className="channel-sidebar-collapse"
            onClick={toggleChannelSidebar}
            title="Collapse Sidebar (Ctrl+\)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>
          <span className="channel-header-text">Direct Messages</span>
          <button
            className="channel-header-settings"
            onClick={() => setShowCreateGroupDm(true)}
            title="New Group DM"
          >
            +
          </button>
        </div>

        <div className="home-tabs">
          <button
            className={`home-tab ${homeTab === 'dms' ? 'active' : ''}`}
            onClick={() => setHomeTab('dms')}
          >
            Messages
          </button>
          <button
            className={`home-tab ${homeTab === 'friends' ? 'active' : ''}`}
            onClick={() => setHomeTab('friends')}
          >
            Friends
          </button>
        </div>

        {homeTab === 'dms' ? (
          <div className="channel-list">
            {dmChannels.length === 0 ? (
              <div className="dm-empty">No conversations yet</div>
            ) : (
              dmChannels.map((dm) => {
                const recipients = dmRecipients.get(dm.id) || [];
                const otherUsers = recipients.filter((r) => r.id !== currentUser?.id);
                const displayName =
                  dm.channel_type === 'groupdm'
                    ? dm.name || otherUsers.map((u) => u.username).join(', ')
                    : otherUsers[0]?.username || 'Unknown';

                return (
                  <div
                    key={dm.id}
                    className={`channel-item dm-item ${activeChannelId === dm.id ? 'active' : ''}`}
                    onClick={() => setActiveDmChannel(dm.id)}
                  >
                    <span className="dm-avatar">
                      {dm.channel_type === 'groupdm' ? 'G' : displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="channel-name">{displayName}</span>
                    <button
                      className="dm-close-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeDm(dm.id);
                      }}
                      title="Close DM"
                    >
                      &times;
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <FriendList />
        )}

        <VoiceControls />
        <UserPanel onOpenSettings={() => setShowUserSettings(true)} />
      </div>

      {showUserSettings && (
        <UserSettings onClose={() => setShowUserSettings(false)} />
      )}
      {showCreateGroupDm && (
        <CreateGroupDmModal onClose={() => setShowCreateGroupDm(false)} />
      )}
    </>
    );
  }

  // ── Server view ────────────────────────────────────
  const activeServer = servers.find((s) => s.id === activeServerId);
  const serverChannels = activeServerId ? channels.get(activeServerId) || [] : [];
  const textChannels = serverChannels.filter((c) => c.channel_type === 'text');
  const voiceChannels = serverChannels.filter((c) => c.channel_type === 'voice');
  const isOwner = activeServer?.owner_id === currentUser?.id;

  if (!activeServer) {
    return (
      <div className="channel-sidebar">
        <div className="channel-header">
          <button
            className="channel-sidebar-collapse"
            onClick={toggleChannelSidebar}
            title="Collapse Sidebar (Ctrl+\)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>
          <span className="channel-header-text">Select a server</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="channel-sidebar">
        <div className="channel-header">
          <button
            className="channel-sidebar-collapse"
            onClick={toggleChannelSidebar}
            title="Collapse Sidebar (Ctrl+\)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>
          <span className="channel-header-text">{activeServer.name}</span>
          <button
            className="channel-header-settings"
            onClick={() => setShowInvite(true)}
            title="Invite People"
          >
            +
          </button>
          {isOwner && (
            <button
              className="channel-header-settings"
              onClick={() => setShowSettings(true)}
              title="Server Settings"
            >
              &#9881;
            </button>
          )}
        </div>

        <div className="channel-list">
          <div className="channel-category">
            <span>Text Channels</span>
            {isOwner && (
              <button
                className="channel-category-add"
                onClick={() => setShowCreateChannel('text')}
                title="Create Text Channel"
              >
                +
              </button>
            )}
          </div>
          {textChannels.map((channel) => (
            <ChannelItem
              key={channel.id}
              channelId={channel.id}
              name={channel.name || ''}
              isActive={activeChannelId === channel.id}
              canManage={isOwner}
              onClick={() => setActiveChannel(channel.id)}
            />
          ))}

          <div className="channel-category">
            <span>Voice Channels</span>
            {isOwner && (
              <button
                className="channel-category-add"
                onClick={() => setShowCreateChannel('voice')}
                title="Create Voice Channel"
              >
                +
              </button>
            )}
          </div>
          {voiceChannels.map((channel) => (
            <VoiceChannel
              key={channel.id}
              channelId={channel.id}
              channelName={channel.name || 'Voice'}
              canManage={isOwner}
            />
          ))}
        </div>

        <VoiceControls />
        <UserPanel onOpenSettings={() => setShowUserSettings(true)} />
      </div>

      {showSettings && activeServerId && (
        <ServerSettings
          serverId={activeServerId}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showCreateChannel && activeServerId && (
        <CreateChannelModal
          serverId={activeServerId}
          defaultType={showCreateChannel}
          onClose={() => setShowCreateChannel(null)}
        />
      )}

      {showInvite && activeServerId && (
        <InviteModal
          serverId={activeServerId}
          onClose={() => setShowInvite(false)}
        />
      )}

      {showUserSettings && (
        <UserSettings onClose={() => setShowUserSettings(false)} />
      )}
    </>
  );
}

function ChannelItem({
  channelId,
  name,
  isActive,
  canManage,
  onClick,
}: {
  channelId: string;
  name: string;
  isActive: boolean;
  canManage: boolean;
  onClick: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menu]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!canManage) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRename = async () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name) {
      try {
        await api.updateChannel(channelId, { name: trimmed });
      } catch {
        // revert on error
        setEditName(name);
      }
    } else {
      setEditName(name);
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete channel #${name}? This cannot be undone.`)) return;
    setMenu(null);
    try {
      await api.deleteChannel(channelId);
    } catch {
      // ignore
    }
  };

  if (editing) {
    return (
      <div className="channel-item editing">
        <span className="channel-hash">#</span>
        <input
          ref={inputRef}
          className="channel-edit-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename();
            if (e.key === 'Escape') {
              setEditName(name);
              setEditing(false);
            }
          }}
          maxLength={100}
        />
      </div>
    );
  }

  return (
    <>
      <button
        className={`channel-item ${isActive ? 'active' : ''}`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
      >
        <span className="channel-hash">#</span>
        <span className="channel-name">{name}</span>
      </button>
      {menu && (
        <div
          ref={menuRef}
          className="channel-context-menu"
          style={{ top: menu.y, left: menu.x }}
        >
          <button
            className="channel-context-item"
            onClick={() => {
              setMenu(null);
              setEditName(name);
              setEditing(true);
            }}
          >
            Edit Channel
          </button>
          <button
            className="channel-context-item danger"
            onClick={handleDelete}
          >
            Delete Channel
          </button>
        </div>
      )}
    </>
  );
}
