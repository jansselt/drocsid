-- Per-channel and per-server notification preferences
CREATE TABLE notification_preferences (
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id          UUID NOT NULL,
    target_type        TEXT NOT NULL CHECK (target_type IN ('channel', 'server')),
    notification_level TEXT NOT NULL DEFAULT 'all' CHECK (notification_level IN ('all', 'mentions', 'nothing')),
    muted              BOOLEAN NOT NULL DEFAULT false,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, target_id)
);

CREATE INDEX idx_notification_prefs_user ON notification_preferences(user_id);
