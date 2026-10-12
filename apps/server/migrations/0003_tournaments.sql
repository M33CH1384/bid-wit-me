-- Release 9b: tournaments (index for listing; live brackets live in each Tournament Durable Object) + awards.

CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_name TEXT,
  mode TEXT NOT NULL,                         -- joker | aceDown | cutthroat
  format TEXT NOT NULL,                       -- single | swiss
  rounds INTEGER,                             -- Swiss rounds (host pick)
  team INTEGER NOT NULL,                      -- 1 = 2v2 teams, 0 = solo
  max_entrants INTEGER NOT NULL,
  start_at INTEGER NOT NULL,
  reg_open_at INTEGER NOT NULL,
  reg_close_at INTEGER NOT NULL,
  bots INTEGER NOT NULL DEFAULT 1,            -- bots play for no-shows
  status TEXT NOT NULL,                       -- upcoming | live | finished | cancelled
  entrants INTEGER NOT NULL DEFAULT 0,
  champion TEXT,                              -- champion entry name
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX tournaments_status ON tournaments (status, start_at);

-- who is in which tournament (my tournaments, reminders, account deletion)
CREATE TABLE tournament_players (
  tid TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  PRIMARY KEY (tid, user_id)
);
CREATE INDEX tp_user ON tournament_players (user_id);

-- earned awards shown on profiles (tournament champion, …)
CREATE TABLE awards (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                         -- 'champion'
  ref TEXT NOT NULL,                          -- tournament id
  label TEXT NOT NULL,                        -- tournament name
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
);
