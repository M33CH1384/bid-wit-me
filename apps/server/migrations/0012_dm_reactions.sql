-- DM emoji reactions (Demetrius 2026-10-20): the reaction map (emoji -> reactor pids,
-- JSON; NULL when empty) travels with the DM line, the same shape as the global chat
-- `reactions TEXT` column on the Social DO's SQLite. D1 has no lazy-ALTER hook like the
-- DO constructor, so the column lands as a migration like every other D1 change.
ALTER TABLE dms ADD COLUMN reactions TEXT;
