-- League data wave (item 6b): live highlights from online games in
-- progress — nuke detonations, Bostons, made nils / blind nils, Wheels —
-- captured by the table DO at the moment the room resolves them, read by
-- the ticker via GET /api/social/highlights. Bounded by the writer: only
-- the latest ~30 rows are kept and reads filter to the last 15 minutes,
-- so the table stays tiny by construction.
CREATE TABLE IF NOT EXISTS live_highlights (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  code TEXT NOT NULL,
  hand INTEGER
);
CREATE INDEX IF NOT EXISTS idx_live_highlights_at ON live_highlights (at DESC);
