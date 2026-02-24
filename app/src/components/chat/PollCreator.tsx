import { useState, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import type { PollType } from '../../types';
import './PollCreator.css';

interface PollCreatorProps {
  channelId: string;
  onClose: () => void;
}

export function PollCreator({ channelId, onClose }: PollCreatorProps) {
  const createPoll = useServerStore((s) => s.createPoll);

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [pollType, setPollType] = useState<PollType>('single');
  const [anonymous, setAnonymous] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const addOption = useCallback(() => {
    if (options.length < 25) {
      setOptions((prev) => [...prev, '']);
    }
  }, [options.length]);

  const removeOption = useCallback((idx: number) => {
    if (options.length > 2) {
      setOptions((prev) => prev.filter((_, i) => i !== idx));
    }
  }, [options.length]);

  const updateOption = useCallback((idx: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  }, []);

  const handleSubmit = useCallback(async () => {
    setError('');
    const q = question.trim();
    if (!q) {
      setError('Question is required');
      return;
    }
    if (q.length > 500) {
      setError('Question must be 500 characters or fewer');
      return;
    }

    const validOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (validOptions.length < 2) {
      setError('At least 2 options are required');
      return;
    }
    if (validOptions.some((o) => o.length > 100)) {
      setError('Each option must be 100 characters or fewer');
      return;
    }

    let closesAt: string | undefined;
    if (deadline) {
      const d = new Date(deadline);
      if (d.getTime() <= Date.now()) {
        setError('Deadline must be in the future');
        return;
      }
      closesAt = d.toISOString();
    }

    setSubmitting(true);
    try {
      await createPoll(channelId, {
        question: q,
        options: validOptions.map((label) => ({ label })),
        poll_type: pollType,
        anonymous,
        closes_at: closesAt,
      });
      onClose();
    } catch {
      setError('Failed to create poll');
    }
    setSubmitting(false);
  }, [question, options, pollType, anonymous, deadline, channelId, createPoll, onClose]);

  return (
    <div className="poll-creator">
      <div className="poll-creator-header">
        <span>Create Poll</span>
        <button className="poll-creator-close" onClick={onClose}>&times;</button>
      </div>

      <div className="poll-creator-body">
        <label className="poll-creator-label">Question</label>
        <input
          className="poll-creator-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question..."
          maxLength={500}
          autoFocus
        />

        <label className="poll-creator-label">Options</label>
        <div className="poll-creator-options">
          {options.map((opt, idx) => (
            <div key={idx} className="poll-creator-option-row">
              <input
                className="poll-creator-input"
                value={opt}
                onChange={(e) => updateOption(idx, e.target.value)}
                placeholder={`Option ${idx + 1}`}
                maxLength={100}
              />
              {options.length > 2 && (
                <button
                  className="poll-creator-remove-opt"
                  onClick={() => removeOption(idx)}
                  title="Remove option"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          {options.length < 25 && (
            <button className="poll-creator-add-opt" onClick={addOption}>
              + Add Option
            </button>
          )}
        </div>

        <div className="poll-creator-row">
          <div className="poll-creator-field">
            <label className="poll-creator-label">Type</label>
            <select
              className="poll-creator-select"
              value={pollType}
              onChange={(e) => setPollType(e.target.value as PollType)}
            >
              <option value="single">Single Choice</option>
              <option value="multiple">Multiple Choice</option>
              <option value="ranked">Ranked Choice</option>
            </select>
          </div>
          <div className="poll-creator-field">
            <label className="poll-creator-label">Deadline</label>
            <input
              type="datetime-local"
              className="poll-creator-input"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>

        <label className="poll-creator-checkbox">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
          <span>Anonymous voting</span>
        </label>

        {error && <p className="poll-creator-error">{error}</p>}
      </div>

      <div className="poll-creator-footer">
        <button
          className="poll-creator-submit"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Creating...' : 'Create Poll'}
        </button>
      </div>
    </div>
  );
}
