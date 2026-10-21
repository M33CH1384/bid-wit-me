-- Professional Spades League P-B (Demetrius 2026-10-20): self-declared Region.
-- Free text the player sets on their profile ("Harlem", "Atlanta") — powers the
-- regional leaderboard. NULL/empty = unset: the player is Global-only and never
-- appears on a regional board. Distinct from social_settings.region, which is
-- the coarse IP-derived region behind the older Local board.
ALTER TABLE users ADD COLUMN region TEXT;
