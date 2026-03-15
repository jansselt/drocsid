import { useState, useEffect, useRef, useCallback } from 'react';
import { connectLogStream } from '../api';

const MAX_LINES = 2000;

function extractLevel(line: string): string {
  // Rust tracing format: "... INFO ..." or "... DEBUG ..."
  const rustMatch = line.match(/\s(TRACE|DEBUG|INFO|WARN|ERROR)\s/);
  if (rustMatch) return rustMatch[1];
  // LiveKit Go format: "... INF ..." or "... WRN ..." or "... ERR ..."
  const goMatch = line.match(/\s(DBG|INF|WRN|ERR)\s/);
  if (goMatch) {
    const map: Record<string, string> = { DBG: 'DEBUG', INF: 'INFO', WRN: 'WARN', ERR: 'ERROR' };
    return map[goMatch[1]] || 'INFO';
  }
  return 'INFO';
}

export function LogsPage() {
  const [lines, setLines] = useState<string[]>([]);
  const [level, setLevel] = useState('INFO');
  const [filter, setFilter] = useState('');
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    wsRef.current?.close();
    setLines([]);
    setConnected(false);

    const ws = connectLogStream(
      (line) => {
        setLines((prev) => {
          const next = [...prev, line];
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
        });
        setConnected(true);
      },
      () => setConnected(false),
      level,
    );

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    wsRef.current = ws;
  }, [level]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const filteredLines = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div>
      <div className="log-toolbar">
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="TRACE">TRACE</option>
          <option value="DEBUG">DEBUG</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <input
          type="text"
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <span className={`badge ${connected ? 'badge-success' : 'badge-danger'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <button onClick={() => setLines([])}>Clear</button>
        <button onClick={connect}>Reconnect</button>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
          {filteredLines.length} lines
        </span>
      </div>

      <div
        ref={containerRef}
        className="log-container"
        onScroll={handleScroll}
      >
        {filteredLines.map((line, i) => {
          const lvl = extractLevel(line);
          return (
            <div key={i} className={`log-line log-level-${lvl}`}>
              {line}
            </div>
          );
        })}
        {filteredLines.length === 0 && (
          <div className="empty" style={{ padding: '2rem' }}>
            {connected ? 'Waiting for logs...' : 'Not connected'}
          </div>
        )}
      </div>
    </div>
  );
}
