-- Phase 6: Invites, Bans, Audit Log, Webhooks

-- ── Invites ─────────────────────────────────────────
CREATE TABLE invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id  UUID REFERENCES channels(id) ON DELETE SET NULL,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    max_uses    INTEGER,               -- NULL = unlimited
    uses        INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,           -- NULL = never expires
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invites_server ON invites(server_id);
CREATE INDEX idx_invites_code ON invites(code);

-- ── Bans ────────────────────────────────────────────
CREATE TABLE bans (
    server_id    UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, user_id)
);

CREATE INDEX idx_bans_server ON bans(server_id);

-- ── Audit Log ───────────────────────────────────────
CREATE TYPE audit_action AS ENUM (
    'server_update',
    'channel_create', 'channel_update', 'channel_delete',
    'role_create', 'role_update', 'role_delete',
    'member_kick', 'member_ban', 'member_unban',
    'invite_create', 'invite_delete',
    'webhook_create', 'webhook_update', 'webhook_delete',
    'message_delete', 'message_pin', 'message_unpin'
);

CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      audit_action NOT NULL,
    target_id   UUID,
    reason      TEXT,
    changes     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_server ON audit_log(server_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(server_id, user_id);

-- ── Webhooks ────────────────────────────────────────
CREATE TABLE webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhooks_channel ON webhooks(channel_id);
CREATE INDEX idx_webhooks_token ON webhooks(token);
