-- Phase 4: DMs, relationships, threads, typing

-- ── Relationships (friends, blocks) ──────────────────
CREATE TYPE relationship_type AS ENUM ('friend', 'blocked', 'pending_outgoing', 'pending_incoming');

CREATE TABLE relationships (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rel_type    relationship_type NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, target_id)
);

CREATE INDEX idx_relationships_user ON relationships(user_id);
CREATE INDEX idx_relationships_target ON relationships(target_id);

-- ── DM channel members ───────────────────────────────
CREATE TABLE dm_members (
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_dm_members_user ON dm_members(user_id);

-- ── Thread metadata ──────────────────────────────────
CREATE TABLE thread_metadata (
    channel_id          UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    parent_channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    starter_message_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
    archived            BOOLEAN NOT NULL DEFAULT FALSE,
    locked              BOOLEAN NOT NULL DEFAULT FALSE,
    message_count       INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_thread_metadata_parent ON thread_metadata(parent_channel_id);

-- ── Full-text search index already exists on messages from 0001
-- Just add a helper function for search
CREATE OR REPLACE FUNCTION search_messages(
    p_query TEXT,
    p_channel_id UUID DEFAULT NULL,
    p_server_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 25,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    id UUID,
    instance_id UUID,
    channel_id UUID,
    author_id UUID,
    content TEXT,
    reply_to_id UUID,
    edited_at TIMESTAMPTZ,
    pinned BOOLEAN,
    created_at TIMESTAMPTZ,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id, m.instance_id, m.channel_id, m.author_id, m.content,
        m.reply_to_id, m.edited_at, m.pinned, m.created_at,
        ts_rank(m.search_vector, websearch_to_tsquery('english', p_query)) AS rank
    FROM messages m
    INNER JOIN channels c ON m.channel_id = c.id
    WHERE m.search_vector @@ websearch_to_tsquery('english', p_query)
      AND (p_channel_id IS NULL OR m.channel_id = p_channel_id)
      AND (p_server_id IS NULL OR c.server_id = p_server_id)
    ORDER BY rank DESC, m.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;
