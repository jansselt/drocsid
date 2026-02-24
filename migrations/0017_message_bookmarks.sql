-- Per-user message bookmarks with tags
CREATE TABLE message_bookmarks (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    tags       TEXT[] NOT NULL DEFAULT '{}',
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, message_id)
);

CREATE INDEX idx_message_bookmarks_user ON message_bookmarks(user_id);
CREATE INDEX idx_message_bookmarks_tags ON message_bookmarks USING GIN(tags);
