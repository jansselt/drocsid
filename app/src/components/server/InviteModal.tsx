import { useState, useEffect, useRef } from 'react';
import * as api from '../../api/client';
import type { Invite } from '../../types';
import './InviteModal.css';

interface InviteModalProps {
  serverId: string;
  onClose: () => void;
}

export function InviteModal({ serverId, onClose }: InviteModalProps) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getServerInvites(serverId).then(setInvites).catch(() => {});
  }, [serverId]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const invite = await api.createInvite(serverId, { max_age_secs: 86400 * 7 });
      setNewCode(invite.code);
      setInvites((prev) => [invite, ...prev]);
    } catch {
      // ignore
    }
    setCreating(false);
  };

  const handleCopy = () => {
    const url = `${window.location.origin}/invite/${newCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (code: string) => {
    await api.deleteInvite(serverId, code);
    setInvites((prev) => prev.filter((i) => i.code !== code));
    if (newCode === code) setNewCode('');
  };

  return (
    <div className="invite-overlay" onClick={onClose}>
      <div className="invite-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="invite-title">Invite People</h2>

        {newCode ? (
          <div className="invite-link-row">
            <input
              ref={inputRef}
              className="invite-link-input"
              readOnly
              value={`${window.location.origin}/invite/${newCode}`}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="invite-copy-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        ) : (
          <button className="invite-create-btn" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Generate Invite Link'}
          </button>
        )}

        {invites.length > 0 && (
          <div className="invite-list">
            <div className="invite-list-header">Active Invites</div>
            {invites.map((inv) => (
              <div key={inv.code} className="invite-item">
                <span className="invite-code">{inv.code}</span>
                <span className="invite-uses">
                  {inv.uses}{inv.max_uses ? `/${inv.max_uses}` : ''} uses
                </span>
                <button
                  className="invite-delete-btn"
                  onClick={() => handleDelete(inv.code)}
                  title="Delete invite"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="invite-actions">
          <button className="invite-close-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
