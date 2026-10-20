-- Big Bank Take Lil Bank (Phase 2): open the gates.
-- The client ships in the same deploy; migrations run before the Worker/Pages
-- go live, so the flag and the UI arrive together.

-- Per-player net coin outcome at resolution (returned - escrowed), written by
-- the challenge DO into the listing projection for the Finished list/detail.
ALTER TABLE wager_challenge_players ADD COLUMN net INTEGER;

UPDATE cred_flags SET value = '1' WHERE key = 'wager_challenges_enabled';
