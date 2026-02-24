-- Add IANA timezone to user profiles (e.g., 'America/New_York')
ALTER TABLE users ADD COLUMN timezone TEXT;
