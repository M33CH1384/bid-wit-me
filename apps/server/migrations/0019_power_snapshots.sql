-- Professional Spades League P-E (Demetrius 2026-10-20): weekly Power
-- Rankings snapshots. One row per player per kind per ISO week, written by
-- the first leaderboard read of the week (see stats/power.ts). Movement is
-- this week's rank against last week's snapshot — never reconstructed from
-- live ratings, so history can't drift.
CREATE TABLE IF NOT EXISTS league_power_snapshots (
  week TEXT NOT NULL,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL,
  power INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (week, kind, user_id)
);
