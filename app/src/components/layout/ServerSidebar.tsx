import { useState, useMemo } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import './ServerSidebar.css';

export function ServerSidebar() {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const view = useServerStore((s) => s.view);
  const setView = useServerStore((s) => s.setView);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const createServer = useServerStore((s) => s.createServer);
  const channels = useServerStore((s) => s.channels);
  const readStates = useServerStore((s) => s.readStates);
  const dmChannels = useServerStore((s) => s.dmChannels);
  const relationships = useServerStore((s) => s.relationships);
  const logout = useAuthStore((s) => s.logout);

  // Compute per-server unread and mention counts
  const serverIndicators = useMemo(() => {
    const result = new Map<string, { hasUnread: boolean; mentionCount: number }>();
    for (const server of servers) {
      const serverChannels = channels.get(server.id) || [];
      let hasUnread = false;
      let totalMentions = 0;
      for (const ch of serverChannels) {
        if (ch.channel_type !== 'text') continue;
        const rs = readStates.get(ch.id);
        if (ch.last_message_id && (!rs?.last_read_message_id || ch.last_message_id > rs.last_read_message_id)) {
          hasUnread = true;
        }
        totalMentions += rs?.mention_count || 0;
      }
      result.set(server.id, { hasUnread, mentionCount: totalMentions });
    }
    return result;
  }, [servers, channels, readStates]);

  // Compute home button (DMs) unread and badge count
  // Every unread DM counts toward the badge (DMs are personal, not just @mentions)
  const homeIndicator = useMemo(() => {
    let badgeCount = 0;
    for (const dm of dmChannels) {
      const rs = readStates.get(dm.id);
      if (dm.last_message_id && (!rs?.last_read_message_id || dm.last_message_id > rs.last_read_message_id)) {
        badgeCount++;
      }
    }
    const pendingIncoming = relationships.filter((r) => r.rel_type === 'pending_incoming').length;
    badgeCount += pendingIncoming;
    return { hasUnread: badgeCount > 0, badgeCount };
  }, [dmChannels, readStates, relationships]);

  const [showCreate, setShowCreate] = useState(false);
  const [newServerName, setNewServerName] = useState('');

  const handleCreate = async () => {
    if (!newServerName.trim()) return;
    await createServer(newServerName.trim());
    setNewServerName('');
    setShowCreate(false);
  };

  return (
    <div className="server-sidebar">
      <div className="server-icon-wrapper">
        {homeIndicator.hasUnread && view !== 'home' && (
          <div className={`server-unread-pill${homeIndicator.badgeCount > 0 ? ' has-mentions' : ''}`} />
        )}
        <button
          className={`server-icon home-btn ${view === 'home' ? 'active' : ''}`}
          onClick={() => setView('home')}
          title="Direct Messages"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
          </svg>
        </button>
        {homeIndicator.badgeCount > 0 && (
          <div className="server-mention-badge">{homeIndicator.badgeCount > 99 ? '99+' : homeIndicator.badgeCount}</div>
        )}
      </div>

      <div className="server-divider" />

      {servers.map((server) => {
        const indicator = serverIndicators.get(server.id);
        const hasUnread = indicator?.hasUnread || false;
        const mentionCount = indicator?.mentionCount || 0;
        const isActive = activeServerId === server.id;

        return (
          <div key={server.id} className="server-icon-wrapper">
            {hasUnread && !isActive && (
              <div className={`server-unread-pill${mentionCount > 0 ? ' has-mentions' : ''}`} />
            )}
            <button
              className={`server-icon ${isActive ? 'active' : ''}`}
              onClick={() => setActiveServer(server.id)}
              title={server.name}
            >
              {server.icon_url ? (
                <img src={server.icon_url} alt={server.name} />
              ) : (
                <span>{server.name.slice(0, 2).toUpperCase()}</span>
              )}
            </button>
            {mentionCount > 0 && (
              <div className="server-mention-badge">{mentionCount > 99 ? '99+' : mentionCount}</div>
            )}
          </div>
        );
      })}

      <div className="server-divider" />

      <button
        className="server-icon add-server"
        onClick={() => setShowCreate(!showCreate)}
        title="Create Server"
      >
        <span>+</span>
      </button>

      {showCreate && (
        <div className="create-server-popup">
          <input
            type="text"
            placeholder="Server name"
            value={newServerName}
            onChange={(e) => setNewServerName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <button onClick={handleCreate}>Create</button>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <span style={{ fontSize: '0.6rem', color: '#72767d', textAlign: 'center', padding: '0 4px' }}>v{__APP_VERSION__}</span>

      <button
        className="server-icon bug-report-btn"
        onClick={() => window.dispatchEvent(new CustomEvent('open-bug-report'))}
        title="Report a Bug"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 8h-2.81a5.985 5.985 0 0 0-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5s-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/>
        </svg>
      </button>

      <button
        className="server-icon logout-btn"
        onClick={logout}
        title="Log Out"
      >
        <span style={{ fontSize: '1.25rem' }}>&#x2192;</span>
      </button>
    </div>
  );
}
