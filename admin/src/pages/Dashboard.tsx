import type { ServerHealth } from '../api';

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMemory(kb: number): string {
  if (kb > 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb > 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  variant?: 'success' | 'warning' | 'danger';
}

function MetricCard({ label, value, variant }: MetricCardProps) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className={`card-value ${variant ?? ''}`}>{value}</div>
    </div>
  );
}

export function Dashboard({ health }: { health: ServerHealth | null }) {
  if (!health) return <div className="loading">Loading...</div>;

  const dbUsage = health.db_pool_size > 0
    ? Math.round((1 - health.db_pool_idle / health.db_pool_size) * 100)
    : 0;

  return (
    <div>
      <h2>Server Health</h2>
      <div className="card-grid">
        <MetricCard label="Uptime" value={formatUptime(health.uptime_secs)} />
        <MetricCard
          label="Connected Users"
          value={health.connected_users}
          variant={health.connected_users > 0 ? 'success' : undefined}
        />
        <MetricCard label="Sessions" value={health.connected_sessions} />
        <MetricCard
          label="Voice Channels"
          value={health.voice_channels_active}
          variant={health.voice_channels_active > 0 ? 'success' : undefined}
        />
        <MetricCard
          label="Voice Users"
          value={health.voice_users}
          variant={health.voice_users > 0 ? 'success' : undefined}
        />
        <MetricCard
          label="Memory"
          value={health.memory_rss_kb ? formatMemory(health.memory_rss_kb) : 'N/A'}
        />
        <MetricCard
          label="DB Pool"
          value={`${dbUsage}% (${health.db_pool_idle}/${health.db_pool_size} idle)`}
          variant={dbUsage > 80 ? 'danger' : dbUsage > 50 ? 'warning' : undefined}
        />
      </div>

      <h2>Services</h2>
      <div className="card-grid">
        <div className="card">
          <div className="card-label">Redis</div>
          <span className={`badge ${health.redis_connected ? 'badge-success' : 'badge-danger'}`}>
            {health.redis_connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="card">
          <div className="card-label">S3/MinIO</div>
          <span className={`badge ${health.s3_configured ? 'badge-success' : 'badge-warning'}`}>
            {health.s3_configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <div className="card">
          <div className="card-label">LiveKit</div>
          <span className={`badge ${health.livekit_configured ? 'badge-success' : 'badge-warning'}`}>
            {health.livekit_configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
      </div>
    </div>
  );
}
