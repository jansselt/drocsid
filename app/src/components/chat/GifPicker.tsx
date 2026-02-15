import { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '../../api/client';
import type { GifItem } from '../../types';
import './GifPicker.css';

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
  initialQuery?: string;
}

export function GifPicker({ onSelect, onClose, initialQuery = '' }: GifPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Click-outside to dismiss
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use setTimeout so the click that opened the picker doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  // Escape to dismiss
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const loadTrending = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.gifTrending(25);
      setGifs(result.gifs);
    } catch {
      setError('GIF search not configured');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    if (initialQuery.trim()) {
      // Pre-populated search from /gif command
      setLoading(true);
      api.gifSearch(initialQuery.trim()).then((result) => {
        setGifs(result.gifs);
        setLoading(false);
      }).catch(() => {
        setError('Search failed');
        setLoading(false);
      });
    } else {
      loadTrending();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    clearTimeout(searchTimeout.current);

    if (!value.trim()) {
      loadTrending();
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await api.gifSearch(value.trim());
        setGifs(result.gifs);
      } catch {
        setError('Search failed');
      }
      setLoading(false);
    }, 300);
  };

  const handleSelect = (gif: GifItem) => {
    onSelect(gif.url);
    onClose();
  };

  return (
    <div className={`gif-picker ${initialQuery ? 'gif-picker-left' : ''}`} ref={pickerRef}>
      <div className="gif-picker-header">
        <input
          ref={inputRef}
          className="gif-picker-search"
          type="text"
          placeholder="Search GIFs..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      <div className="gif-picker-grid">
        {loading && gifs.length === 0 && (
          <div className="gif-picker-status">Loading...</div>
        )}
        {error && <div className="gif-picker-status">{error}</div>}
        {!loading && !error && gifs.length === 0 && (
          <div className="gif-picker-status">No GIFs found</div>
        )}
        {gifs.map((gif) => (
          <button
            key={gif.id}
            className="gif-picker-item"
            onClick={() => handleSelect(gif)}
            title={gif.title}
          >
            <img
              src={gif.preview_url}
              alt={gif.title}
              loading="lazy"
              width={gif.preview_width}
              height={gif.preview_height}
            />
          </button>
        ))}
      </div>

      <div className="gif-picker-footer">
        Powered by GIPHY
      </div>
    </div>
  );
}
