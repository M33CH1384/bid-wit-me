-- Release 9a: social (friends, blocks, DMs, reports, settings) + online game records and ratings.
-- Global chat lives in the Social Durable Object's own SQLite (last ~200 lines); everything per-user lives here.

-- server secrets generated on first use (e.g. the HMAC key for short-lived account tickets)
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE social_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  appear_offline INTEGER NOT NULL DEFAULT 0,
  friends_only_invites INTEGER NOT NULL DEFAULT 0,
  hide_location INTEGER NOT NULL DEFAULT 0,
  region TEXT,                                -- coarse (e.g. "US-GA" / "GB"), from Cloudflare geo; never shown when hidden
  updated_at INTEGER
);

-- one row per pair, a < b; status 'pending' (requested_by asked) or 'friends'
CREATE TABLE friends (
  a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX friends_b ON friends (b);

CREATE TABLE blocks (
  blocker TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker, blocked)
);
CREATE INDEX blocks_blocked ON blocks (blocked);

CREATE TABLE dms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a TEXT NOT NULL,                            -- pair key (a < b)
  b TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  read_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX dms_pair ON dms (a, b, id);
CREATE INDEX dms_unread ON dms (recipient, read_at);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter TEXT NOT NULL,
  target_user TEXT,
  kind TEXT NOT NULL,                         -- 'global' | 'dm' | 'user'
  msg_id INTEGER,
  text TEXT,                                  -- snapshot of the reported message
  reason TEXT,
  at INTEGER NOT NULL,
  resolved_at INTEGER
);

-- finished online games with at least one signed-in player
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL,
  mode TEXT NOT NULL,                          -- rules mode (joker, aceDown, cutthroat…)
  kind TEXT NOT NULL,                          -- rating pool: 'team' | 'cutthroat'
  ended_at INTEGER NOT NULL,
  hands INTEGER NOT NULL,
  final TEXT NOT NULL,                         -- JSON per-side scores
  winners TEXT NOT NULL,                       -- JSON side indexes
  names TEXT NOT NULL,                         -- JSON side names
  seats TEXT NOT NULL,                         -- JSON [{name, side, kind: 'user'|'guest'|'bot', uid?}]
  rated INTEGER NOT NULL DEFAULT 0,
  tournament_id TEXT
);
CREATE INDEX games_ended ON games (ended_at);

CREATE TABLE game_players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  seat INTEGER NOT NULL,
  side INTEGER NOT NULL,
  won INTEGER NOT NULL,
  partner_id TEXT,                             -- signed-in partner (team games), for Best duos
  team_name TEXT,
  ended_at INTEGER NOT NULL,
  stats TEXT NOT NULL,                         -- JSON PlayerGameStats
  elo_before REAL,
  elo_after REAL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX gp_user ON game_players (user_id, ended_at);
CREATE INDEX gp_ended ON game_players (ended_at);

CREATE TABLE ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                          -- 'team' | 'cutthroat'
  elo REAL NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  peak REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
CREATE INDEX ratings_kind ON ratings (kind, elo);
