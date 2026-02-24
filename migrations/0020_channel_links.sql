CREATE TABLE channel_links (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    added_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    image       TEXT,
    site_name   TEXT,
    tags        TEXT[] NOT NULL DEFAULT '{}',
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channel_links_channel ON channel_links (channel_id, created_at DESC);
CREATE INDEX idx_channel_links_tags ON channel_links USING GIN(tags);
