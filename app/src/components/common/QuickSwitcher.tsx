import { useState, useEffect, useRef, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import './QuickSwitcher.css';

interface QuickSwitcherProps {
  onClose: () => void;
}

interface SwitcherItem {
  type: 'server' | 'channel' | 'dm';
  id: string;
  serverId?: string;
  label: string;
  sublabel?: string;
  icon: string;
}

export function QuickSwitcher({ onClose }: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const servers = useServerStore((s) => s.servers);
  const channels = useServerStore((s) => s.channels);
  const dmChannels = useServerStore((s) => s.dmChannels);
  const dmRecipients = useServerStore((s) => s.dmRecipients);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);
  const setActiveDmChannel = useServerStore((s) => s.setActiveDmChannel);
  const setView = useServerStore((s) => s.setView);

  // Build list of all navigable items
  const allItems: SwitcherItem[] = [];

  for (const server of servers) {
    allItems.push({
      type: 'server',
      id: server.id,
      label: server.name,
      icon: server.name.slice(0, 2).toUpperCase(),
    });

    const serverChannels = channels.get(server.id) || [];
    for (const ch of serverChannels) {
      if (ch.channel_type === 'text') {
        allItems.push({
          type: 'channel',
          id: ch.id,
          serverId: server.id,
          label: ch.name || 'unnamed',
          sublabel: server.name,
          icon: '#',
        });
      }
    }
  }

  for (const dm of dmChannels) {
    const recipients = dmRecipients.get(dm.id) || [];
    const label = dm.channel_type === 'groupdm'
      ? dm.name || recipients.map((u) => u.username).join(', ')
      : recipients[0]?.username || 'Unknown';

    allItems.push({
      type: 'dm',
      id: dm.id,
      label,
      icon: '@',
    });
  }

  // Filter by query
  const q = query.toLowerCase().trim();
  const filtered = q
    ? allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel && item.sublabel.toLowerCase().includes(q)),
      )
    : allItems;

  // Limit results
  const results = filtered.slice(0, 20);

  const navigate = useCallback(
    (item: SwitcherItem) => {
      switch (item.type) {
        case 'server':
          setActiveServer(item.id);
          break;
        case 'channel':
          if (item.serverId) {
            setActiveServer(item.serverId);
          }
          setActiveChannel(item.id);
          break;
        case 'dm':
          setView('home');
          setActiveDmChannel(item.id);
          break;
      }
      onClose();
    },
    [setActiveServer, setActiveChannel, setActiveDmChannel, setView, onClose],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          navigate(results[selectedIndex]);
        }
        break;
      case 'Escape':
        onClose();
        break;
    }
  };

  return (
    <div className="quick-switcher-overlay" onClick={onClose}>
      <div className="quick-switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="quick-switcher-input"
          placeholder="Where would you like to go?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="quick-switcher-results" ref={listRef}>
          {results.length === 0 ? (
            <div className="quick-switcher-empty">No results found</div>
          ) : (
            results.map((item, i) => (
              <button
                key={`${item.type}-${item.id}`}
                className={`quick-switcher-item ${i === selectedIndex ? 'selected' : ''}`}
                onClick={() => navigate(item)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="quick-switcher-icon">{item.icon}</span>
                <span className="quick-switcher-label">{item.label}</span>
                {item.sublabel && (
                  <span className="quick-switcher-sublabel">{item.sublabel}</span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="quick-switcher-hint">
          <kbd>↑↓</kbd> navigate <kbd>↵</kbd> select <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  );
}
