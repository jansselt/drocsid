-- Allow users to close DMs without losing history

ALTER TABLE dm_members ADD COLUMN closed BOOLEAN NOT NULL DEFAULT FALSE;
