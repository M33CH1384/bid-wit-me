-- Last online for the Friends view (owner, 2026-10-21): "Can't the friend
-- view show when my friends were last online?"
-- One row per signed-in user: the last time the Social hub saw them active
-- (connect, then any social traffic, throttled to ~one write a minute in
-- hub.ts). Stamped only from real hub activity — NEVER backfilled: a player
-- with no row simply has no last-online line until their next session.
-- Read path is friends-only: SocialStore.friendsState attaches `at` to
-- confirmed-friend refs in the owner's own FriendsState payload; no public
-- profile / players / leaderboard query reads this table.

CREATE TABLE last_seen (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  at INTEGER NOT NULL              -- epoch ms of last hub-seen activity
);
