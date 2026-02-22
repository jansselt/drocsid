import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { GifPicker } from './GifPicker';
import { EmojiPicker } from './EmojiPicker';
import { SchedulePicker } from './SchedulePicker';
import { PollCreator } from './PollCreator';
import * as api from '../../api/client';
import './MessageInput.css';

interface MessageInputProps {
  channelId: string;
}

interface PendingUpload {
  file: File;
  name: string;
  progress: 'pending' | 'uploading' | 'done' | 'error';
}

// Slash commands that transform into text
const SLASH_COMMANDS: Record<string, string | null> = {
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
};

export function MessageInput({ channelId }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [showFormatHelp, setShowFormatHelp] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const sendMessage = useServerStore((s) => s.sendMessage);
  const scheduleMessage = useServerStore((s) => s.scheduleMessage);
  const replyingTo = useServerStore((s) => s.replyingTo);
  const setReplyingTo = useServerStore((s) => s.setReplyingTo);
  const sendTypingAction = useServerStore((s) => s.sendTyping);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const members = useServerStore((s) => activeServerId ? s.members.get(activeServerId) : undefined);
  const users = useServerStore((s) => s.users);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; startPos: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const dragCounterRef = useRef(0);

  // Reset typing timer when channel changes
  useEffect(() => {
    lastTypingRef.current = 0;
  }, [channelId]);

  // Focus input when replying
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus();
  }, [replyingTo]);

  const handleSubmit = async () => {
    let trimmed = content.trim();
    if (!trimmed && uploads.length === 0) return;

    // Process slash commands
    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmd = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
      const rest = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';

      if (cmd in SLASH_COMMANDS) {
        const replacement = SLASH_COMMANDS[cmd];
        if (cmd === '/spoiler') {
          if (rest) {
            trimmed = `||${rest}||`;
          } else {
            setContent('');
            return;
          }
        }
        if (cmd === '/gif') {
          setContent('');
          setGifQuery(rest);
          setShowGifs(true);
          return;
        }
        if (cmd === '/bug') {
          setContent('');
          window.dispatchEvent(new CustomEvent('open-bug-report', { detail: rest }));
          return;
        }
        if (cmd === '/poll') {
          setContent('');
          setShowPoll(true);
          return;
        }
        if (replacement !== null) {
          trimmed = rest ? `${rest} ${replacement}` : replacement;
        }
      }
    }

    // Upload any pending files first
    for (let i = 0; i < uploads.length; i++) {
      const upload = uploads[i];
      if (upload.progress !== 'pending') continue;

      setUploads((prev) =>
        prev.map((u, idx) => (idx === i ? { ...u, progress: 'uploading' as const } : u)),
      );

      try {
        const { file_url } = await api.uploadChannelFile(channelId, upload.file);

        // Include file URL in message content
        const fileMsg = trimmed
          ? `${trimmed}\n${file_url}`
          : file_url;

        setUploads([]);
        setContent('');
        const replyId = replyingTo?.id;
        setReplyingTo(null);
        await sendMessage(channelId, fileMsg, replyId);
        return;
      } catch (err) {
        console.error('Upload failed:', err);
        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, progress: 'error' as const } : u)),
        );
        return;
      }
    }

    // No uploads, just send text
    setContent('');
    const replyId = replyingTo?.id;
    setReplyingTo(null);
    try {
      await sendMessage(channelId, trimmed, replyId);
    } catch (err) {
      setContent(trimmed);
      console.error('Failed to send message:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null);
    }
  };

  const addFiles = useCallback((files: FileList) => {
    const newUploads: PendingUpload[] = Array.from(files).map((file) => ({
      file,
      name: file.name,
      progress: 'pending' as const,
    }));
    setUploads((prev) => [...prev, ...newUploads]);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  }, [addFiles]);

  const removeUpload = useCallback((index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Slash command suggestions — only while typing the command name (before any space)
  const slashSuggestions = content.startsWith('/') && !content.includes(' ')
    ? Object.keys(SLASH_COMMANDS).filter((cmd) =>
        cmd.startsWith(content.toLowerCase()),
      )
    : [];

  // Mention suggestions - filtered member list
  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery || !members) return [];
    const q = mentionQuery.query.toLowerCase();
    return members.filter((m) => {
      const name = m.nickname || m.user.display_name || m.user.username;
      return name.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q);
    }).slice(0, 10);
  }, [mentionQuery, members]);

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
    inputRef.current?.focus();
  }, [mentionQuery, content, users]);

  return (
    <div
      className={`message-input-wrapper ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          Drop files to upload
        </div>
      )}

      {replyingTo && (
        <div className="reply-indicator">
          <span className="reply-indicator-text">
            Replying to <strong>{(() => { const u = replyingTo.author_id ? users.get(replyingTo.author_id) : null; return u?.display_name || u?.username || replyingTo.author?.display_name || replyingTo.author?.username || 'Unknown'; })()}</strong>
          </span>
          <button className="reply-indicator-close" onClick={() => setReplyingTo(null)}>
            &times;
          </button>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="upload-previews">
          {uploads.map((upload, i) => (
            <div key={i} className={`upload-preview ${upload.progress}`}>
              {upload.file.type.startsWith('image/') && (
                <img
                  className="upload-thumb"
                  src={URL.createObjectURL(upload.file)}
                  alt=""
                  onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                />
              )}
              <span className="upload-name">{upload.name}</span>
              <span className="upload-size">{formatSize(upload.file.size)}</span>
              {upload.progress === 'pending' && (
                <button className="upload-remove" onClick={() => removeUpload(i)}>x</button>
              )}
              {upload.progress === 'uploading' && (
                <span className="upload-status">Uploading...</span>
              )}
              {upload.progress === 'error' && (
                <span className="upload-status error">Failed</span>
              )}
            </div>
          ))}
        </div>
      )}

      {slashSuggestions.length > 0 && (
        <div className="slash-suggestions">
          {slashSuggestions.map((cmd, i) => (
            <button
              key={cmd}
              className={`slash-suggestion ${i === slashIndex ? 'active' : ''}`}
              ref={i === slashIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                setContent(cmd + ' ');
                inputRef.current?.focus();
              }}
              onMouseEnter={() => setSlashIndex(i)}
            >
              <span className="slash-cmd-name">{cmd}</span>
              <span className="slash-cmd-desc">
                {cmd === '/spoiler' ? 'Hide text behind spoiler' : cmd === '/gif' ? 'Open GIF picker' : cmd === '/bug' ? 'Report a bug' : cmd === '/poll' ? 'Create a poll' : SLASH_COMMANDS[cmd]}
              </span>
            </button>
          ))}
        </div>
      )}

      {mentionSuggestions.length > 0 && (
        <div className="slash-suggestions">
          {mentionSuggestions.map((m, i) => {
            const name = m.nickname || m.user.display_name || m.user.username;
            return (
              <button
                key={m.user_id}
                className={`slash-suggestion ${i === mentionIndex ? 'active' : ''}`}
                ref={i === mentionIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(m.user_id, name);
                }}
                onMouseEnter={() => setMentionIndex(i)}
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
      )}

      <div className="message-input-container">
        <button
          className="upload-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Upload file"
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <textarea
          ref={inputRef}
          className="message-input"
          value={content}
          onPaste={handlePaste}
          onChange={(e) => {
            setContent(e.target.value);
            setSlashIndex(0);
            updateMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
            // Send typing indicator (throttled to every 5s)
            const now = Date.now();
            if (now - lastTypingRef.current > 5000 && e.target.value.trim()) {
              lastTypingRef.current = now;
              sendTypingAction(channelId);
            }
          }}
          onKeyDown={(e) => {
            // Handle slash command keyboard nav
            if (slashSuggestions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashIndex((i) => Math.min(i + 1, slashSuggestions.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                setContent(slashSuggestions[slashIndex] + ' ');
                inputRef.current?.focus();
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setContent('');
                return;
              }
            }
            // Handle mention keyboard nav
            if (mentionSuggestions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                const m = mentionSuggestions[mentionIndex];
                insertMention(m.user_id, m.nickname || m.user.display_name || m.user.username);
                return;
              }
              if (e.key === 'Escape') {
                setMentionQuery(null);
                return;
              }
            }
            handleKeyDown(e);
          }}
          placeholder="Send a message..."
          rows={1}
          maxLength={4000}
        />
        <button
          className="gif-btn"
          onClick={() => { setGifQuery(''); setShowGifs(!showGifs); }}
          title="GIF"
        >
          GIF
        </button>
        <button
          className="gif-btn"
          onClick={() => setShowEmojis(!showEmojis)}
          title="Emoji"
        >
          {'\u{1F600}'}
        </button>
        <button
          className="gif-btn"
          onClick={() => setShowSchedule(!showSchedule)}
          title="Schedule message"
        >
          {'\u{1F552}'}
        </button>
        <button
          className="gif-btn"
          onClick={() => setShowPoll(!showPoll)}
          title="Create poll"
        >
          {'\u{1F4CA}'}
        </button>
        <button
          className="gif-btn"
          onClick={() => setShowFormatHelp(!showFormatHelp)}
          title="Formatting help"
        >
          ?
        </button>
      </div>

      {showGifs && (
        <GifPicker
          initialQuery={gifQuery}
          onSelect={(gifUrl) => {
            sendMessage(channelId, gifUrl);
            setShowGifs(false);
          }}
          onClose={() => setShowGifs(false)}
        />
      )}

      {showEmojis && (
        <EmojiPicker
          onSelect={(emoji) => {
            setContent((prev) => prev + emoji);
            inputRef.current?.focus();
          }}
          onClose={() => setShowEmojis(false)}
        />
      )}

      {showSchedule && (
        <SchedulePicker
          onSchedule={async (sendAt) => {
            const trimmed = content.trim();
            if (!trimmed) return;
            const replyId = replyingTo?.id;
            setReplyingTo(null);
            setContent('');
            setShowSchedule(false);
            await scheduleMessage(channelId, trimmed, sendAt, replyId);
          }}
          onClose={() => setShowSchedule(false)}
        />
      )}

      {showPoll && (
        <PollCreator
          channelId={channelId}
          onClose={() => setShowPoll(false)}
        />
      )}

      {showFormatHelp && (
        <div className="format-help-panel">
          <div className="format-help-header">
            <span>Formatting</span>
            <button className="format-help-close" onClick={() => setShowFormatHelp(false)}>&times;</button>
          </div>
          <div className="format-help-grid">
            <span className="format-help-syntax">**bold**</span><span className="format-help-result"><strong>bold</strong></span>
            <span className="format-help-syntax">*italic*</span><span className="format-help-result"><em>italic</em></span>
            <span className="format-help-syntax">***bold italic***</span><span className="format-help-result"><strong><em>bold italic</em></strong></span>
            <span className="format-help-syntax">||spoiler||</span><span className="format-help-result"><span className="format-help-spoiler">spoiler</span></span>
            <span className="format-help-syntax">`inline code`</span><span className="format-help-result"><code className="md-inline-code">inline code</code></span>
            <span className="format-help-syntax">```code block```</span><span className="format-help-result"><code className="md-inline-code">code block</code></span>
            <span className="format-help-syntax">&lt;@user&gt;</span><span className="format-help-result">Mention a user</span>
            <span className="format-help-syntax">:emoji:</span><span className="format-help-result">Emoji shortcode</span>
          </div>
        </div>
      )}
    </div>
  );
}
