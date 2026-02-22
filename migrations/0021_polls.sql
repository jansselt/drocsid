CREATE TYPE poll_type AS ENUM ('single', 'multiple', 'ranked');

CREATE TABLE polls (
    id          UUID PRIMARY KEY,
    message_id  UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    poll_type   poll_type NOT NULL DEFAULT 'single',
    anonymous   BOOLEAN NOT NULL DEFAULT false,
    closes_at   TIMESTAMPTZ,
    closed      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
    id          UUID PRIMARY KEY,
    poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    position    SMALLINT NOT NULL
);

CREATE TABLE poll_votes (
    id          UUID PRIMARY KEY,
    poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id   UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank        SMALLINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_polls_channel ON polls (channel_id);
CREATE INDEX idx_polls_closes_at ON polls (closes_at) WHERE closed = false AND closes_at IS NOT NULL;
CREATE INDEX idx_poll_options_poll ON poll_options (poll_id, position);
CREATE INDEX idx_poll_votes_poll ON poll_votes (poll_id);
CREATE INDEX idx_poll_votes_user ON poll_votes (poll_id, user_id);
CREATE UNIQUE INDEX idx_poll_votes_single ON poll_votes (poll_id, user_id) WHERE rank IS NULL;
CREATE UNIQUE INDEX idx_poll_votes_ranked ON poll_votes (poll_id, option_id, user_id) WHERE rank IS NOT NULL;
