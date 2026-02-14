import { useState } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { ServerSettings } from '../server/ServerSettings';
import { InviteModal } from '../server/InviteModal';
import { CreateChannelModal } from '../channel/CreateChannelModal';
import { UserSettings } from '../settings/UserSettings';
import { FriendList } from '../dm/FriendList';
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
  const currentUser = useAuthStore((s) => s.user);

  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState<'text' | 'voice' | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [homeTab, setHomeTab] = useState<HomeTab>('dms');

  // ── Home view (DMs + Friends) ──────────────────────
  if (view === 'home') {
    return (
      <>
      <div className="channel-sidebar">
        <div className="channel-header">
          <span className="channel-header-text">Direct Messages</span>
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
                  <button
                    key={dm.id}
                    className={`channel-item dm-item ${activeChannelId === dm.id ? 'active' : ''}`}
                    onClick={() => setActiveDmChannel(dm.id)}
                  >
                    <span className="dm-avatar">
                      {dm.channel_type === 'groupdm' ? 'G' : displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="channel-name">{displayName}</span>
                  </button>
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
          <span className="channel-header-text">Select a server</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="channel-sidebar">
        <div className="channel-header">
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
            <button
              key={channel.id}
              className={`channel-item ${activeChannelId === channel.id ? 'active' : ''}`}
              onClick={() => setActiveChannel(channel.id)}
            >
              <span className="channel-hash">#</span>
              <span className="channel-name">{channel.name}</span>
            </button>
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
