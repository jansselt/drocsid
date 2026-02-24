import { useState, useRef, useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import './SearchModal.css';

interface SearchModalProps {
  serverId?: string;
  onClose: () => void;
}

export function SearchModal({ serverId, onClose }: SearchModalProps) {
  const search = useServerStore((s) => s.search);
  const searchResults = useServerStore((s) => s.searchResults);
  const clearSearch = useServerStore((s) => s.clearSearch);
  const users = useServerStore((s) => s.users);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      clearSearch();
    };
  }, [clearSearch]);

  const handleSearch = () => {
    if (query.trim()) {
      search(query.trim(), serverId);
    }
  };

  const handleResultClick = (channelId: string) => {
    setActiveChannel(channelId);
    onClose();
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch}>Search</button>
          <button className="search-close" onClick={onClose}>&#x2715;</button>
        </div>

        <div className="search-results">
          {searchResults === null ? (
            <div className="search-empty">Enter a search query</div>
          ) : searchResults.length === 0 ? (
            <div className="search-empty">No results found</div>
          ) : (
            searchResults.map((result) => {
              const author = result.author_id ? users.get(result.author_id) : null;
              return (
                <button
                  key={result.id}
                  className="search-result"
                  onClick={() => handleResultClick(result.channel_id)}
                >
                  <div className="search-result-header">
                    <span className="search-result-author">
                      {author?.username || (result.author_id ? 'Unknown' : 'Deleted User')}
                    </span>
                    <span className="search-result-date">
                      {new Date(result.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="search-result-content">
                    {result.content || '(no content)'}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
