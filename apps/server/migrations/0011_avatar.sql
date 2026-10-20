-- Profile pictures (Demetrius 2026-10-19): a signed-in user can upload a picture that
-- stands in for their camera at the table. Stored as a small data URL on the user row —
-- the client compresses to 256x256 (JPEG/WebP) before upload, so a row stays well under
-- the server's 200 KB decoded cap. NULL = no picture: clients fall back to the initial.
ALTER TABLE users ADD COLUMN avatar TEXT;
ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER;
