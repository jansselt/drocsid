-- Account deletion support: fix FK constraints for user deletion

-- Messages: keep messages but clear author (shows as "[Deleted User]")
ALTER TABLE messages ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_author_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;

-- Server members: cascade delete memberships
ALTER TABLE server_members DROP CONSTRAINT server_members_user_id_fkey;
ALTER TABLE server_members ADD CONSTRAINT server_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Reactions: cascade delete
ALTER TABLE reactions DROP CONSTRAINT reactions_user_id_fkey;
ALTER TABLE reactions ADD CONSTRAINT reactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Custom emojis: keep emoji but clear creator
ALTER TABLE custom_emojis DROP CONSTRAINT custom_emojis_creator_id_fkey;
ALTER TABLE custom_emojis ADD CONSTRAINT custom_emojis_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL;
