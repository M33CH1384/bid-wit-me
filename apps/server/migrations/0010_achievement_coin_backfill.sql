-- Backfill achievement coin rewards for already-unlocked achievements.
-- The coin rewards were added to achievements.ts on 2026-10-19, but the
-- checkAchievements() code only credits coins for NEW unlocks. This backfills
-- coins for achievements unlocked before the coin rewards existed.
-- Idempotent: only processes where no ledger entry exists for that (user, achievement).
-- Runs in a transaction: balance update first, then ledger insert. If either fails, both roll back.
-- Demetrius 2026-10-19.
-- v2: Rewritten without TEMP table (D1 rejects CREATE TEMP TABLE with SQLITE_AUTH).

-- Step 1: Update balances for missing achievement credits
-- (NOT EXISTS ensures we only credit achievements without a ledger entry)
INSERT INTO coin_balances (user_id, balance, updated_at)
WITH ach_coins(id, coins) AS (
  VALUES
    ('first-dub', 50),
    ('ten-toes', 75),
    ('dealmaker', 125),
    ('lone-wolf', 125),
    ('century', 250),
    ('clean-nil', 75),
    ('blind-faith', 150),
    ('no-baggage', 75),
    ('wheels-up', 100),
    ('boston', 150),
    ('run-it-up', 100),
    ('sharpshooter', 100),
    ('comeback-kid', 125),
    ('undertaker', 100),
    ('untouchable', 200),
    ('world-traveler', 75),
    ('iron-man', 250)
)
SELECT ua.user_id, SUM(ac.coins), strftime('%s', 'now') * 1000
FROM user_achievements ua
JOIN ach_coins ac ON ac.id = ua.achievement_id
WHERE NOT EXISTS (
  SELECT 1 FROM coin_ledger cl
  WHERE cl.user_id = ua.user_id
    AND cl.reason = 'achievement'
    AND cl.ref_id = ua.achievement_id
)
GROUP BY ua.user_id
ON CONFLICT (user_id) DO UPDATE SET
  balance = coin_balances.balance + excluded.balance,
  updated_at = excluded.updated_at;

-- Step 2: Insert ledger entries for the backfilled credits
-- (Same NOT EXISTS guard; if run twice, no rows match so nothing inserts)
INSERT INTO coin_ledger (user_id, delta, reason, ref_id, created_at)
WITH ach_coins(id, coins) AS (
  VALUES
    ('first-dub', 50),
    ('ten-toes', 75),
    ('dealmaker', 125),
    ('lone-wolf', 125),
    ('century', 250),
    ('clean-nil', 75),
    ('blind-faith', 150),
    ('no-baggage', 75),
    ('wheels-up', 100),
    ('boston', 150),
    ('run-it-up', 100),
    ('sharpshooter', 100),
    ('comeback-kid', 125),
    ('undertaker', 100),
    ('untouchable', 200),
    ('world-traveler', 75),
    ('iron-man', 250)
)
SELECT ua.user_id, ac.coins, 'achievement', ua.achievement_id, ua.unlocked_at
FROM user_achievements ua
JOIN ach_coins ac ON ac.id = ua.achievement_id
WHERE NOT EXISTS (
  SELECT 1 FROM coin_ledger cl
  WHERE cl.user_id = ua.user_id
    AND cl.reason = 'achievement'
    AND cl.ref_id = ua.achievement_id
);
-- Note: 'after-dark' has 0 coins, excluded.
