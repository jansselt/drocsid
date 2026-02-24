import { useState, useRef, useEffect } from 'react';
import * as api from '../../api/client';
import './BugReportModal.css';

interface BugReportModalProps {
  prefill?: string;
  onClose: () => void;
}

export function BugReportModal({ prefill = '', onClose }: BugReportModalProps) {
  const [title, setTitle] = useState(prefill);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ number: number; url: string } | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;

    const systemInfo = [
      `**User Agent:** ${navigator.userAgent}`,
      `**URL:** ${window.location.href}`,
    ].join('\n');

    setSubmitting(true);
    setError('');
    try {
      const res = await api.submitBugReport(title.trim(), description.trim() || undefined, systemInfo);
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit bug report';
      setError(msg);
    }
    setSubmitting(false);
  };

  if (result) {
    return (
      <div className="bug-report-overlay" onClick={onClose}>
        <div className="bug-report-modal" onClick={(e) => e.stopPropagation()}>
          <h2 className="bug-report-title">Bug Reported</h2>
          <p className="bug-report-desc">
            Issue #{result.number} created. Thanks for the report!
          </p>
          <div className="bug-report-actions">
            <button type="button" className="bug-report-submit" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bug-report-overlay" onClick={onClose}>
      <div className="bug-report-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="bug-report-title">Report a Bug</h2>
        <p className="bug-report-desc">
          Describe what went wrong and we'll track it.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="bug-report-field">
            <label className="bug-report-label">Title</label>
            <input
              ref={inputRef}
              className="bug-report-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the bug"
              maxLength={200}
            />
          </div>
          <div className="bug-report-field">
            <label className="bug-report-label">Details (optional)</label>
            <textarea
              className="bug-report-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected behavior, etc."
              rows={4}
            />
          </div>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.85rem', margin: '0.5rem 0' }}>{error}</p>}
          <div className="bug-report-actions">
            <button type="button" className="bug-report-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="bug-report-submit" disabled={!title.trim() || submitting}>
              {submitting ? 'Submitting...' : 'Submit Bug Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
