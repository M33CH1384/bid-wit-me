-- Per-player mute (owner, 2026-10-23): a one-directional, PRIVATE silencer.
-- A row (muter, muted) means: for the muter only, the muted player's chat
-- lines are hidden (global + table), their DM/mention notifications never
-- fire (no toast, no ding, no push), and their DMs contribute no unread
-- count — while the messages themselves still arrive and read normally.
-- Mute never touches friendship, presence, invites, or the ability to play
-- together, and the muted player is never told. Block supersedes mute
-- wherever both exist (block rows live in `blocks`; checks run first).
CREATE TABLE IF NOT EXISTS mutes (
  muter TEXT NOT NULL,
  muted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (muter, muted)
);
