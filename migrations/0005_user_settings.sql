-- User settings: theme preference
ALTER TABLE users ADD COLUMN theme_preference TEXT NOT NULL DEFAULT 'dark';
