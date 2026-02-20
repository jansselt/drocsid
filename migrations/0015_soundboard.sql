-- Soundboard: server-scoped short audio clips playable in voice channels
CREATE TABLE soundboard_sounds (
    id          UUID PRIMARY KEY,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    audio_url   TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    emoji_name  TEXT,
    volume      REAL NOT NULL DEFAULT 1.0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_soundboard_server ON soundboard_sounds(server_id);

-- Per-server entrance sound for members (must reference a sound ≤5s)
ALTER TABLE server_members
    ADD COLUMN join_sound_id UUID REFERENCES soundboard_sounds(id) ON DELETE SET NULL;
