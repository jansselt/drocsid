-- Enforce unique usernames at the database level
ALTER TABLE users ADD CONSTRAINT uq_users_username UNIQUE (username);
