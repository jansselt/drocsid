import { useState } from 'react';
import { setInstanceUrl, validateInstance } from '../../api/instance';
import './AuthPage.css';

interface InstancePickerProps {
  onInstanceSelected: () => void;
}

export function InstancePicker({ onInstanceSelected }: InstancePickerProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) {
      setError('Please enter a server URL');
      return;
    }

    // Ensure it looks like a URL
    let normalized = trimmed;
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }

    setLoading(true);
    const valid = await validateInstance(normalized);

    if (!valid) {
      // Try http if https failed (common for local dev)
      if (normalized.startsWith('https://')) {
        const httpUrl = normalized.replace('https://', 'http://');
        const httpValid = await validateInstance(httpUrl);
        if (httpValid) {
          setInstanceUrl(httpUrl);
          onInstanceSelected();
          return;
        }
      }
      setLoading(false);
      setError('Could not connect to that server. Check the URL and try again.');
      return;
    }

    setInstanceUrl(normalized);
    onInstanceSelected();
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Drocsid</h1>
        <p className="auth-subtitle">
          Connect to a Drocsid server to get started
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="instance-url">Server URL</label>
            <input
              id="instance-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g. drocsid.example.com"
              autoComplete="url"
              autoFocus
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}
