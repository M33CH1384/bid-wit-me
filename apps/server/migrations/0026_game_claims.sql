-- Retroactive rewards claim (owner, 2026-10-22): "If I get here and I'm not
-- signed in it should be possible for me to sign in and still get my points."
-- A game that finishes while the player is signed OUT is held on the device
-- as a pending claim; once they sign in, the client posts it to
-- /api/stats/local with claim: true and this table is the one-claim-ever
-- registry: a client game id lands here the first time any account claims
-- it, so the same guest game can never be credited into two accounts.
-- (games.client_game_id stays the per-user idempotency key for the ordinary
-- offline flush; non-claim posts never touch this table.)

CREATE TABLE game_claims (
  client_game_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  claimed_at INTEGER NOT NULL          -- epoch ms of the claim
);
