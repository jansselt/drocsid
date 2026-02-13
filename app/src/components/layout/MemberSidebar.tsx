import { useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
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
  const displayName = member.nickname || member.user.display_name || member.user.username;
  const isOffline = member.status === 'offline';

  return (
    <div className={`member-item ${isOffline ? 'member-offline' : ''}`}>
      <div className="member-avatar-wrapper">
        <div className="member-avatar">
          {member.user.avatar_url ? (
            <img src={member.user.avatar_url} alt="" />
          ) : (
            displayName[0].toUpperCase()
          )}
        </div>
        <StatusIndicator status={member.status} size="sm" />
      </div>
      <div className="member-info">
        <span className="member-name">{displayName}</span>
        {member.user.custom_status && (
          <span className="member-custom-status">{member.user.custom_status}</span>
        )}
      </div>
    </div>
  );
}
