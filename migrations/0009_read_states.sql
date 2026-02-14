-- Per-channel read state for each user (unread tracking + mention counts)
CREATE TABLE read_states (
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id           UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_message_id UUID,
    mention_count        INTEGER NOT NULL DEFAULT 0,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX idx_read_states_user ON read_states(user_id);

-- Track the latest message per channel for efficient unread detection
ALTER TABLE channels ADD COLUMN last_message_id UUID;
