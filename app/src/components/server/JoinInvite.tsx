import { useState, useEffect } from 'react';
import * as api from '../../api/client';
import type { InviteResolve } from '../../types';

interface JoinInviteProps {
  code: string;
  onDone: () => void;
}

export function JoinInvite({ code, onDone }: JoinInviteProps) {
  const [invite, setInvite] = useState<InviteResolve | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api.resolveInvite(code)
      .then(setInvite)
      .catch(() => setError('Invite not found or expired'));
  }, [code]);

  const handleJoin = async () => {
    setJoining(true);
    try {
      await api.useInvite(code);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
      setJoining(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: 8,
        padding: '2rem',
        width: 400,
        textAlign: 'center',
      }}>
        {error ? (
          <>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: '1rem' }}>
              Invalid Invite
            </h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{error}</p>
            <button
              onClick={onDone}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '0.5rem 1.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Go Home
            </button>
          </>
        ) : invite ? (
          <>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              You've been invited to join
            </h2>
            <h1 style={{
              color: 'var(--text-primary)',
              fontSize: '1.5rem',
              margin: '0.5rem 0 1.5rem',
            }}>
              {invite.server.name}
            </h1>
            {invite.server.description && (
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                {invite.server.description}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                onClick={onDone}
                style={{
                  background: 'none',
                  color: 'var(--text-muted)',
                  border: 'none',
                  padding: '0.5rem 1.5rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                No Thanks
              </button>
              <button
                onClick={handleJoin}
                disabled={joining}
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '0.5rem 1.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: joining ? 'not-allowed' : 'pointer',
                  opacity: joining ? 0.5 : 1,
                }}
              >
                {joining ? 'Joining...' : 'Accept Invite'}
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Loading invite...</p>
        )}
      </div>
    </div>
  );
}
