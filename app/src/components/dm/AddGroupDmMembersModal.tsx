import { useState, useMemo } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { UserSelector } from './UserSelector';
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

  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const maxNew = 10 - currentRecipients.length;
  const excludeIds = useMemo(
    () => new Set(currentRecipients.map((u) => u.id)),
    [currentRecipients],
  );

  const toggleUser = (user: User) => {
    if (selectedUsers.some((u) => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
    } else if (selectedUsers.length < maxNew) {
      setSelectedUsers([...selectedUsers, user]);
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

        <UserSelector
          selectedUsers={selectedUsers}
          onToggleUser={toggleUser}
          onRemoveUser={removeUser}
          maxUsers={maxNew}
          excludeUserIds={excludeIds}
          placeholder="Search for friends or users..."
          onEscape={onClose}
        />

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
