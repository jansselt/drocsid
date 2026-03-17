import { useState, useCallback, useMemo } from 'react';
import type { ServerMemberWithUser, User } from '../../../types';

export type MentionItem =
  | { kind: 'member'; member: ServerMemberWithUser }
  | { kind: 'special'; label: string };

export function useMentions(
  content: string,
  setContent: (val: string) => void,
  members: ServerMemberWithUser[] | undefined,
  users: Map<string, User>,
  focusInput: () => void,
) {
  const [mentionQuery, setMentionQuery] = useState<{ query: string; startPos: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Mention suggestions - filtered member list + @everyone/@here
  const mentionSuggestions: MentionItem[] = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    const items: MentionItem[] = [];
    // Add @everyone / @here when they match
    for (const label of ['everyone', 'here']) {
      if (label.startsWith(q)) {
        items.push({ kind: 'special', label });
      }
    }
    if (members) {
      for (const m of members) {
        if (items.length >= 10) break;
        const name = m.nickname || m.user.display_name || m.user.username;
        if (name.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q)) {
          items.push({ kind: 'member', member: m });
        }
      }
    }
    return items.slice(0, 10);
  }, [mentionQuery, members]);

  const isActive = mentionSuggestions.length > 0;

  // Detect @mention trigger from cursor position
  const updateMentionQuery = useCallback((text: string, cursorPos: number) => {
    // Look backwards from cursor for an unmatched @
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1) { setMentionQuery(null); return; }
    // @ must be at start or after a space/newline
    if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) { setMentionQuery(null); return; }
    const query = before.slice(atIdx + 1);
    // No spaces in mention query (user hasn't finished typing the name)
    if (/\s/.test(query)) { setMentionQuery(null); return; }
    setMentionQuery({ query, startPos: atIdx });
    setMentionIndex(0);
  }, []);

  const insertMention = useCallback((userId: string, displayName: string) => {
    if (!mentionQuery) return;
    const before = content.slice(0, mentionQuery.startPos);
    const after = content.slice(mentionQuery.startPos + mentionQuery.query.length + 1);
    // Use @username format — readable in the textarea and handled by both backend
    // mention parser and frontend Markdown renderer
    const user = users.get(userId);
    const username = user?.username || displayName;
    setContent(before + `@${username} ` + after);
    setMentionQuery(null);
    focusInput();
  }, [mentionQuery, content, users, setContent, focusInput]);

  const insertSpecialMention = useCallback((label: string) => {
    if (!mentionQuery) return;
    const before = content.slice(0, mentionQuery.startPos);
    const after = content.slice(mentionQuery.startPos + mentionQuery.query.length + 1);
    setContent(before + `@${label} ` + after);
    setMentionQuery(null);
    focusInput();
  }, [mentionQuery, content, setContent, focusInput]);

  /** Returns true if the key event was consumed by mention navigation */
  const handleKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!isActive) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionSuggestions.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      const item = mentionSuggestions[mentionIndex];
      if (item.kind === 'special') {
        insertSpecialMention(item.label);
      } else {
        const m = item.member;
        insertMention(m.user_id, m.nickname || m.user.display_name || m.user.username);
      }
      return true;
    }
    if (e.key === 'Escape') {
      setMentionQuery(null);
      return true;
    }
    return false;
  };

  return {
    mentionSuggestions,
    mentionIndex,
    setMentionIndex,
    isActive,
    updateMentionQuery,
    insertMention,
    insertSpecialMention,
    handleKeyDown,
  };
}
