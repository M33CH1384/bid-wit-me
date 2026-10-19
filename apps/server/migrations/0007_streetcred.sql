-- Release 11: BWM Street Cred (Phase 3a) — divisions/seasons, XP/levels, challenges, achievements, unlocks.
-- Coins are Phase 3b: challenge/achievement defs carry coin VALUES, but no ledger exists yet.

CREATE TABLE seasons(
  id TEXT PRIMARY KEY,                       -- 'YYYY-MM' (UTC)
  name TEXT NOT NULL,                        -- 'Season N', N counts from 2026-10 = Season 1
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE season_ratings(
  user_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- 'team' | 'cutthroat'
  rating INTEGER NOT NULL DEFAULT 1000,
  division TEXT NOT NULL DEFAULT 'block',    -- stoop|corner|block|avenue|boulevard|legend
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  peak_rating INTEGER NOT NULL DEFAULT 1000,
  PRIMARY KEY(user_id, season_id, kind)
);
CREATE INDEX sr_season ON season_ratings (season_id, kind, division, rating DESC);

CREATE TABLE xp_state(
  user_id TEXT PRIMARY KEY,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE challenge_defs(
  id TEXT PRIMARY KEY,
  cadence TEXT NOT NULL,                     -- 'daily' | 'weekly'
  title TEXT NOT NULL,
  metric TEXT NOT NULL,                      -- wins|games|books|nils_made|shots_given|streak
  target INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,          -- value only until the 3b coin ledger exists
  kind TEXT,                                 -- 'team'|'cutthroat' filter, NULL = any
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE challenge_progress(
  user_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,                    -- 'YYYY-MM-DD' (daily) | 'YYYY-Www' (weekly), UTC
  progress INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  PRIMARY KEY(user_id, challenge_id, period_id)
);
CREATE INDEX cp_user_period ON challenge_progress (user_id, period_id);

CREATE TABLE achievement_defs(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hint TEXT NOT NULL,
  xp INTEGER NOT NULL,
  condition_json TEXT NOT NULL               -- {"check":"<key>", ...params}
);

CREATE TABLE user_achievements(
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, achievement_id)
);

CREATE TABLE unlocks(
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,                     -- e.g. 'after-dark' (venue)
  source TEXT NOT NULL,                      -- 'achievement:after-dark' | 'level:10' | ...
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, item_id)
);

CREATE TABLE equipped(
  user_id TEXT NOT NULL,
  slot TEXT NOT NULL,                        -- 'venue' | 'card_back' | 'avatar_frame' | 'title'
  item_id TEXT,
  PRIMARY KEY(user_id, slot)
);

-- idempotency: one cred pass per recorded game
CREATE TABLE cred_processed(
  game_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

-- incremental lifetime counters (lazy-backfilled from game_players on first touch)
CREATE TABLE cred_totals(
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- 'team' | 'cutthroat'
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  shots_given INTEGER NOT NULL DEFAULT 0,
  cur_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, kind)
);

-- per-venue play history (world-traveler / after-dark achievements)
CREATE TABLE cred_venue_stats(
  user_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, venue)
);

-- ---- seed: daily challenges ----
INSERT INTO challenge_defs (id, cadence, title, metric, target, xp, coins, kind) VALUES
  ('win-2',    'daily', 'Win 2 games',      'wins',       2,  75,  50, NULL),
  ('books-15', 'daily', 'Take 15 books',    'books',     15,  50,  25, NULL),
  ('games-4',  'daily', 'Play 4 games',     'games',      4,  50,  25, NULL),
  ('nil-1',    'daily', 'Make a nil',       'nils_made',  1, 100,  75, NULL),
  ('shots-3',  'daily', 'Give 3 shots',     'shots_given',3,  75,  50, NULL),
  ('streak-3', 'daily', 'Win 3 in a row',   'streak',     3, 100,  75, NULL);

-- ---- seed: weekly challenges ----
INSERT INTO challenge_defs (id, cadence, title, metric, target, xp, coins, kind) VALUES
  ('win-5',    'weekly', 'Win 5 partnership games', 'wins',  5, 200, 150, 'team'),
  ('cut-2',    'weekly', 'Win 2 cutthroat games',   'wins',  2, 250, 200, 'cutthroat'),
  ('books-60', 'weekly', 'Take 60 books',           'books', 60, 150, 100, NULL),
  ('games-20', 'weekly', 'Play 20 games',           'games', 20, 150, 100, NULL);

-- ---- seed: achievements ----
INSERT INTO achievement_defs (id, title, hint, xp, condition_json) VALUES
  ('first-dub',    'First Dub',     'Win your first game',                          100, '{"check":"wins","n":1}'),
  ('ten-toes',     'Ten Toes Down', 'Win 10 games',                                 150, '{"check":"wins","n":10}'),
  ('dealmaker',    'Dealmaker',     'Win 25 partnership games',                     250, '{"check":"team_wins","n":25}'),
  ('lone-wolf',    'Lone Wolf',     'Win 10 cutthroat games',                       250, '{"check":"cutthroat_wins","n":10}'),
  ('century',      'Century Club',  'Win 100 games',                                500, '{"check":"wins","n":100}'),
  ('clean-nil',    'Clean Nil',     'Bid nil and make it',                          150, '{"check":"game_nil_made"}'),
  ('blind-faith',  'Blind Faith',   'Bid blind nil and make it',                    300, '{"check":"game_blind_nil_made"}'),
  ('no-baggage',   'No Baggage',    'Win a game with zero bags',                    150, '{"check":"game_win_no_bags"}'),
  ('wheels-up',    'Wheels Up',     'Call wheels and take the game',                200, '{"check":"game_wheels_win"}'),
  ('boston',       'Boston Party',  'Take 13+ books in a single hand',              300, '{"check":"game_books_hand","n":13}'),
  ('run-it-up',    'Run It Up',     'Claim "Run it!" and clear the table',          200, '{"check":"game_run_it"}'),
  ('sharpshooter', 'Sharpshooter',  'Give 25 shots across your career',             200, '{"check":"shots_given","n":25}'),
  ('comeback-kid', 'Comeback Kid',  'Win after trailing by 100+ points',            250, '{"check":"game_comeback","n":100}'),
  ('undertaker',   'Undertaker',    'Outlast an eliminated rival in cutthroat',     200, '{"check":"game_foe_eliminated"}'),
  ('untouchable',  'Untouchable',   'Reach a 10-game win streak',                   400, '{"check":"best_streak","n":10}'),
  ('world-traveler','World Traveler','Play in 5 different venues',                  150, '{"check":"venues","n":5}'),
  ('iron-man',     'Iron Man',      'Play 500 games',                               500, '{"check":"games","n":500}'),
  ('after-dark',   'After Dark',    'Win 25 night-venue games and reach the Block division', 0, '{"check":"after_dark","night_wins":25,"division":"block","unlock":"after-dark"}');
