import { useEffect, useState, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { StatusIndicator } from '../common/StatusIndicator';
import * as api from '../../api/client';
import type { ServerMemberWithUser } from '../../types';
import type { Role } from '../../types';
import './MemberSidebar.css';

function getRoleColor(roleIds: string[], roles: Role[] | undefined): string | undefined {
  if (!roles || roleIds.length === 0) return undefined;
  // Find the highest-position role with a non-zero color
  let best: Role | undefined;
  for (const rid of roleIds) {
    const role = roles.find((r) => r.id === rid);
    if (role && role.color && (!best || role.position > best.position)) {
      best = role;
    }
  }
  return best ? `#${best.color.toString(16).padStart(6, '0')}` : undefined;
}

export function MemberSidebar() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const members = useServerStore((s) => activeServerId ? s.members.get(activeServerId) : undefined);
  const presences = useServerStore((s) => s.presences);
  const roles = useServerStore((s) => activeServerId ? s.roles.get(activeServerId) : undefined);
  const loadMembers = useServerStore((s) => s.loadMembers);

  useEffect(() => {
    if (activeServerId && !members) {
      loadMembers(activeServerId);
    }
  }, [activeServerId, members, loadMembers]);

  if (!members) return null;

  // Get presence for each member (prefer real-time presence over initial load)
  const withPresence = members.map((m) => ({
    ...m,
    status: presences.get(m.user_id) || m.status,
  }));

  // Split into online and offline groups, sort offline alphabetically
  const online = withPresence.filter((m) => m.status !== 'offline');
  const offline = withPresence.filter((m) => m.status === 'offline');
  offline.sort((a, b) => a.user.username.localeCompare(b.user.username));

  // Sort online by status priority: online > idle > dnd, then by username for stability
  const statusOrder: Record<string, number> = { online: 0, idle: 1, dnd: 2 };
  online.sort((a, b) => {
    const s = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
    if (s !== 0) return s;
    return a.user.username.localeCompare(b.user.username);
  });

  // Build hoisted role groups from online members
  const hoistedRoles = (roles || [])
    .filter((r) => r.hoist && !r.is_default)
    .sort((a, b) => b.position - a.position);

  const grouped: { label: string; members: (ServerMemberWithUser & { status: string })[] }[] = [];
  const ungroupedOnline: (ServerMemberWithUser & { status: string })[] = [];

  for (const member of online) {
    let placed = false;
    for (const role of hoistedRoles) {
      if (member.role_ids.includes(role.id)) {
        let group = grouped.find((g) => g.label === role.name);
        if (!group) {
          group = { label: role.name, members: [] };
          grouped.push(group);
        }
        group.members.push(member);
        placed = true;
        break; // highest role wins
      }
    }
    if (!placed) {
      ungroupedOnline.push(member);
    }
  }

  return (
    <div className="member-sidebar">
      {grouped.map((group) => (
        <div key={group.label} className="member-group">
          <div className="member-group-label">
            {group.label} — {group.members.length}
          </div>
          {group.members.map((m) => (
            <MemberItem key={m.user_id} member={m} />
          ))}
        </div>
      ))}

      {ungroupedOnline.length > 0 && (
        <div className="member-group">
          <div className="member-group-label">
            Online — {ungroupedOnline.length}
          </div>
          {ungroupedOnline.map((m) => (
            <MemberItem key={m.user_id} member={m} />
          ))}
        </div>
      )}

      {offline.length > 0 && (
        <div className="member-group">
          <div className="member-group-label">
            Offline — {offline.length}
          </div>
          {offline.map((m) => (
            <MemberItem key={m.user_id} member={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberItem({ member }: { member: ServerMemberWithUser & { status: string } }) {
  // Use cached user for live custom_status updates from PRESENCE_UPDATE
  const cachedUser = useServerStore((s) => s.users.get(member.user_id));
  const user = cachedUser || member.user;
  const displayName = member.nickname || user.display_name || user.username;
  const isOffline = member.status === 'offline';
  const openDm = useServerStore((s) => s.openDm);
  const sendFriendRequest = useServerStore((s) => s.sendFriendRequest);
  const relationships = useServerStore((s) => s.relationships);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const roles = useServerStore((s) => activeServerId ? s.roles.get(activeServerId) : undefined);
  const isOwner = servers.find((s) => s.id === activeServerId)?.owner_id === currentUserId;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showRoles, setShowRoles] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
        setShowRoles(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (member.user_id === currentUserId) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
    setShowRoles(false);
  };

  const toggleRole = async (roleId: string) => {
    if (!activeServerId) return;
    const hasRole = member.role_ids.includes(roleId);
    try {
      if (hasRole) {
        await api.removeRole(activeServerId, member.user_id, roleId);
      } else {
        await api.assignRole(activeServerId, member.user_id, roleId);
      }
    } catch (err) {
      console.error('Failed to update role:', err);
    }
  };

  // Non-default roles for the submenu
  const assignableRoles = (roles || []).filter((r) => !r.is_default).sort((a, b) => b.position - a.position);

  // Highest role color for display
  const roleColor = getRoleColor(member.role_ids, roles);

  return (
    <>
      <div
        className={`member-item ${isOffline ? 'member-offline' : ''}`}
        onContextMenu={handleContextMenu}
        onClick={() => {
          if (member.user_id !== currentUserId) {
            openDm(member.user_id);
          }
        }}
      >
        <div className="member-avatar-wrapper">
          <div className="member-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" />
            ) : (
              displayName[0].toUpperCase()
            )}
          </div>
          <StatusIndicator status={member.status} size="sm" />
        </div>
        <div className="member-info">
          <span className="member-name" style={roleColor ? { color: roleColor } : undefined}>{displayName}</span>
          {user.custom_status && (
            <span className="member-custom-status">{user.custom_status}</span>
          )}
        </div>
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="member-context-menu"
          style={{ top: menu.y, left: menu.x }}
        >
          <button
            className="member-context-item"
            onClick={() => {
              setMenu(null);
              openDm(member.user_id);
            }}
          >
            Message
          </button>
          {(() => {
            const rel = relationships.find((r) => r.target_id === member.user_id || r.user_id === member.user_id);
            if (!rel) return (
              <button
                className="member-context-item"
                onClick={() => {
                  setMenu(null);
                  sendFriendRequest(member.user_id);
                }}
              >
                Send Friend Request
              </button>
            );
            if (rel.rel_type === 'pending_outgoing') return (
              <button className="member-context-item" disabled>
                Friend Request Sent
              </button>
            );
            return null;
          })()}
          {isOwner && assignableRoles.length > 0 && (
            <>
              <div className="member-context-separator" />
              <button
                className="member-context-item"
                onClick={() => setShowRoles(!showRoles)}
              >
                Roles {showRoles ? '\u25B4' : '\u25BE'}
              </button>
              {showRoles && (
                <div className="member-role-list">
                  {assignableRoles.map((role) => {
                    const has = member.role_ids.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        className={`member-context-item member-role-item ${has ? 'checked' : ''}`}
                        onClick={() => toggleRole(role.id)}
                      >
                        <span
                          className="role-color-dot"
                          style={{ background: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--text-muted)' }}
                        />
                        {role.name}
                        {has && <span className="role-check">{'\u2713'}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
