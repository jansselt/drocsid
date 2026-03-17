import { useState, useEffect, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import * as api from '../../api/client';
import type { User } from '../../types';

interface UserSelectorProps {
  selectedUsers: User[];
  onToggleUser: (user: User) => void;
  onRemoveUser: (userId: string) => void;
  maxUsers: number;
  excludeUserIds?: Set<string>;
  placeholder?: string;
  onEscape?: () => void;
}

export function UserSelector({
  selectedUsers,
  onToggleUser,
  onRemoveUser,
  maxUsers,
  excludeUserIds,
  placeholder = 'Search for friends or users...',
  onEscape,
}: UserSelectorProps) {
  const relationships = useServerStore((s) => s.relationships);
  const currentUser = useAuthStore((s) => s.user);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

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
        .filter(
          (u) =>
            !selectedUsers.some((s) => s.id === u.id) &&
            (!excludeUserIds || !excludeUserIds.has(u.id)),
        );
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
              !selectedUsers.some((s) => s.id === u.id) &&
              (!excludeUserIds || !excludeUserIds.has(u.id)),
          ),
        );
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery, relationships, selectedUsers, currentUser, excludeUserIds]);

  const handleToggle = (user: User) => {
    onToggleUser(user);
    setSearchQuery('');
  };

  return (
    <>
      {selectedUsers.length > 0 && (
        <div className="create-group-dm-selected">
          {selectedUsers.map((user) => (
            <span key={user.id} className="create-group-dm-chip">
              {user.display_name || user.username}
              <button onClick={() => onRemoveUser(user.id)}>&times;</button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        className="create-group-dm-search"
        placeholder={placeholder}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onEscape) onEscape();
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
          searchResults.map((user) => {
            const atLimit = selectedUsers.length >= maxUsers && !selectedUsers.some((s) => s.id === user.id);
            return (
              <button
                key={user.id}
                className="create-group-dm-user"
                onClick={() => handleToggle(user)}
                disabled={atLimit}
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
            );
          })}
      </div>
    </>
  );
}
