-- 0035: client crash / error telemetry (apps/server/src/crashes.ts).
-- Written by POST /api/crashes from the web client's beacon reporter
-- (apps/web/src/telemetry.ts); read via GET /api/crashes/list (admin) or
-- direct D1 queries. The Worker's scheduled handler prunes rows at 30 days.
CREATE TABLE IF NOT EXISTS client_crashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  uid TEXT,
  ip TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  stack TEXT,
  route TEXT,
  build TEXT,
  context TEXT,
  crumbs TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_client_crashes_ts ON client_crashes (ts);
CREATE INDEX IF NOT EXISTS idx_client_crashes_kind_ts ON client_crashes (kind, ts);
