import { useState } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { UserSelector } from './UserSelector';
import type { User } from '../../types';
import './CreateGroupDmModal.css';

interface CreateGroupDmModalProps {
  onClose: () => void;
  initialSelection?: User[];
}

export function CreateGroupDmModal({ onClose, initialSelection }: CreateGroupDmModalProps) {
  const createGroupDm = useServerStore((s) => s.createGroupDm);

  const [selectedUsers, setSelectedUsers] = useState<User[]>(initialSelection ?? []);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleUser = (user: User) => {
    if (selectedUsers.some((u) => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
    } else if (selectedUsers.length < 9) {
      setSelectedUsers([...selectedUsers, user]);
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

        <UserSelector
          selectedUsers={selectedUsers}
          onToggleUser={toggleUser}
          onRemoveUser={removeUser}
          maxUsers={9}
          placeholder="Search for friends or users..."
          onEscape={onClose}
        />

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
