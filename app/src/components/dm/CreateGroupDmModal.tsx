import { useState, useEffect, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import * as api from '../../api/client';
import type { User } from '../../types';
import './CreateGroupDmModal.css';

interface CreateGroupDmModalProps {
  onClose: () => void;
  initialSelection?: User[];
}

export function CreateGroupDmModal({ onClose, initialSelection }: CreateGroupDmModalProps) {
  const createGroupDm = useServerStore((s) => s.createGroupDm);
  const relationships = useServerStore((s) => s.relationships);
  const currentUser = useAuthStore((s) => s.user);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<User[]>(initialSelection ?? []);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      // Show friends when no search query
      const friends = relationships
        .filter((r) => r.rel_type === 'friend')
        .map((r) => r.user)
        .filter((u) => !selectedUsers.some((s) => s.id === u.id));
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
            (u) => u.id !== currentUser?.id && !selectedUsers.some((s) => s.id === u.id),
          ),
        );
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery, relationships, selectedUsers, currentUser]);

  const toggleUser = (user: User) => {
    if (selectedUsers.some((u) => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
    } else if (selectedUsers.length < 9) {
      setSelectedUsers([...selectedUsers, user]);
      setSearchQuery('');
    }
  };

  const removeUser = (userId: string) => {
    setSelectedUsers(selectedUsers.filter((u) => u.id !== userId));
  };

  const handleCreate = async () => {
    if (selectedUsers.length === 0) {
      setError('Select at least one user');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createGroupDm(
        selectedUsers.map((u) => u.id),
        groupName.trim() || undefined,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group DM');
      setSubmitting(false);
    }
  };

  return (
    <div className="create-group-dm-overlay" onClick={onClose}>
      <div className="create-group-dm-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="create-group-dm-title">Create Group DM</h2>

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
                  {(user.avatar_url) ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    user.username.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="create-group-dm-user-name">
                  {user.display_name || user.username}
                </span>
                <span className="create-group-dm-user-username">
                  {user.username}
                </span>
              </button>
            ))}
        </div>

        {selectedUsers.length > 1 && (
          <div className="create-group-dm-name-field">
            <label>Group Name (optional)</label>
            <input
              type="text"
              placeholder="Enter a group name..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={100}
            />
          </div>
        )}

        {error && <div className="create-group-dm-error">{error}</div>}

        <div className="create-group-dm-actions">
          <button className="create-group-dm-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="create-group-dm-submit"
            disabled={submitting || selectedUsers.length === 0}
            onClick={handleCreate}
          >
            {submitting
              ? 'Creating...'
              : `Create DM${selectedUsers.length > 1 ? ' Group' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
