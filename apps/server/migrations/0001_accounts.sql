-- Release 8: optional accounts. Guest play never touches these tables.
-- Minimal data: no emails, no passwords. A provider login stores only its stable user id + display name.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                       -- random 128-bit hex
  username TEXT,                             -- shown in game; NULL until picked on first sign-in
  username_key TEXT UNIQUE,                  -- lower-cased username (case-insensitive uniqueness)
  created_at INTEGER NOT NULL,
  progress_imported_at INTEGER               -- set once by "Save my progress"
);

-- one row per linked provider login (google, discord, x, facebook)
CREATE TABLE identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX identities_user ON identities (user_id);

-- WebAuthn passkeys (Face ID / Touch ID / fingerprint / security keys)
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,                       -- credential id (base64url)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,                  -- COSE public key
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                           -- JSON array
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- sessions: the cookie holds a random token; only its SHA-256 is stored
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_exp ON sessions (expires_at);

-- short-lived OAuth state (10 min), bound to the browser by an HttpOnly cookie carrying the same state
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  verifier TEXT,
  mode TEXT NOT NULL,                        -- 'login' | 'link'
  user_id TEXT,                              -- the signed-in user when linking
  return_to TEXT,
  created_at INTEGER NOT NULL
);

-- short-lived WebAuthn challenges (5 min)
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- 'register' | 'login'
  user_id TEXT,                              -- existing user (adding a passkey) or the id a new account will get
  username TEXT,                             -- new account: the username picked before the passkey
  created_at INTEGER NOT NULL
);

-- progress moved in from the device ("Save my progress"): badges, series, team name
CREATE TABLE progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Facebook data deletion callback: confirmation codes so people can check the status
CREATE TABLE deletion_requests (
  code TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,                      -- 'deleted' | 'not_found'
  created_at INTEGER NOT NULL
);
