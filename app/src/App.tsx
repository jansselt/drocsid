import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { AuthPage } from './components/auth/AuthPage';
import { InstancePicker } from './components/auth/InstancePicker';
import { AppLayout } from './components/layout/AppLayout';
import { JoinInvite } from './components/server/JoinInvite';
import { isTauri, hasInstance } from './api/instance';

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const init = useAuthStore((s) => s.init);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [needsInstance, setNeedsInstance] = useState(() => isTauri() && !hasInstance());

  useEffect(() => {
    if (!needsInstance) {
      init();
    }
    // Check for invite URL
    const match = window.location.pathname.match(/^\/invite\/([A-Za-z0-9]+)$/);
    if (match) {
      setInviteCode(match[1]);
    }
  }, [init, needsInstance]);

  if (needsInstance) {
    return <InstancePicker onInstanceSelected={() => setNeedsInstance(false)} />;
  }

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-base)',
        color: 'var(--text-muted)',
        fontSize: '1.125rem',
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthPage
        serverInviteCode={inviteCode ?? undefined}
        onRegisteredWithInvite={() => {
          setInviteCode(null);
          window.history.replaceState(null, '', '/');
        }}
      />
    );
  }

  if (inviteCode) {
    return (
      <JoinInvite
        code={inviteCode}
        onDone={() => {
          setInviteCode(null);
          window.history.replaceState(null, '', '/');
        }}
      />
    );
  }

  return <AppLayout />;
}
