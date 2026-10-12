-- Games that ended early (leave, a new game replacing this one, or the room expiring).
-- A finished row keeps the defaults. family ties the abandoned row to the later finished row.
ALTER TABLE games ADD COLUMN end_reason TEXT NOT NULL DEFAULT 'finished';
ALTER TABLE games ADD COLUMN leaver_id TEXT;
ALTER TABLE games ADD COLUMN family TEXT;
CREATE INDEX IF NOT EXISTS games_family ON games (family);
