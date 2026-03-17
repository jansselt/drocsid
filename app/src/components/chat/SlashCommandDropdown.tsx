import { SLASH_COMMANDS } from './hooks/useSlashCommands';

interface SlashCommandDropdownProps {
  commands: string[];
  selectedIndex: number;
  onSelect: (cmd: string) => void;
  onHover: (index: number) => void;
}

export function SlashCommandDropdown({
  commands,
  selectedIndex,
  onSelect,
  onHover,
}: SlashCommandDropdownProps) {
  if (commands.length === 0) return null;

  return (
    <div className="slash-suggestions">
      {commands.map((cmd, i) => (
        <button
          key={cmd}
          className={`slash-suggestion ${i === selectedIndex ? 'active' : ''}`}
          ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="slash-cmd-name">{cmd}</span>
          <span className="slash-cmd-desc">
            {cmd === '/spoiler' ? 'Hide text behind spoiler' : cmd === '/gif' ? 'Open GIF picker' : cmd === '/bug' ? 'Report a bug' : cmd === '/poll' ? 'Create a poll' : SLASH_COMMANDS[cmd]}
          </span>
        </button>
      ))}
    </div>
  );
}
