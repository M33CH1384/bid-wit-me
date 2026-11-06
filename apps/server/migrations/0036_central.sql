-- 0036: BWM Central data foundations (Phase 1).
-- game_hands: per-hand, per-side cumulative score + that hand's side books,
-- written by saveRecord (stats/record.ts) in the same batch as the game row
-- from the history buildRecord already folds in memory. Powers score
-- timelines and mechanical turning points; rows exist only for games saved
-- after this migration (nothing is backfilled or reconstructed).
-- favorite_partners: a player's favorited partners (endpoints in
-- social/routes.ts). No FK on purpose — the read side drops rows whose
-- partner account no longer exists.
-- crews / crew_members: tables only this phase; endpoints come in Phase 3.
CREATE TABLE IF NOT EXISTS game_hands (
  game_id TEXT NOT NULL,
  hand_no INTEGER NOT NULL,
  side INTEGER NOT NULL,
  score_after INTEGER NOT NULL,
  books INTEGER NOT NULL,
  PRIMARY KEY (game_id, hand_no, side)
);
CREATE TABLE IF NOT EXISTS favorite_partners (
  user_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, partner_id)
);
CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crew_members (
  crew_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (crew_id, user_id)
);
