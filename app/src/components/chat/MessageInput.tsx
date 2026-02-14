import { useState, useRef, useCallback, useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { GifPicker } from './GifPicker';
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

export function MessageInput({ channelId }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const sendMessage = useServerStore((s) => s.sendMessage);
  const sendTypingAction = useServerStore((s) => s.sendTyping);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);

  // Reset typing timer when channel changes
  useEffect(() => {
    lastTypingRef.current = 0;
  }, [channelId]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed && uploads.length === 0) return;

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
        await sendMessage(channelId, fileMsg);
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
    try {
      await sendMessage(channelId, trimmed);
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
  };

  const addFiles = useCallback((files: FileList) => {
    const newUploads: PendingUpload[] = Array.from(files).map((file) => ({
      file,
      name: file.name,
      progress: 'pending' as const,
    }));
    setUploads((prev) => [...prev, ...newUploads]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
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

  return (
    <div
      className={`message-input-wrapper ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          Drop files to upload
        </div>
      )}

      {uploads.length > 0 && (
        <div className="upload-previews">
          {uploads.map((upload, i) => (
            <div key={i} className={`upload-preview ${upload.progress}`}>
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
          onChange={(e) => {
            setContent(e.target.value);
            // Send typing indicator (throttled to every 5s)
            const now = Date.now();
            if (now - lastTypingRef.current > 5000 && e.target.value.trim()) {
              lastTypingRef.current = now;
              sendTypingAction(channelId);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          maxLength={4000}
        />
        <button
          className="gif-btn"
          onClick={() => setShowGifs(!showGifs)}
          title="GIF"
        >
          GIF
        </button>
      </div>

      {showGifs && (
        <GifPicker
          onSelect={(gifUrl) => {
            sendMessage(channelId, gifUrl);
            setShowGifs(false);
          }}
          onClose={() => setShowGifs(false)}
        />
      )}
    </div>
  );
}
