import { useState, useEffect, useCallback } from 'react';
import { api, type VoiceState } from '../api';

export function VoicePage() {
  const [states, setStates] = useState<VoiceState[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api.gatewayVoice();
      setStates(s);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading) return <div className="loading">Loading voice states...</div>;

  // Group by channel
  const byChannel = new Map<string, VoiceState[]>();
  for (const vs of states) {
    const list = byChannel.get(vs.channel_id) || [];
    list.push(vs);
    byChannel.set(vs.channel_id, list);
  }

  return (
    <div>
      <div className="section-header">
        <h2>Voice Channels ({byChannel.size} active)</h2>
        <button className="refresh-btn" onClick={refresh}>Refresh</button>
      </div>

      {states.length === 0 ? (
        <div className="empty">No users in voice</div>
      ) : (
        Array.from(byChannel.entries()).map(([channelId, users]) => (
          <div key={channelId} style={{ marginBottom: '1.5rem' }}>
            <h3>Channel: {channelId.slice(0, 8)}...</h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Muted</th>
                    <th>Deafened</th>
                    <th>Audio Sharing</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((vs) => (
                    <tr key={vs.user_id}>
                      <td><code>{vs.user_id.slice(0, 8)}...</code></td>
                      <td>
                        <span className={`badge ${vs.self_mute ? 'badge-warning' : 'badge-success'}`}>
                          {vs.self_mute ? 'Muted' : 'Unmuted'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${vs.self_deaf ? 'badge-danger' : 'badge-success'}`}>
                          {vs.self_deaf ? 'Deafened' : 'Listening'}
                        </span>
                      </td>
                      <td>
                        {vs.audio_sharing && (
                          <span className="badge badge-info">Sharing</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
