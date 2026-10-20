-- DM replies (Demetrius 2026-10-20): the reply snapshot (quoted line id, author
-- name + pid, text snippet — JSON; NULL when the DM is not a reply) travels with
-- the DM line, mirroring the global chat `reply` column and the DM `reactions`
-- column (0012). D1 has no lazy-ALTER hook, so the column lands as a migration.
ALTER TABLE dms ADD COLUMN reply TEXT;
