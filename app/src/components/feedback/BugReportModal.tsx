import { useState, useRef, useEffect } from 'react';
import './BugReportModal.css';

const GITHUB_REPO = 'jansselt/drocsid';

interface BugReportModalProps {
  prefill?: string;
  onClose: () => void;
}

export function BugReportModal({ prefill = '', onClose }: BugReportModalProps) {
  const [title, setTitle] = useState(prefill);
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const body = [
      description.trim(),
      '',
      '---',
      `**App Version:** v0.1.0`,
      `**User Agent:** ${navigator.userAgent}`,
      `**URL:** ${window.location.href}`,
    ].join('\n');

    const url = `https://github.com/${GITHUB_REPO}/issues/new?` +
      `title=${encodeURIComponent(title.trim())}` +
      `&body=${encodeURIComponent(body)}` +
      `&labels=bug`;

    window.open(url, '_blank');
    onClose();
  };

  return (
    <div className="bug-report-overlay" onClick={onClose}>
      <div className="bug-report-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="bug-report-title">Report a Bug</h2>
        <p className="bug-report-desc">
          This will open a GitHub issue. You'll need a GitHub account.
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
          <div className="bug-report-actions">
            <button type="button" className="bug-report-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="bug-report-submit" disabled={!title.trim()}>
              Open GitHub Issue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
