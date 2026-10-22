-- Friend activity presence (owner, 2026-10-22): "Friends should be able to
-- see if a person is online playing a solo game, partner game, or story
-- mode (solo or co-op) when they look at the Friends tab."
-- One row per signed-in user: the last reported activity (the FriendActivity
-- enum in @spades/protocol: online | bot-game | online-match | story-solo |
-- story-coop) and when it was reported. Two writers, one upsert in
-- SocialStore.stampPresence: the Social hub derives it from the socket's
-- live status (on change, plus its ~1/min stamp cadence), and
-- POST /api/social/presence takes the client's direct report (self-only —
-- the row is always the caller's own). Appear-offline users are NEVER
-- stamped by either writer, exactly like last_seen (migration 0025).
-- Read path is friends-only: SocialStore.friendsState attaches the row to
-- confirmed-friend refs in the owner's own FriendsState payload; the
-- client renders it only while fresh (PRESENCE_STALE_MS), then falls back
-- to the last_seen line. Stamped only from real reports — NEVER
-- backfilled: a player with no row simply has no presence line until
-- their next session.

CREATE TABLE presence (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  activity TEXT NOT NULL,          -- FriendActivity (validated before write)
  at INTEGER NOT NULL              -- epoch ms of the last report
);
