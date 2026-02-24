import { useState, useEffect, useCallback } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import type { Poll } from '../../types';
import './PollCard.css';

interface PollCardProps {
  messageId: string;
  channelId: string;
}

export function PollCard({ messageId, channelId }: PollCardProps) {
  const poll = useServerStore((s) => s.polls.get(messageId));
  const castVote = useServerStore((s) => s.castVote);
  const retractVote = useServerStore((s) => s.retractVote);
  const closePollAction = useServerStore((s) => s.closePoll);
  const currentUser = useAuthStore((s) => s.user);

  // Local selection state (for multiple/ranked before submit)
  const [selected, setSelected] = useState<string[]>([]);
  const [voting, setVoting] = useState(false);
  const [countdown, setCountdown] = useState('');

  const hasVoted = poll ? poll.my_votes.length > 0 : false;
  const isCreator = poll?.creator_id === currentUser?.id;
  const isClosed = poll?.closed ?? false;

  // Countdown timer
  useEffect(() => {
    if (!poll?.closes_at || isClosed) {
      setCountdown('');
      return;
    }
    const update = () => {
      const diff = new Date(poll.closes_at!).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown('Closing...');
        return;
      }
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (hrs > 24) {
        const days = Math.floor(hrs / 24);
        setCountdown(`${days}d ${hrs % 24}h left`);
      } else if (hrs > 0) {
        setCountdown(`${hrs}h ${mins}m left`);
      } else if (mins > 0) {
        setCountdown(`${mins}m ${secs}s left`);
      } else {
        setCountdown(`${secs}s left`);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [poll?.closes_at, isClosed]);

  const handleSingleVote = useCallback(async (optionId: string) => {
    if (isClosed || voting) return;
    setVoting(true);
    try {
      await castVote(channelId, poll!.id, [optionId]);
    } catch { /* ignore */ }
    setVoting(false);
  }, [channelId, poll?.id, isClosed, voting, castVote]);

  const toggleMultipleSelect = useCallback((optionId: string) => {
    setSelected((prev) =>
      prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId],
    );
  }, []);

  const handleMultipleSubmit = useCallback(async () => {
    if (selected.length === 0 || voting) return;
    setVoting(true);
    try {
      await castVote(channelId, poll!.id, selected);
      setSelected([]);
    } catch { /* ignore */ }
    setVoting(false);
  }, [channelId, poll?.id, selected, voting, castVote]);

  const handleRankedSubmit = useCallback(async () => {
    if (selected.length === 0 || voting) return;
    setVoting(true);
    try {
      await castVote(channelId, poll!.id, selected);
      setSelected([]);
    } catch { /* ignore */ }
    setVoting(false);
  }, [channelId, poll?.id, selected, voting, castVote]);

  const handleRetract = useCallback(async () => {
    if (voting) return;
    setVoting(true);
    try {
      await retractVote(channelId, poll!.id);
    } catch { /* ignore */ }
    setVoting(false);
  }, [channelId, poll?.id, voting, retractVote]);

  const handleClose = useCallback(async () => {
    if (voting) return;
    setVoting(true);
    try {
      await closePollAction(channelId, poll!.id);
    } catch { /* ignore */ }
    setVoting(false);
  }, [channelId, poll?.id, voting, closePollAction]);

  // For ranked: move option up/down
  const moveRankedOption = useCallback((optionId: string, direction: 'up' | 'down') => {
    setSelected((prev) => {
      const idx = prev.indexOf(optionId);
      if (idx === -1) return [...prev, optionId];
      const newArr = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= newArr.length) return prev;
      [newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]];
      return newArr;
    });
  }, []);

  if (!poll) return null;

  const showResults = hasVoted || isClosed;
  const pollTypeLabel = poll.poll_type === 'single' ? 'Single Choice'
    : poll.poll_type === 'multiple' ? 'Multiple Choice' : 'Ranked Choice';

  return (
    <div className={`poll-card ${isClosed ? 'closed' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="poll-header">
        <span className="poll-type-badge">{pollTypeLabel}</span>
        <span className="poll-deadline">
          {isClosed ? 'Closed' : countdown || (poll.closes_at ? '' : 'No deadline')}
        </span>
      </div>

      <div className="poll-options">
        {poll.poll_type === 'ranked' && !showResults ? (
          <RankedVoting
            poll={poll}
            selected={selected}
            onToggle={(id) => {
              setSelected((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
              );
            }}
            onMove={moveRankedOption}
          />
        ) : (
          poll.options.map((opt) => {
            const isMyVote = poll.my_votes.some((v) => v.option_id === opt.option_id);
            const isSelected = selected.includes(opt.option_id);
            const isWinner = poll.ranked_results?.find(
              (r) => r.option_id === opt.option_id,
            )?.winner;

            return (
              <div
                key={opt.option_id}
                className={`poll-option ${isMyVote ? 'my-vote' : ''} ${isSelected ? 'selected' : ''} ${isClosed || (hasVoted && poll.poll_type === 'single') ? 'disabled' : ''} ${isWinner ? 'winner' : ''}`}
                onClick={() => {
                  if (isClosed) return;
                  if (poll.poll_type === 'single' && !hasVoted) {
                    handleSingleVote(opt.option_id);
                  } else if (poll.poll_type === 'multiple' && !hasVoted) {
                    toggleMultipleSelect(opt.option_id);
                  }
                }}
              >
                {showResults && (
                  <div
                    className="poll-option-bar"
                    style={{ width: `${opt.percentage}%` }}
                  />
                )}
                <div className="poll-option-label">
                  <span>
                    {isMyVote && <span className="poll-check">&#10003; </span>}
                    {opt.label}
                  </span>
                  {showResults && (
                    <span className="poll-option-count">
                      {opt.vote_count} ({opt.percentage.toFixed(0)}%)
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Submit button for multiple/ranked */}
      {!isClosed && !hasVoted && poll.poll_type === 'multiple' && selected.length > 0 && (
        <button className="poll-submit-btn" onClick={handleMultipleSubmit} disabled={voting}>
          {voting ? 'Voting...' : `Vote (${selected.length} selected)`}
        </button>
      )}
      {!isClosed && !hasVoted && poll.poll_type === 'ranked' && selected.length > 0 && (
        <button className="poll-submit-btn" onClick={handleRankedSubmit} disabled={voting}>
          {voting ? 'Voting...' : `Submit Ranking (${selected.length})`}
        </button>
      )}

      {/* Ranked results */}
      {showResults && poll.ranked_results && poll.ranked_results.length > 0 && (
        <div className="poll-ranked-results">
          <div className="poll-ranked-label">Instant-Runoff Results:</div>
          {poll.ranked_results
            .sort((a, b) => (a.winner ? -1 : b.winner ? 1 : (a.round_eliminated ?? 999) - (b.round_eliminated ?? 999)))
            .map((r) => (
              <div key={r.option_id} className={`poll-ranked-item ${r.winner ? 'winner' : ''}`}>
                {r.winner ? '&#9733; ' : ''}{r.label}
                {r.round_eliminated != null && (
                  <span className="poll-ranked-elim"> (eliminated round {r.round_eliminated})</span>
                )}
                {r.winner && <span className="poll-ranked-winner"> Winner!</span>}
              </div>
            ))}
        </div>
      )}

      <div className="poll-footer">
        <span className="poll-total">
          {poll.total_votes} vote{poll.total_votes !== 1 ? 's' : ''}
          {poll.anonymous ? ' (anonymous)' : ''}
        </span>
        <div className="poll-actions">
          {!isClosed && hasVoted && (
            <button className="poll-action-btn" onClick={handleRetract} disabled={voting}>
              Change Vote
            </button>
          )}
          {!isClosed && isCreator && (
            <button className="poll-action-btn poll-close-btn" onClick={handleClose} disabled={voting}>
              Close Poll
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RankedVoting({
  poll,
  selected,
  onToggle,
  onMove,
}: {
  poll: Poll;
  selected: string[];
  onToggle: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
}) {
  return (
    <div className="poll-ranked-voting">
      <div className="poll-ranked-hint">Click options to add, then reorder with arrows</div>
      {poll.options.map((opt) => {
        const rank = selected.indexOf(opt.option_id);
        const isSelected = rank !== -1;
        return (
          <div
            key={opt.option_id}
            className={`poll-option ${isSelected ? 'selected' : ''}`}
            onClick={() => onToggle(opt.option_id)}
          >
            <div className="poll-option-label">
              <span>
                {isSelected && <span className="poll-rank-num">{rank + 1}. </span>}
                {opt.label}
              </span>
              {isSelected && (
                <span className="poll-rank-arrows" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="poll-arrow-btn"
                    onClick={() => onMove(opt.option_id, 'up')}
                    disabled={rank === 0}
                  >
                    &#9650;
                  </button>
                  <button
                    className="poll-arrow-btn"
                    onClick={() => onMove(opt.option_id, 'down')}
                    disabled={rank === selected.length - 1}
                  >
                    &#9660;
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
