import { useState } from 'react';
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
  const logout = useAuthStore((s) => s.logout);
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
      <button
        className={`server-icon home-btn ${view === 'home' ? 'active' : ''}`}
        onClick={() => setView('home')}
        title="Direct Messages"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
        </svg>
      </button>

      <div className="server-divider" />

      {servers.map((server) => (
        <button
          key={server.id}
          className={`server-icon ${activeServerId === server.id ? 'active' : ''}`}
          onClick={() => setActiveServer(server.id)}
          title={server.name}
        >
          {server.icon_url ? (
            <img src={server.icon_url} alt={server.name} />
          ) : (
            <span>{server.name.slice(0, 2).toUpperCase()}</span>
          )}
        </button>
      ))}

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

      <span style={{ fontSize: '0.6rem', color: '#72767d', textAlign: 'center', padding: '0 4px' }}>v0.1.0</span>

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
