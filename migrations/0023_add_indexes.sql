-- Add missing indexes for common query patterns

CREATE INDEX IF NOT EXISTS idx_messages_author ON messages (author_id);
CREATE INDEX IF NOT EXISTS idx_channel_overrides_channel ON channel_overrides (channel_id);
