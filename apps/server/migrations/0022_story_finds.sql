-- Story Mode secrets (2026-10-21): per-track found Easter eggs and earned
-- stop feats. Eggs are hidden discoveries (never required, never shown
-- before they're found); feats also grant their collectible into the Rep
-- `unlocks` table (source 'story-feat:<stopId>') so they surface on the
-- profile Unlocks tab. Both are idempotent: the primary key makes a second
-- grant of the same find a no-op. Additive only — Phase 1 progress
-- (0021) is untouched.

CREATE TABLE story_finds (
  user_id TEXT NOT NULL REFERENCES users(id),
  track_key TEXT NOT NULL,
  kind TEXT NOT NULL,               -- 'egg' | 'feat'
  find_id TEXT NOT NULL,            -- egg id (storySecrets), or the unlockable itemId for feats
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_key, kind, find_id)
);
CREATE INDEX story_finds_user ON story_finds(user_id, track_key);
