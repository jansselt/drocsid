import { useState, useEffect, useCallback } from 'react';
import { getToken, setToken, clearToken, api, type ServerHealth } from './api';
import { Dashboard } from './pages/Dashboard';
import { LiveKitPage } from './pages/LiveKit';
import { LogsPage } from './pages/Logs';
import { VoicePage } from './pages/Voice';
import './style.css';

type Page = 'dashboard' | 'livekit' | 'logs' | 'voice';

function LoginForm({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Login failed (${res.status})`);
      }
      const data = await res.json();
      setToken(data.access_token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Drocsid Admin</h1>
        <form onSubmit={handleSubmit}>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
          />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState<Page>('dashboard');
  const [health, setHealth] = useState<ServerHealth | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshHealth();
    const interval = setInterval(refreshHealth, 5000);
    return () => clearInterval(interval);
  }, [authed, refreshHealth]);

  if (!authed) {
    return <LoginForm onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="admin-layout">
      <nav className="admin-nav">
        <div className="nav-brand">Drocsid Admin</div>
        <button
          className={page === 'dashboard' ? 'active' : ''}
          onClick={() => setPage('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={page === 'livekit' ? 'active' : ''}
          onClick={() => setPage('livekit')}
        >
          LiveKit
        </button>
        <button
          className={page === 'voice' ? 'active' : ''}
          onClick={() => setPage('voice')}
        >
          Voice
        </button>
        <button
          className={page === 'logs' ? 'active' : ''}
          onClick={() => setPage('logs')}
        >
          Logs
        </button>
        <div className="nav-spacer" />
        <button
          className="nav-logout"
          onClick={() => {
            clearToken();
            setAuthed(false);
          }}
        >
          Logout
        </button>
      </nav>
      <main className="admin-main">
        {page === 'dashboard' && <Dashboard health={health} />}
        {page === 'livekit' && <LiveKitPage />}
        {page === 'voice' && <VoicePage />}
        {page === 'logs' && <LogsPage />}
      </main>
    </div>
  );
}
