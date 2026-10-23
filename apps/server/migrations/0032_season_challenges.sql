-- Seasonal challenges (owner, 2026-10-23): the season-long challenge
-- track that carries the Big Joker's seasonal upkeep. Six of these eight
-- defs are dealt per monthly season (deterministic rotation in
-- apps/server/src/cred/seasonSets.ts, which is the source of truth for
-- the pool — this seed exists so challenge_defs, the defs table the
-- backfill in cred/seasons.ts maintains, carries them too). Progress
-- lives in challenge_progress with period_id = the season id ('YYYY-MM'),
-- claimed through the same /api/challenges/:id/claim route as
-- daily/weekly. No new tables: the upkeep record itself shipped in 0031.
INSERT OR IGNORE INTO challenge_defs (id, cadence, title, metric, target, xp, coins, kind) VALUES
  ('szn-games-40',  'season', 'Play 40 games this season',            'games',       40, 500, 400, NULL),
  ('szn-win-20',    'season', 'Win 20 games this season',             'wins',        20, 650, 500, NULL),
  ('szn-team-12',   'season', 'Win 12 partnership games this season', 'wins',        12, 550, 425, 'team'),
  ('szn-cut-6',     'season', 'Win 6 cutthroat games this season',    'wins',         6, 600, 475, 'cutthroat'),
  ('szn-books-300', 'season', 'Take 300 books this season',           'books',      300, 450, 325, NULL),
  ('szn-nil-4',     'season', 'Make 4 nils this season',              'nils_made',    4, 800, 650, NULL),
  ('szn-shots-12',  'season', 'Give 12 shots this season',            'shots_given', 12, 700, 550, NULL),
  ('szn-games-70',  'season', 'Play 70 games this season',            'games',       70, 800, 650, NULL);
