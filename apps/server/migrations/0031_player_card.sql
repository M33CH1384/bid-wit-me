-- Player Card (owner-approved 2026-10-23): the flippable profile card's own
-- fields, stored plain on the user row like tagline / region / social_links.
--   card_status   — the card front's one-line status, in the player's own
--                   words (server cap 90, shared chat hygiene; NULL = none).
--                   Deliberately separate from tagline: the tagline is the
--                   profile's longer link-friendly line; this is the card's.
--   card_tags     — JSON array of partner-tag ids from the closed vocabulary
--                   in apps/server/src/cred/card.ts (max 3). NULL = none.
--   card_showcase — JSON array of showcased badge keys "kind:id" (max 3),
--                   validated server-side against the badges the player has
--                   actually earned. NULL = no picks (card shows the 3 most
--                   recently earned by default).
--   big_joker_at  — the Big Joker LATCH (owner, 2026-10-23): the moment a
--                   level-50 player was first seen having earned ALL badges
--                   (see badgeCompletionFor in cred/card.ts for the exact
--                   set). Set once, never cleared: the Big Joker (rank
--                   step 51) is permanent once earned, even if a future
--                   badge addition grows the earnable set. NULL = not earned.
ALTER TABLE users ADD COLUMN card_status TEXT;
ALTER TABLE users ADD COLUMN card_tags TEXT;
ALTER TABLE users ADD COLUMN card_showcase TEXT;
ALTER TABLE users ADD COLUMN big_joker_at INTEGER;

-- Big Joker seasonal upkeep record (owner, 2026-10-23): the FEAT latches
-- in users.big_joker_at forever; the ACTIVE crown is seasonal. One row
-- per player per season ('YYYY-MM', the monthly season id); completed_at
-- is set by the seasonal-challenges build when that season's upkeep set
-- is completed. No rows exist until that build ships its first set — the
-- inaugural-season rule in apps/server/src/cred/bigJokerSeason.ts covers
-- earned holders until then.
CREATE TABLE big_joker_season_upkeep(
  user_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY(user_id, season_id)
);
