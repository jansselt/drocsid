import type { User } from '../types';

/**
 * Format an ISO timestamp as "Mon DD HH:MM" for display in panels.
 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Resolve a display name for a message/bookmark author.
 *
 * @param opts.author   - Embedded author object (may be null/undefined)
 * @param opts.authorId - The author's user ID (may be null/undefined)
 * @param opts.users    - User lookup map from the server store
 */
export function getAuthorName(opts: {
  author?: User | null;
  authorId?: string | null;
  users: Map<string, User>;
}): string {
  const { author, authorId, users } = opts;
  if (author) return author.display_name || author.username;
  if (!authorId) return 'Deleted User';
  const cached = users.get(authorId);
  return cached?.display_name || cached?.username || 'Unknown User';
}
