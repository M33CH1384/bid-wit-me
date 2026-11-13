-- Sign-in handoff codes for the iPhone app shell (owner decision 2026-11-10: stay on the
-- free Personal Team). The shell's WKWebView cannot run passkey ceremonies — Associated
-- Domains is a paid-team capability — so an already-signed-in browser session mints a
-- one-time code and the app WebView redeems it for the ordinary session. Only the
-- SHA-256 of each code is stored; a code lives 10 minutes, is single-use, and an
-- account holds at most a handful of live codes (the mint handler retires the oldest).

CREATE TABLE handoff_codes (
  code_hash TEXT PRIMARY KEY,                -- SHA-256 (base64url) of the code; the code itself is never stored or logged
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX handoff_codes_user ON handoff_codes (user_id, created_at);
