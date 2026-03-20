import { useState, useRef, useCallback, useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useUiStore } from '../../stores/uiStore';
import { GifPicker } from './GifPicker';
import { EmojiPicker } from './EmojiPicker';
import { SchedulePicker } from './SchedulePicker';
import { PollCreator } from './PollCreator';
import { SlashCommandDropdown } from './SlashCommandDropdown';
import { MentionDropdown } from './MentionDropdown';
import { UploadPreviews } from './UploadPreviews';
import { useSlashCommands, SLASH_COMMANDS, rollDice } from './hooks/useSlashCommands';
import { useMentions } from './hooks/useMentions';
import { useFileUpload } from './hooks/useFileUpload';
import * as api from '../../api/client';
import './MessageInput.css';

interface MessageInputProps {
  channelId: string;
}

export function MessageInput({ channelId }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [showGifs, setShowGifs] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [showFormatHelp, setShowFormatHelp] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const sendMessage = useServerStore((s) => s.sendMessage);
  const scheduleMessage = useServerStore((s) => s.scheduleMessage);
  const replyingTo = useUiStore((s) => s.replyingTo);
  const setReplyingTo = useUiStore((s) => s.setReplyingTo);
  const sendTypingAction = usePresenceStore((s) => s.sendTyping);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const members = useServerStore((s) => activeServerId ? s.members.get(activeServerId) : undefined);
  const users = useServerStore((s) => s.users);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Hooks
  const slash = useSlashCommands(content);
  const mentions = useMentions(content, setContent, members, users, focusInput);
  const fileUpload = useFileUpload();

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
    if (!trimmed && fileUpload.uploads.length === 0) return;

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
        if (cmd === '/roll') {
          const result = rest ? rollDice(rest) : null;
          if (!result) {
            setContent('/roll ');
            return;
          }
          trimmed = result;
        }
        if (replacement !== null) {
          trimmed = rest ? `${rest} ${replacement}` : replacement;
        }
      }
    }

    // Upload any pending files first
    for (let i = 0; i < fileUpload.uploads.length; i++) {
      const upload = fileUpload.uploads[i];
      if (upload.progress !== 'pending') continue;

      fileUpload.setUploads((prev) =>
        prev.map((u, idx) => (idx === i ? { ...u, progress: 'uploading' as const } : u)),
      );

      try {
        const { file_url } = await api.uploadChannelFile(channelId, upload.file);

        // Include file URL in message content
        const fileMsg = trimmed
          ? `${trimmed}\n${file_url}`
          : file_url;

        fileUpload.setUploads([]);
        setContent('');
        const replyId = replyingTo?.id;
        setReplyingTo(null);
        await sendMessage(channelId, fileMsg, replyId);
        return;
      } catch (err) {
        console.error('Upload failed:', err);
        fileUpload.setUploads((prev) =>
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

  return (
    <div
      className={`message-input-wrapper ${fileUpload.isDragging ? 'dragging' : ''}`}
      onDragEnter={fileUpload.handleDragEnter}
      onDragOver={fileUpload.handleDragOver}
      onDragLeave={fileUpload.handleDragLeave}
      onDrop={fileUpload.handleDrop}
    >
      {fileUpload.isDragging && (
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

      <UploadPreviews uploads={fileUpload.uploads} onRemove={fileUpload.removeUpload} />

      <SlashCommandDropdown
        commands={slash.filteredCommands}
        selectedIndex={slash.slashIndex}
        onSelect={(cmd) => slash.handleSelect(cmd, setContent, focusInput)}
        onHover={slash.setSlashIndex}
      />

      <MentionDropdown
        suggestions={mentions.mentionSuggestions}
        selectedIndex={mentions.mentionIndex}
        onSelectMember={mentions.insertMention}
        onSelectSpecial={mentions.insertSpecialMention}
        onHover={mentions.setMentionIndex}
      />

      <div className="message-input-container">
        <button
          className="upload-btn"
          onClick={fileUpload.openFilePicker}
          title="Upload file"
        >
          +
        </button>
        <input
          ref={fileUpload.fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={fileUpload.handleFileSelect}
        />
        <textarea
          ref={inputRef}
          className="message-input"
          value={content}
          onPaste={fileUpload.handlePaste}
          onChange={(e) => {
            setContent(e.target.value);
            slash.resetIndex();
            mentions.updateMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
            // Send typing indicator (throttled to every 5s)
            const now = Date.now();
            if (now - lastTypingRef.current > 5000 && e.target.value.trim()) {
              lastTypingRef.current = now;
              sendTypingAction(channelId);
            }
          }}
          onKeyDown={(e) => {
            // Handle slash command keyboard nav
            if (slash.handleKeyDown(e, setContent, focusInput)) return;
            // Handle mention keyboard nav
            if (mentions.handleKeyDown(e)) return;
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
