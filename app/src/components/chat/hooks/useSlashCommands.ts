import { useState } from 'react';

// Slash commands that transform into text
export const SLASH_COMMANDS: Record<string, string | null> = {
  '/shrug':     '¯\\_(ツ)_/¯',
  '/tableflip': '(╯°□°)╯︵ ┻━┻',
  '/unflip':    '┬─┬ ノ( ゜-゜ノ)',
  '/lenny':     '( ͡° ͜ʖ ͡°)',
  '/disapprove': 'ಠ_ಠ',
  '/sparkles':  '✨',
  '/spoiler':   null, // special: wraps text in ||spoiler||
  '/gif':       null, // special: opens GIF picker
  '/bug':       null, // special: opens bug report modal
  '/poll':      null, // special: opens poll creator
  '/roll':      null, // special: dice roller (e.g. /roll 2d6+3)
};

/**
 * Parse and evaluate a dice expression like "2d6+3", "d20", "4d6-1"
 * Returns null if the expression is invalid.
 */
export function rollDice(expr: string): string | null {
  const match = expr.trim().toLowerCase().match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) return null;

  const count = parseInt(match[1] || '1', 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }

  const sum = rolls.reduce((a, b) => a + b, 0) + modifier;
  const rollList = rolls.length > 1 ? `[${rolls.join(', ')}]` : `${rolls[0]}`;
  const modStr = modifier !== 0 ? ` ${modifier > 0 ? '+' : ''}${modifier}` : '';
  const total = count > 1 || modifier !== 0 ? ` = **${sum}**` : '';

  return `🎲 rolled \`${expr.trim()}\` → ${rollList}${modStr}${total}`;
}

export function useSlashCommands(content: string) {
  const [slashIndex, setSlashIndex] = useState(0);

  // Slash command suggestions — only while typing the command name (before any space)
  const filteredCommands = content.startsWith('/') && !content.includes(' ')
    ? Object.keys(SLASH_COMMANDS).filter((cmd) =>
        cmd.startsWith(content.toLowerCase()),
      )
    : [];

  const isActive = filteredCommands.length > 0;

  const resetIndex = () => setSlashIndex(0);

  /** Returns true if the key event was consumed by slash command navigation */
  const handleKeyDown = (
    e: React.KeyboardEvent,
    setContent: (val: string) => void,
    focusInput: () => void,
  ): boolean => {
    if (!isActive) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSlashIndex((i) => (i + 1) % filteredCommands.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      setContent(filteredCommands[slashIndex] + ' ');
      focusInput();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setContent('');
      return true;
    }
    return false;
  };

  const handleSelect = (cmd: string, setContent: (val: string) => void, focusInput: () => void) => {
    setContent(cmd + ' ');
    focusInput();
  };

  return {
    filteredCommands,
    slashIndex,
    setSlashIndex,
    isActive,
    resetIndex,
    handleKeyDown,
    handleSelect,
  };
}
