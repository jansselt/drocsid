import { useState } from 'react';
import { useServerStore } from '../../stores/serverStore';
import './FriendList.css';

type FriendTab = 'all' | 'pending' | 'blocked' | 'add';

export function FriendList() {
  const relationships = useServerStore((s) => s.relationships);
  const acceptFriend = useServerStore((s) => s.acceptFriend);
  const removeFriend = useServerStore((s) => s.removeFriend);
  const blockUser = useServerStore((s) => s.blockUser);
  const sendFriendRequest = useServerStore((s) => s.sendFriendRequest);
  const openDm = useServerStore((s) => s.openDm);

  const [tab, setTab] = useState<FriendTab>('all');
  const [addInput, setAddInput] = useState('');
  const [addStatus, setAddStatus] = useState('');

  const friends = relationships.filter((r) => r.rel_type === 'friend');
  const pending = relationships.filter(
    (r) => r.rel_type === 'pending_incoming' || r.rel_type === 'pending_outgoing',
  );
  const blocked = relationships.filter((r) => r.rel_type === 'blocked');

  const handleAdd = async () => {
    if (!addInput.trim()) return;
    try {
      await sendFriendRequest(addInput.trim());
      setAddStatus('Friend request sent!');
      setAddInput('');
      setTimeout(() => setAddStatus(''), 3000);
    } catch (e) {
      setAddStatus((e as Error).message || 'Failed to send request');
    }
  };

  return (
    <div className="friend-list">
      <div className="friend-tabs">
        <button className={`friend-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          All
        </button>
        <button className={`friend-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          Pending{pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
        <button className={`friend-tab ${tab === 'blocked' ? 'active' : ''}`} onClick={() => setTab('blocked')}>
          Blocked
        </button>
        <button className={`friend-tab add-friend-tab ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>
          Add Friend
        </button>
      </div>

      {tab === 'add' && (
        <div className="add-friend-section">
          <p className="add-friend-hint">Enter a user ID to send a friend request.</p>
          <div className="add-friend-input-row">
            <input
              type="text"
              placeholder="User ID"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button onClick={handleAdd}>Send Request</button>
          </div>
          {addStatus && <p className="add-friend-status">{addStatus}</p>}
        </div>
      )}

      {tab === 'all' && (
        <div className="friend-section">
          <div className="friend-section-header">Friends - {friends.length}</div>
          {friends.length === 0 ? (
            <div className="friend-empty">No friends yet. Add someone!</div>
          ) : (
            friends.map((rel) => (
              <div key={rel.target_id} className="friend-row">
                <div className="friend-avatar">{rel.user.username.slice(0, 1).toUpperCase()}</div>
                <div className="friend-info">
                  <span className="friend-name">{rel.user.display_name || rel.user.username}</span>
                  <span className="friend-status">{rel.user.status}</span>
                </div>
                <div className="friend-actions">
                  <button className="friend-action-btn" title="Message" onClick={() => openDm(rel.target_id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                    </svg>
                  </button>
                  <button className="friend-action-btn danger" title="Remove" onClick={() => removeFriend(rel.target_id)}>
                    &#x2715;
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'pending' && (
        <div className="friend-section">
          <div className="friend-section-header">Pending - {pending.length}</div>
          {pending.length === 0 ? (
            <div className="friend-empty">No pending requests.</div>
          ) : (
            pending.map((rel) => (
              <div key={rel.target_id} className="friend-row">
                <div className="friend-avatar">{rel.user.username.slice(0, 1).toUpperCase()}</div>
                <div className="friend-info">
                  <span className="friend-name">{rel.user.display_name || rel.user.username}</span>
                  <span className="friend-status">
                    {rel.rel_type === 'pending_incoming' ? 'Incoming request' : 'Outgoing request'}
                  </span>
                </div>
                <div className="friend-actions">
                  {rel.rel_type === 'pending_incoming' && (
                    <button className="friend-action-btn accept" title="Accept" onClick={() => acceptFriend(rel.target_id)}>
                      &#x2713;
                    </button>
                  )}
                  <button className="friend-action-btn danger" title="Decline" onClick={() => removeFriend(rel.target_id)}>
                    &#x2715;
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'blocked' && (
        <div className="friend-section">
          <div className="friend-section-header">Blocked - {blocked.length}</div>
          {blocked.length === 0 ? (
            <div className="friend-empty">No blocked users.</div>
          ) : (
            blocked.map((rel) => (
              <div key={rel.target_id} className="friend-row">
                <div className="friend-avatar">{rel.user.username.slice(0, 1).toUpperCase()}</div>
                <div className="friend-info">
                  <span className="friend-name">{rel.user.display_name || rel.user.username}</span>
                </div>
                <div className="friend-actions">
                  <button className="friend-action-btn" title="Unblock" onClick={() => removeFriend(rel.target_id)}>
                    Unblock
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
