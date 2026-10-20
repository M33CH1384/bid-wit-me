-- Profile taglines (Demetrius 2026-10-20): a short line the owner writes on their
-- profile ("tag line"). Stored plain on the user row; the client linkifies http(s)
-- URLs at render time, everything else stays text. NULL = no tagline.
ALTER TABLE users ADD COLUMN tagline TEXT;
