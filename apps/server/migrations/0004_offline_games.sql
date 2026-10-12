-- Offline uploads and partial backfill. Online rows keep the defaults.
ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'online';
ALTER TABLE games ADD COLUMN client_game_id TEXT;
ALTER TABLE games ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;
-- Several online rows share a NULL key. SQLite unique indexes allow that.
CREATE UNIQUE INDEX IF NOT EXISTS games_client_id ON games (client_game_id);
