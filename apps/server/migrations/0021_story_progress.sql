-- Story Mode Phase 1 (2026-10-21): per-player story progress, keyed by
-- (player, track). Track keys: 'solo' for the solo run with Dee; Phase 2
-- co-op tracks use 'pair:<uidA>:<uidB>' (ids sorted) in the SAME tables —
-- the key shape is fixed now so pair tracks need no storage rewrite.
-- Virtual rewards only (XP + coins via the Rep ledger): no purchase, no
-- redemption, no fee (beta rule). Story matches are unrated — nothing here
-- touches ratings.

CREATE TABLE story_tracks (
  user_id TEXT NOT NULL REFERENCES users(id),
  track_key TEXT NOT NULL,
  completed_at INTEGER,              -- set when the track's final stop (the King) is first cleared
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_key)
);

CREATE TABLE story_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  track_key TEXT NOT NULL,
  stop_id TEXT NOT NULL,             -- STORY_STOPS id from @spades/bots story.ts
  attempts INTEGER NOT NULL DEFAULT 0,
  clears INTEGER NOT NULL DEFAULT 0,
  first_cleared_at INTEGER,
  last_played_at INTEGER,
  PRIMARY KEY (user_id, track_key, stop_id)
);
CREATE INDEX story_progress_user ON story_progress(user_id, track_key);

-- One finished game = one recorded result: the idempotency key for result
-- posts (a retried/duplicated post returns the stored outcome and never
-- re-credits rewards or re-counts the attempt).
CREATE TABLE story_claims (
  user_id TEXT NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  won INTEGER NOT NULL,
  first_clear INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  coins INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
