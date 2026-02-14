import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import './AuthPage.css';

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  // Read invite code from URL param and auto-switch to register mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
      setInviteCode(invite);
      setIsLogin(false);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(username, email, password, inviteCode || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
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
