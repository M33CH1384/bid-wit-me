-- Story Mode call-backs (2026-10-21): one open story session per (user, track).
-- The story save itself is device-local (localStorage 'bwm.storySave.v1'); the
-- client pings this table when a story match is open so the seated characters
-- can call the player back by push when a match sits unfinished (see
-- src/story/callback.ts). All timestamps are SERVER receive times (ms) —
-- client clocks are never trusted for the nudge schedule. A session closes
-- on finish / discard / resume-completion; the sweep sends at most two
-- nudges per session, ever, and stops caring after 7 days.

CREATE TABLE story_sessions (
  user_id TEXT NOT NULL REFERENCES users(id),
  track_key TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL,       -- server time the current open session began
  updated_at INTEGER NOT NULL,      -- server time of the last open/checkpoint ping
  nudges_sent INTEGER NOT NULL DEFAULT 0,
  last_nudge_at INTEGER,
  closed_at INTEGER,                -- NULL while the match is still open
  PRIMARY KEY (user_id, track_key)
);
CREATE INDEX story_sessions_open ON story_sessions(closed_at, updated_at);
