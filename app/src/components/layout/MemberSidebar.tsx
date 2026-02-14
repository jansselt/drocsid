import { useEffect, useState, useRef } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { StatusIndicator } from '../common/StatusIndicator';
import type { ServerMemberWithUser } from '../../types';
import './MemberSidebar.css';

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

  // Split into online and offline groups
  const online = withPresence.filter((m) => m.status !== 'offline');
  const offline = withPresence.filter((m) => m.status === 'offline');

  // Sort online by status priority: online > idle > dnd
  const statusOrder: Record<string, number> = { online: 0, idle: 1, dnd: 2 };
  online.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

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
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (member.user_id === currentUserId) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

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
          <span className="member-name">{displayName}</span>
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
        </div>
      )}
    </>
  );
}
