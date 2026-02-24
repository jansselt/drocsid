-- Drocsid initial schema

-- ── Instances (federation-ready) ───────────────────────
CREATE TABLE instances (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain      TEXT NOT NULL UNIQUE,
    public_key  BYTEA,
    is_local    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Users ──────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY,
    instance_id     UUID NOT NULL REFERENCES instances(id),
    username        TEXT NOT NULL,
    display_name    TEXT,
    email           TEXT UNIQUE,
    password_hash   TEXT,
    avatar_url      TEXT,
    bio             TEXT,
    status          TEXT NOT NULL DEFAULT 'offline',
    custom_status   TEXT,
    bot             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_instance ON users(instance_id);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- ── Sessions ───────────────────────────────────────────
CREATE TABLE sessions (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    device_info     TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ── Servers (Guilds) ───────────────────────────────────
CREATE TABLE servers (
    id                  UUID PRIMARY KEY,
    instance_id         UUID NOT NULL REFERENCES instances(id),
    name                TEXT NOT NULL,
    description         TEXT,
    icon_url            TEXT,
    owner_id            UUID NOT NULL REFERENCES users(id),
    default_channel_id  UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Channels ───────────────────────────────────────────
CREATE TYPE channel_type AS ENUM ('text', 'voice', 'category', 'dm', 'groupdm');

CREATE TABLE channels (
    id              UUID PRIMARY KEY,
    instance_id     UUID NOT NULL REFERENCES instances(id),
    server_id       UUID REFERENCES servers(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES channels(id),
    channel_type    channel_type NOT NULL,
    name            TEXT,
    topic           TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channels_server ON channels(server_id);

-- Add FK for default_channel_id now that channels table exists
ALTER TABLE servers
    ADD CONSTRAINT fk_servers_default_channel
    FOREIGN KEY (default_channel_id) REFERENCES channels(id);

-- ── Messages ───────────────────────────────────────────
CREATE TABLE messages (
    id              UUID PRIMARY KEY,
    instance_id     UUID NOT NULL REFERENCES instances(id),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES users(id),
    content         TEXT,
    reply_to_id     UUID REFERENCES messages(id),
    edited_at       TIMESTAMPTZ,
    pinned          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query: messages in channel, newest first (UUIDv7 = time-sorted)
CREATE INDEX idx_messages_channel ON messages(channel_id, id DESC);

-- Full-text search
ALTER TABLE messages ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

-- ── Roles ──────────────────────────────────────────────
CREATE TABLE roles (
    id          UUID PRIMARY KEY,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       INTEGER NOT NULL DEFAULT 0,
    hoist       BOOLEAN NOT NULL DEFAULT FALSE,
    position    INTEGER NOT NULL DEFAULT 0,
    permissions BIGINT NOT NULL DEFAULT 0,
    mentionable BOOLEAN NOT NULL DEFAULT FALSE,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_roles_server ON roles(server_id);

-- ── Server Members ─────────────────────────────────────
CREATE TABLE server_members (
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    nickname    TEXT,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, user_id)
);

-- ── Member Roles ───────────────────────────────────────
CREATE TABLE member_roles (
    server_id   UUID NOT NULL,
    user_id     UUID NOT NULL,
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id, role_id),
    FOREIGN KEY (server_id, user_id) REFERENCES server_members(server_id, user_id) ON DELETE CASCADE
);

-- ── Channel Permission Overrides ───────────────────────
CREATE TABLE channel_overrides (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('role', 'member')),
    target_id   UUID NOT NULL,
    allow       BIGINT NOT NULL DEFAULT 0,
    deny        BIGINT NOT NULL DEFAULT 0,
    UNIQUE (channel_id, target_type, target_id)
);
