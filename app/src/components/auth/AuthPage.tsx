import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import * as api from '../../api/client';
import type { InviteResolve } from '../../types';
import './AuthPage.css';

interface AuthPageProps {
  serverInviteCode?: string;
  onRegisteredWithInvite?: () => void;
}

export function AuthPage({ serverInviteCode, onRegisteredWithInvite }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverInfo, setServerInfo] = useState<InviteResolve | null>(null);

  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  // If a server invite code is provided, resolve it and prefill
  useEffect(() => {
    if (serverInviteCode) {
      setInviteCode(serverInviteCode);
      setIsLogin(false);
      api.resolveInvite(serverInviteCode)
        .then(setServerInfo)
        .catch(() => {
          // Invite may be invalid/expired — user can still try to register
        });
    }
  }, [serverInviteCode]);

  // Read invite code from URL query param (for admin registration codes)
  useEffect(() => {
    if (serverInviteCode) return; // Server invite prop takes priority
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
      setInviteCode(invite);
      setIsLogin(false);
    }
  }, [serverInviteCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(username, email, password, inviteCode || undefined);
        // If registered with a server invite, signal App to skip JoinInvite
        if (serverInviteCode && onRegisteredWithInvite) {
          onRegisteredWithInvite();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const hasServerInvite = !!serverInviteCode;

  return (
    <div className="auth-page">
      <div className="auth-card">
        {serverInfo && (
          <div className="invite-banner">
            <div className="invite-server-icon">
              {serverInfo.server.icon_url ? (
                <img src={serverInfo.server.icon_url} alt="" />
              ) : (
                serverInfo.server.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="invite-server-info">
              <span className="invite-label">You've been invited to join</span>
              <span className="invite-server-name">{serverInfo.server.name}</span>
            </div>
          </div>
        )}

        <h1 className="auth-title">Drocsid</h1>
        <p className="auth-subtitle">
          {isLogin ? 'Welcome back!' : 'Create an account'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="invite-code">Invite Code</label>
              <input
                id="invite-code"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Required to register"
                autoComplete="off"
                readOnly={hasServerInvite}
                className={hasServerInvite ? 'readonly-input' : ''}
              />
            </div>
          )}

          {!isLogin && (
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                maxLength={32}
                autoComplete="username"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Loading...' : isLogin ? 'Log In' : 'Register'}
          </button>
        </form>

        <p className="auth-switch">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            className="auth-switch-btn"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
          >
            {isLogin ? 'Register' : 'Log In'}
          </button>
        </p>
      </div>
    </div>
  );
}
