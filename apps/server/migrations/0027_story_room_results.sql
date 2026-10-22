-- Story co-op (Phases 1–2): the server witness for pair-track results.
--
-- A co-op game is played in an authoritative room, so the room itself vouches
-- for the outcome: at game over (or a concede) the Room writes ONE row here
-- naming the game, the pair track, the stop, BOTH member accounts, who won,
-- and the honestly-computed game facts (storyFactsOf over the room's final
-- state). A pair result post is honored only against a row that names the
-- poster — won and facts are taken FROM THE ROW, never from the request
-- body — and each player is then credited through the shipped solo pipeline
-- under their own user_id (story_claims stays the per-user idempotency key).
-- One player posting never credits the other; a partner who posts late is
-- still honored (rows are retained 30 days by policy; no sweep is run by
-- this migration).

CREATE TABLE story_room_results (
  game_id TEXT PRIMARY KEY,            -- the room's family id for the game
  room_code TEXT NOT NULL,
  track_key TEXT NOT NULL,             -- 'pair:<uidA>:<uidB>' (uids sorted)
  stop_id TEXT NOT NULL,
  uid_a TEXT NOT NULL REFERENCES users(id),
  uid_b TEXT NOT NULL REFERENCES users(id),
  won INTEGER NOT NULL,                -- 1 = the pair (seats 0/2 side) won
  facts_json TEXT,                     -- JSON StoryGameFacts, computed server-side
  created_at INTEGER NOT NULL          -- epoch ms the room recorded the finish
);
CREATE INDEX idx_story_room_results_track ON story_room_results(track_key, created_at);

-- Story invites ride the existing invite plumbing with a kind (and the stop
-- they name); offline invites need the same two fields to survive delivery.
ALTER TABLE offline_invites ADD COLUMN kind TEXT;
ALTER TABLE offline_invites ADD COLUMN stop_id TEXT;
