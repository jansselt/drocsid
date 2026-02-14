import { useMemo } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { SHORTCODE_MAP } from './EmojiPicker';
import './Markdown.css';

interface MarkdownProps {
  content: string;
}

type TokenType = 'text' | 'bold' | 'italic' | 'bolditalic' | 'code' | 'codeblock' | 'link' | 'image' | 'youtube' | 'mention' | 'br';

interface Token {
  type: TokenType;
  text: string;
  lang?: string;
  href?: string;
}

function getYouTubeId(url: string): string | null {
  // youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, youtube.com/shorts/ID
  let m = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Code block: ```lang\ncode``` (multi-line) or ```code``` (single-line)
    let match = remaining.match(/^```(\w+)\n([\s\S]*?)```/);
    if (match) {
      tokens.push({ type: 'codeblock', text: match[2], lang: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }
    match = remaining.match(/^```([\s\S]*?)```/);
    if (match) {
      tokens.push({ type: 'codeblock', text: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Inline code: `code`
    match = remaining.match(/^`([^`\n]+)`/);
    if (match) {
      tokens.push({ type: 'code', text: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Bold+Italic: ***text***
    match = remaining.match(/^\*\*\*(.+?)\*\*\*/);
    if (match) {
      tokens.push({ type: 'bolditalic', text: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Bold: **text**
    match = remaining.match(/^\*\*(.+?)\*\*/);
    if (match) {
      tokens.push({ type: 'bold', text: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Italic: *text*
    match = remaining.match(/^\*(.+?)\*/);
    if (match) {
      tokens.push({ type: 'italic', text: match[1] });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // URL: auto-linked, embedded as image or YouTube if applicable
    match = remaining.match(/^(https?:\/\/[^\s<]+)/);
    if (match) {
      const url = match[1];
      const pathPart = url.split('?')[0];
      const isImage = /\.(gif|png|jpe?g|webp)$/i.test(pathPart);
      const ytId = getYouTubeId(url);

      if (ytId) {
        tokens.push({ type: 'youtube', text: ytId, href: url });
      } else if (isImage) {
        tokens.push({ type: 'image', text: url, href: url });
      } else {
        tokens.push({ type: 'link', text: url, href: url });
      }
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Emoji shortcode: :name:
    match = remaining.match(/^:([a-z0-9_]+):/);
    if (match && SHORTCODE_MAP.has(match[1])) {
      tokens.push({ type: 'text', text: SHORTCODE_MAP.get(match[1])! });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Mention: <@userId>, @everyone, @here, or @username
    match = remaining.match(/^<@([a-f0-9-]+)>/);
    if (match) {
      tokens.push({ type: 'mention', text: match[1], href: 'id' });
      remaining = remaining.slice(match[0].length);
      continue;
    }
    match = remaining.match(/^@(everyone|here)\b/);
    if (match) {
      tokens.push({ type: 'mention', text: match[1], href: 'special' });
      remaining = remaining.slice(match[0].length);
      continue;
    }
    match = remaining.match(/^@(\w{2,32})/);
    if (match) {
      tokens.push({ type: 'mention', text: match[1], href: 'name' });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Newline
    if (remaining[0] === '\n') {
      tokens.push({ type: 'br', text: '\n' });
      remaining = remaining.slice(1);
      continue;
    }

    // Plain text: consume until next special char or @
    match = remaining.match(/^[^*`\n@https:]+/);
    if (match) {
      tokens.push({ type: 'text', text: match[0] });
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Single special char that didn't match a pattern
    tokens.push({ type: 'text', text: remaining[0] });
    remaining = remaining.slice(1);
  }

  return tokens;
}

export function Markdown({ content }: MarkdownProps) {
  const tokens = useMemo(() => tokenize(content), [content]);
  const users = useServerStore((s) => s.users);
  const currentUserId = useAuthStore((s) => s.user?.id);

  return (
    <span className="markdown">
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'bold':
            return <strong key={i}>{token.text}</strong>;
          case 'italic':
            return <em key={i}>{token.text}</em>;
          case 'bolditalic':
            return <strong key={i}><em>{token.text}</em></strong>;
          case 'code':
            return <code key={i} className="md-inline-code">{token.text}</code>;
          case 'codeblock':
            return (
              <pre key={i} className="md-code-block">
                <code>{token.text}</code>
              </pre>
            );
          case 'image':
            return (
              <a key={i} className="md-image-link" href={token.href} target="_blank" rel="noopener noreferrer">
                <img className="md-embedded-image" src={token.href} alt="" loading="lazy" />
              </a>
            );
          case 'youtube':
            return (
              <div key={i} className="md-embed">
                <iframe
                  className="md-youtube"
                  src={`https://www.youtube-nocookie.com/embed/${token.text}`}
                  title="YouTube"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            );
          case 'link':
            return (
              <a key={i} className="md-link" href={token.href} target="_blank" rel="noopener noreferrer">
                {token.text}
              </a>
            );
          case 'mention': {
            if (token.href === 'special') {
              return (
                <span key={i} className="md-mention md-mention-me">
                  @{token.text}
                </span>
              );
            }
            let displayName: string;
            let isMe = false;
            if (token.href === 'id') {
              const user = users.get(token.text);
              displayName = user ? (user.display_name || user.username) : 'Unknown User';
              isMe = token.text === currentUserId;
            } else {
              displayName = token.text;
              // Check if this username matches the current user
              const currentUser = [...users.values()].find((u) => u.username === token.text);
              isMe = currentUser?.id === currentUserId;
            }
            return (
              <span key={i} className={`md-mention${isMe ? ' md-mention-me' : ''}`}>
                @{displayName}
              </span>
            );
          }
          case 'br':
            return <br key={i} />;
          default:
            return <span key={i}>{token.text}</span>;
        }
      })}
    </span>
  );
}
