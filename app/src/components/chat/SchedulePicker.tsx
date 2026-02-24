import { useState, useRef, useEffect } from 'react';
import './SchedulePicker.css';

interface SchedulePickerProps {
  onSchedule: (sendAtIso: string) => void;
  onClose: () => void;
}

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SchedulePicker({ onSchedule, onClose }: SchedulePickerProps) {
  const now = new Date();
  const minDate = new Date(now.getTime() + 2 * 60 * 1000); // 2 min buffer
  const maxDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [value, setValue] = useState(toLocalDatetimeString(minDate));
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleSchedule = () => {
    const selected = new Date(value);
    const nowCheck = new Date();

    if (selected.getTime() <= nowCheck.getTime() + 60 * 1000) {
      setError('Must be at least 1 minute in the future');
      return;
    }
    if (selected.getTime() > nowCheck.getTime() + 7 * 24 * 60 * 60 * 1000) {
      setError('Must be within 7 days');
      return;
    }

    setError('');
    onSchedule(selected.toISOString());
  };

  return (
    <div className="schedule-picker" ref={ref}>
      <div className="schedule-picker-header">
        <span>Schedule Message</span>
        <button className="format-help-close" onClick={onClose}>&times;</button>
      </div>
      <div className="schedule-picker-body">
        <label className="schedule-picker-label">Send at</label>
        <input
          type="datetime-local"
          className="schedule-picker-input"
          value={value}
          min={toLocalDatetimeString(minDate)}
          max={toLocalDatetimeString(maxDate)}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
        />
        {error && <p className="schedule-picker-error">{error}</p>}
      </div>
      <div className="schedule-picker-footer">
        <button className="schedule-picker-btn" onClick={handleSchedule}>
          Schedule
        </button>
      </div>
    </div>
  );
}
