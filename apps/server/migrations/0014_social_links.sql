-- Social links (Demetrius 2026-10-20): a player can link their public social-media
-- profiles (Instagram, X, TikTok, YouTube, Facebook, Twitch), shown as tappable
-- chips on their profile. Stored as JSON on the user row mapping platform → URL;
-- every value is server-normalized to https on the platform's own host before it
-- is stored (see apps/server/src/cred/socialLinks.ts). NULL = no links.
ALTER TABLE users ADD COLUMN social_links TEXT;
