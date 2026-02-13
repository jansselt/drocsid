import './StatusIndicator.css';

interface StatusIndicatorProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

const STATUS_COLORS: Record<string, string> = {
  online: '#23a55a',
  idle: '#f0b232',
  dnd: '#f23f43',
  offline: '#80848e',
};

export function StatusIndicator({ status, size = 'md' }: StatusIndicatorProps) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.offline;

  return (
    <span
      className={`status-indicator status-indicator-${size}`}
      style={{ backgroundColor: color }}
      title={status}
    >
      {status === 'dnd' && <span className="status-dnd-line" />}
      {status === 'idle' && <span className="status-idle-cutout" />}
      {status === 'offline' && <span className="status-offline-cutout" />}
    </span>
  );
}
