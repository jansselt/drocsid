import { useState, useEffect, useCallback } from 'react';
import { api, type LiveKitRoom, type RoomDetail } from '../api';

export function LiveKitPage() {
  const [rooms, setRooms] = useState<LiveKitRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RoomDetail | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setError('');
      const r = await api.livekitRooms();
      setRooms(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const viewRoom = async (name: string) => {
    try {
      const detail = await api.livekitRoomDetail(name);
      setSelected(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load room');
    }
  };

  if (loading) return <div className="loading">Loading LiveKit rooms...</div>;

  return (
    <div>
      <div className="section-header">
        <h2>LiveKit Rooms</h2>
        <button className="refresh-btn" onClick={refresh}>Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}

      {rooms.length === 0 ? (
        <div className="empty">No active rooms</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Room Name</th>
                <th>Participants</th>
                <th>Publishers</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.name}>
                  <td><strong>{room.name}</strong></td>
                  <td>{room.num_participants}</td>
                  <td>{room.num_publishers}</td>
                  <td>{room.creation_time ? new Date(room.creation_time * 1000).toLocaleTimeString() : '-'}</td>
                  <td>
                    <button className="refresh-btn" onClick={() => viewRoom(room.name)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div>
          <div className="section-header">
            <h2>Room: {selected.room.name}</h2>
            <button className="refresh-btn" onClick={() => setSelected(null)}>Close</button>
          </div>

          {selected.participants.length === 0 ? (
            <div className="empty">No participants</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Identity</th>
                    <th>Name</th>
                    <th>State</th>
                    <th>Joined</th>
                    <th>Tracks</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.participants.map((p) => (
                    <tr key={p.identity}>
                      <td><code>{p.identity}</code></td>
                      <td>{p.name || '-'}</td>
                      <td>
                        <span className={`badge ${p.state === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>
                          {p.state}
                        </span>
                      </td>
                      <td>{p.joined_at ? new Date(p.joined_at * 1000).toLocaleTimeString() : '-'}</td>
                      <td>
                        {p.tracks.length === 0 ? (
                          <span className="badge badge-info">No tracks</span>
                        ) : (
                          p.tracks.map((t) => (
                            <span key={t.sid} className={`badge ${t.muted ? 'badge-warning' : 'badge-success'}`} style={{ marginRight: 4 }}>
                              {t.source || t.track_type}{t.muted ? ' (muted)' : ''}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
