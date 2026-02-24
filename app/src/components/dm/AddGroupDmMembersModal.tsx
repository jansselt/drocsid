import { useState, useEffect, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import * as api from '../../api/client';
import type { User } from '../../types';
import './CreateGroupDmModal.css';

interface AddGroupDmMembersModalProps {
  channelId: string;
  currentRecipients: User[];
  onClose: () => void;
}

export function AddGroupDmMembersModal({
  channelId,
  currentRecipients,
  onClose,
}: AddGroupDmMembersModalProps) {
  const addGroupDmRecipients = useServerStore((s) => s.addGroupDmRecipients);
  const relationships = useServerStore((s) => s.relationships);
  const currentUser = useAuthStore((s) => s.user);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const maxNew = 10 - currentRecipients.length;
  const excludeIds = new Set(currentRecipients.map((u) => u.id));

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      const friends = relationships
        .filter((r) => r.rel_type === 'friend')
        .map((r) => r.user)
        .filter((u) => !excludeIds.has(u.id) && !selectedUsers.some((s) => s.id === u.id));
      setSearchResults(friends);
      return;
    }

    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchUsers(q);
        setSearchResults(
          results.filter(
            (u) =>
              u.id !== currentUser?.id &&
              !excludeIds.has(u.id) &&
              !selectedUsers.some((s) => s.id === u.id),
          ),
        );
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery, relationships, selectedUsers, currentUser, excludeIds]);

  const toggleUser = (user: User) => {
    if (selectedUsers.some((u) => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
    } else if (selectedUsers.length < maxNew) {
      setSelectedUsers([...selectedUsers, user]);
      setSearchQuery('');
    }
  };

  const removeUser = (userId: string) => {
    setSelectedUsers(selectedUsers.filter((u) => u.id !== userId));
  };

  const handleAdd = async () => {
    if (selectedUsers.length === 0) {
      setError('Select at least one user');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await addGroupDmRecipients(
        channelId,
        selectedUsers.map((u) => u.id),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add members');
      setSubmitting(false);
    }
  };

  return (
    <div className="create-group-dm-overlay" onClick={onClose}>
      <div className="create-group-dm-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="create-group-dm-title">Add Members</h2>

        {selectedUsers.length > 0 && (
          <div className="create-group-dm-selected">
            {selectedUsers.map((user) => (
              <span key={user.id} className="create-group-dm-chip">
                {user.display_name || user.username}
                <button onClick={() => removeUser(user.id)}>&times;</button>
              </span>
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          className="create-group-dm-search"
          placeholder="Search for friends or users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />

        <div className="create-group-dm-results">
          {searching && <div className="create-group-dm-empty">Searching...</div>}
          {!searching && searchResults.length === 0 && (
            <div className="create-group-dm-empty">
              {searchQuery.trim().length >= 2 ? 'No users found' : 'No friends to show'}
            </div>
          )}
          {!searching &&
            searchResults.map((user) => (
              <button
                key={user.id}
                className="create-group-dm-user"
                onClick={() => toggleUser(user)}
              >
                <span className="create-group-dm-user-avatar">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    user.username.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="create-group-dm-user-name">
                  {user.display_name || user.username}
                </span>
                <span className="create-group-dm-user-username">{user.username}</span>
              </button>
            ))}
        </div>

        {error && <div className="create-group-dm-error">{error}</div>}

        <div className="create-group-dm-actions">
          <button className="create-group-dm-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="create-group-dm-submit"
            disabled={submitting || selectedUsers.length === 0}
            onClick={handleAdd}
          >
            {submitting
              ? 'Adding...'
              : `Add ${selectedUsers.length > 0 ? selectedUsers.length : ''} Member${selectedUsers.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
