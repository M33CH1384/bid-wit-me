-- 0040: Player of the game on the stored game.
-- The MVP's seat (a bot or guest can be it) and, when that seat is a
-- signed-in player, their account id. Additive: both are NULL on every game
-- recorded before this, and on abandoned games (no MVP is named). The career
-- count and percentage read the per-player flag in game_players.stats; these
-- columns are the game's own record of who it was.
ALTER TABLE games ADD COLUMN mvp_seat INTEGER;
ALTER TABLE games ADD COLUMN mvp_user_id TEXT;
