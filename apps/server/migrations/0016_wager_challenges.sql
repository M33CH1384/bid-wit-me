-- Big Bank Take Lil Bank (Phase 1, ships dark): scheduled coin-wager challenges.
-- Live state lives in one Challenge Durable Object per challenge (source of truth);
-- these tables are the listing / my-challenges projection, kept in sync by the DO
-- (same split as tournaments / tournament_players in 0003).
-- Virtual coins only: no purchase, no redemption, no table fee (beta rule).

CREATE TABLE wager_challenges (
  id TEXT PRIMARY KEY,
  challenger_id TEXT NOT NULL REFERENCES users(id),
  format TEXT NOT NULL,              -- 'partnership' | 'cutthroat'
  mode TEXT NOT NULL,                -- 'joker' | 'aceDown' | 'cutthroat'
  rules TEXT NOT NULL,               -- full TableRules JSON (frozen at creation)
  wager INTEGER NOT NULL,            -- per-player escrow (ladder: 100 | 250 | 1000 | 5000)
  start_at INTEGER NOT NULL,
  checkin_opens_at INTEGER NOT NULL, -- start_at - 10 min (also the accept deadline)
  status TEXT NOT NULL,              -- pending|scheduled|checkin|live|settled|forfeited|void|declined|expired|cancelled
  table_code TEXT,                   -- set when the match table is created
  game_id TEXT,                      -- recorded game id, set at settlement of a played match
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  end_reason TEXT                    -- played | no_show | double_no_show | abandoned | declined | expired | cancelled
);
CREATE INDEX wager_challenges_status ON wager_challenges(status, start_at);

CREATE TABLE wager_challenge_players (
  challenge_id TEXT NOT NULL REFERENCES wager_challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  side INTEGER,                      -- partnership: 0/1; cutthroat: NULL (own side = own seat)
  seat INTEGER,                      -- seat at the match table, set when the table is created
  role TEXT NOT NULL,                -- 'challenger' | 'opponent' | 'partner'
  status TEXT NOT NULL DEFAULT 'invited',  -- invited | accepted | declined
  escrowed INTEGER NOT NULL DEFAULT 0,
  checked_in INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX wcp_user ON wager_challenge_players(user_id);

-- Feature flag (ships OFF — Phase 2 flips it) + tuning knobs.
INSERT INTO cred_flags (key, value) VALUES
  ('wager_challenges_enabled', '0'),
  ('wager_horizon_days', '7'),
  ('wager_max_concurrent', '3');
