-- Phase 3: Rich messages — attachments, reactions, custom emojis

-- ── Attachments ──────────────────────────────────────
CREATE TABLE attachments (
    id              UUID PRIMARY KEY,
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    url             TEXT NOT NULL,
    width           INTEGER,
    height          INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_message ON attachments(message_id);

-- ── Custom Emojis ────────────────────────────────────
CREATE TABLE custom_emojis (
    id          UUID PRIMARY KEY,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    image_url   TEXT NOT NULL,
    animated    BOOLEAN NOT NULL DEFAULT FALSE,
    creator_id  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (server_id, name)
);

CREATE INDEX idx_custom_emojis_server ON custom_emojis(server_id);

-- ── Reactions ────────────────────────────────────────
CREATE TABLE reactions (
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    emoji_name  TEXT NOT NULL,
    emoji_id    UUID REFERENCES custom_emojis(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji_name)
);

CREATE INDEX idx_reactions_message ON reactions(message_id);
