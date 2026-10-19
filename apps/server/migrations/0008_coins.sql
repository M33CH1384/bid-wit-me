-- Release 12: BWM Street Cred (Phase 3b) — server-authoritative coin economy.
-- Every coin movement is a ledger row; coin_balances is a cached write-through, the ledger is truth.
-- Integer amounts only. No real-money purchase/redemption, no table fees, no pay-to-win (beta rule).

CREATE TABLE coin_ledger(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,                  -- positive = credit, negative = debit
  reason TEXT NOT NULL,                    -- welcome|daily_login|challenge|achievement|level_up|stake_escrow|stake_win|stake_refund|stake_forfeit|admin
  ref_id TEXT,                             -- game id / challenge id / whatever the reason points at
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_coin_ledger_user ON coin_ledger(user_id, created_at);

CREATE TABLE coin_balances(
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- feature flags / tuning knobs (no deploy needed to adjust earn rates or caps)
CREATE TABLE cred_flags(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO cred_flags (key, value) VALUES
  ('coins_enabled', '1'),
  ('stake_tables_enabled', '1'),
  ('earn_multiplier', '1'),
  ('daily_stake_cap', '5000');

-- daily login tracking (UTC day): idempotent grant + streak
CREATE TABLE daily_logins(
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                        -- 'YYYY-MM-DD' (UTC)
  streak INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, day)
);
