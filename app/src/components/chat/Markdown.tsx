import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { SHORTCODE_MAP } from './EmojiPicker';
import { LinkPreview } from './LinkPreview';
import './Markdown.css';

interface MarkdownProps {
  content: string;
}

type TokenType = 'text' | 'bold' | 'italic' | 'bolditalic' | 'spoiler' | 'code' | 'codeblock' | 'link' | 'image' | 'youtube' | 'twitter' | 'tiktok' | 'instagram' | 'threads' | 'bluesky' | 'mention' | 'br';

interface Token {
  type: TokenType;
  text: string;
  lang?: string;
  href?: string;
}

function getYouTubeId(url: string): string | null {
  // youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, youtube.com/shorts/ID
  const m = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function getTwitterId(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return m ? m[1] : null;
}

function getTikTokId(url: string): string | null {
  const m = url.match(/tiktok\.com\/@[\w.]+\/video\/(\d+)/);
  return m ? m[1] : null;
}

function getInstagramInfo(url: string): { shortcode: string; kind: string } | null {
  let m = url.match(/instagram\.com\/p\/([\w-]+)/);
  if (m) return { shortcode: m[1], kind: 'p' };
  m = url.match(/instagram\.com\/reel\/([\w-]+)/);
  if (m) return { shortcode: m[1], kind: 'reel' };
  return null;
}

function getThreadsInfo(url: string): { user: string; id: string } | null {
  const m = url.match(/threads\.net\/@([\w.]+)\/post\/([\w-]+)/);
  return m ? { user: m[1], id: m[2] } : null;
}

function getBlueskyInfo(url: string): { handle: string; rkey: string } | null {
  const m = url.match(/bsky\.app\/profile\/([\w.:-]+)\/post\/([\w]+)/);
  return m ? { handle: m[1], rkey: m[2] } : null;
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

    // Spoiler: ||text||
    match = remaining.match(/^\|\|(.+?)\|\|/);
    if (match) {
      tokens.push({ type: 'spoiler', text: match[1] });
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
      const tweetId = getTwitterId(url);
      const tikTokId = getTikTokId(url);
      const igInfo = getInstagramInfo(url);
      const threadsInfo = getThreadsInfo(url);
      const bskyInfo = getBlueskyInfo(url);

      if (ytId) {
        tokens.push({ type: 'youtube', text: ytId, href: url });
      } else if (tweetId) {
        tokens.push({ type: 'twitter', text: tweetId, href: url });
      } else if (tikTokId) {
        tokens.push({ type: 'tiktok', text: tikTokId, href: url });
      } else if (igInfo) {
        tokens.push({ type: 'instagram', text: igInfo.shortcode, href: url, lang: igInfo.kind });
      } else if (threadsInfo) {
        tokens.push({ type: 'threads', text: `@${threadsInfo.user}/post/${threadsInfo.id}`, href: url });
      } else if (bskyInfo) {
        tokens.push({ type: 'bluesky', text: `${bskyInfo.handle}/app.bsky.feed.post/${bskyInfo.rkey}`, href: url });
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
    match = remaining.match(/^[^*`|\n@https:]+/);
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

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`md-spoiler ${revealed ? 'md-spoiler-revealed' : ''}`}
      onClick={() => setRevealed((r) => !r)}
      role="button"
      tabIndex={0}
    >
      {children}
    </span>
  );
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
          case 'spoiler':
            return <Spoiler key={i}>{token.text}</Spoiler>;
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
                <img className="md-embedded-image" src={token.href} alt="" />
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
          case 'twitter':
            return (
              <SocialEmbed
                key={i}
                className="md-social-embed md-twitter"
                src={`https://platform.twitter.com/embed/Tweet.html?id=${token.text}&dnt=true&theme=dark`}
                title="Tweet"
                width={550}
                href={token.href}
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            );
          case 'tiktok':
            return (
              <SocialEmbed
                key={i}
                className="md-social-embed md-tiktok"
                src={`https://www.tiktok.com/embed/v2/${token.text}`}
                title="TikTok"
                width={325}
                href={token.href}
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            );
          case 'instagram':
            return (
              <SocialEmbed
                key={i}
                className="md-social-embed md-instagram"
                src={`https://www.instagram.com/${token.lang}/${token.text}/embed/`}
                title="Instagram"
                width={400}
                href={token.href}
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            );
          case 'threads':
            return (
              <SocialEmbed
                key={i}
                className="md-social-embed md-threads"
                src={`https://www.threads.net/${token.text}/embed`}
                title="Threads"
                width={400}
                href={token.href}
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            );
          case 'bluesky': {
            // token.text is "handle/app.bsky.feed.post/rkey"
            const bskyParts = token.text.split('/');
            const bskyHandle = bskyParts[0];
            const bskyRkey = bskyParts[bskyParts.length - 1];
            return (
              <BlueskyEmbed
                key={i}
                handle={bskyHandle}
                rkey={bskyRkey}
                href={token.href!}
              />
            );
          }
          case 'link':
            return (
              <span key={i} className="md-link-wrapper">
                <a className="md-link" href={token.href} target="_blank" rel="noopener noreferrer">
                  {token.text}
                </a>
                <LinkPreview url={token.href!} />
              </span>
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

/** Iframe wrapper that auto-resizes via postMessage from embed platforms */
function SocialEmbed({ src, title, className, width, href, sandbox }: {
  src: string;
  title: string;
  className: string;
  width: number;
  href?: string;
  sandbox?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);

  const onMessage = useCallback((e: MessageEvent) => {
    const iframe = iframeRef.current;
    if (!iframe || e.source !== iframe.contentWindow) return;

    let h: number | undefined;

    // Twitter/X: {"twttr.private.resize": [{height: N}]} or {"method":"resize","params":[{height:N}]}
    if (typeof e.data === 'string') {
      try {
        const parsed = JSON.parse(e.data);
        h = parsed?.['twttr.private.resize']?.[0]?.height
          ?? parsed?.params?.[0]?.height;
      } catch { /* not JSON */ }
    } else if (typeof e.data === 'object' && e.data) {
      // TikTok sends {type: "resize", height: N} or similar object messages
      // Instagram sends {type: "MEASURE", details: {height: N}}
      // Generic: look for a height property anywhere in the message
      h = e.data.height
        ?? e.data?.['twttr.private.resize']?.[0]?.height
        ?? e.data?.params?.[0]?.height
        ?? e.data?.details?.height;
    }

    if (typeof h === 'number' && h > 0) {
      setHeight(h);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onMessage]);

  return (
    <div className="md-embed">
      {href && <a className="md-link md-embed-source" href={href} target="_blank" rel="noopener noreferrer">{href}</a>}
      <iframe
        ref={iframeRef}
        className={className}
        src={src}
        title={title}
        scrolling="no"
        style={{ width, height: height > 0 ? height : undefined }}
        sandbox={sandbox}
      />
    </div>
  );
}

// Cache resolved DIDs to avoid repeated API calls
const didCache = new Map<string, string>();

function BlueskyEmbed({ handle, rkey, href }: { handle: string; rkey: string; href: string }) {
  const [did, setDid] = useState<string | null>(() => {
    // If the handle is already a DID, use it directly
    if (handle.startsWith('did:')) return handle;
    return didCache.get(handle) || null;
  });
  const [error, setError] = useState(false);

  useEffect(() => {
    if (did || handle.startsWith('did:')) return;

    let cancelled = false;
    fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.did) {
          didCache.set(handle, data.did);
          setDid(data.did);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => { cancelled = true; };
  }, [handle, did]);

  const resolvedDid = did || (handle.startsWith('did:') ? handle : null);

  if (error) {
    return (
      <span className="md-link-wrapper">
        <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">{href}</a>
      </span>
    );
  }

  if (!resolvedDid) {
    return (
      <div className="md-embed">
        <a className="md-link md-embed-source" href={href} target="_blank" rel="noopener noreferrer">{href}</a>
        <div className="md-social-embed md-bluesky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <SocialEmbed
      className="md-social-embed md-bluesky"
      src={`https://embed.bsky.app/embed/${resolvedDid}/app.bsky.feed.post/${rkey}`}
      title="Bluesky"
      width={400}
      href={href}
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  );
}
