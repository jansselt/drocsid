import type { MentionItem } from './hooks/useMentions';

interface MentionDropdownProps {
  suggestions: MentionItem[];
  selectedIndex: number;
  onSelectMember: (userId: string, displayName: string) => void;
  onSelectSpecial: (label: string) => void;
  onHover: (index: number) => void;
}

export function MentionDropdown({
  suggestions,
  selectedIndex,
  onSelectMember,
  onSelectSpecial,
  onHover,
}: MentionDropdownProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="slash-suggestions">
      {suggestions.map((item, i) => {
        if (item.kind === 'special') {
          return (
            <button
              key={item.label}
              className={`slash-suggestion ${i === selectedIndex ? 'active' : ''}`}
              ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectSpecial(item.label);
              }}
              onMouseEnter={() => onHover(i)}
            >
              <span className="mention-avatar">@</span>
              <span className="slash-cmd-name">@{item.label}</span>
              <span className="slash-cmd-desc">{item.label === 'everyone' ? 'Notify all members' : 'Notify online members'}</span>
            </button>
          );
        }
        const m = item.member;
        const name = m.nickname || m.user.display_name || m.user.username;
        return (
          <button
            key={m.user_id}
            className={`slash-suggestion ${i === selectedIndex ? 'active' : ''}`}
            ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelectMember(m.user_id, name);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="mention-avatar">
              {m.user.avatar_url ? (
                <img src={m.user.avatar_url} alt="" />
              ) : (
                name[0].toUpperCase()
              )}
            </span>
            <span className="slash-cmd-name">{name}</span>
            {m.user.username !== name && (
              <span className="slash-cmd-desc">{m.user.username}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
