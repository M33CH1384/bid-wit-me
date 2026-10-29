-- Play-Well bonuses (owner, 2026-10-29 — "add incentives for playing
-- well... if you win multiple books in a row that should account for
-- something when you get points at the end of a game"): one row per
-- (game, player) holding the bonus that player's in-game feats earned
-- at game end — the feat lines exactly as paid (post multiplier, post
-- caps), the XP and coin totals. Written by cred/playwell.ts inside the
-- game-end cred pass, next to the base finish/win XP. The row is three
-- things at once: the idempotency key (a repost never double-pays), the
-- daily-cap ledger (the day's paid bonus XP is the SUM over the day's
-- rows), and the rewards screen's source (the profile payload carries
-- the player's latest row so the postgame breakdown can itemize the
-- feats — never recomputed on the client). A row exists for EVERY
-- credited game, even one that earned no feats (xp 0, lines '[]'), so
-- the latest row always belongs to the latest game and a feat-less
-- game can never inherit an older game's lines on the rewards screen.
CREATE TABLE IF NOT EXISTS cred_playwell (
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL,
  coins INTEGER NOT NULL,
  lines TEXT NOT NULL,
  ended_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS cred_playwell_user_time ON cred_playwell (user_id, ended_at);
