/** Big Bank Take Lil Bank (Phase 1): cred/wager.ts ledger unit tests — escrow/refund/pay-win/forfeit idempotency, the daily-cap fold, the level gate, the concurrency count. */
import { describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { balance, move, todayStakeWinnings } from '../src/cred/coins';

const setFlag = (db: D1Database, key: string, on: boolean) =>
  db.prepare('INSERT INTO cred_flags (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, on ? '1' : '0').run();
import { awardXp } from '../src/cred/xp';
import { xpAtLevel } from '../src/cred/xp';
import {
  WAGER_LADDER, isWagerAmount, wagerEnabled, wagerEscrow, wagerEscrowedCount, wagerForfeit, wagerIsEscrowed,
  wagerLevelOk, wagerPayWin, wagerRefund,
} from '../src/cred/wager';

const NOW = 1_700_000_000_000;
const CID = 'abcdef012345';

async function seed(level = 20, coins = 10_000) {
  const db = await makeD1();
  await setFlag(db, 'coins_enabled', true);
  await awardXp(db, 'u1', xpAtLevel(level), NOW);
  if (coins) await move(db, 'u1', coins, 'admin', null, NOW);
  return db;
}

describe('ladder + flag', () => {
  it('the ladder is 100/250/1000/5000 only', () => {
    expect(WAGER_LADDER).toEqual([100, 250, 1000, 5000]);
    expect(isWagerAmount(100)).toBe(true);
    expect(isWagerAmount(5000)).toBe(true);
    expect(isWagerAmount(150)).toBe(false);
    expect(isWagerAmount(0)).toBe(false);
    expect(isWagerAmount(NaN)).toBe(false);
  });

  it('ships dark: the flag defaults off and turns on explicitly', async () => {
    const db = await makeD1();
    expect(await wagerEnabled(db)).toBe(false);
    await setFlag(db, 'wager_challenges_enabled', true);
    expect(await wagerEnabled(db)).toBe(true);
    await setFlag(db, 'wager_challenges_enabled', false);
    expect(await wagerEnabled(db)).toBe(false);
  });
});

describe('level gate', () => {
  it('level 20 passes, 19 does not (the admin bypass lives in the service gate)', async () => {
    const db = await makeD1();
    await awardXp(db, 'pro', xpAtLevel(20), NOW);
    await awardXp(db, 'almost', xpAtLevel(19), NOW);
    expect(await wagerLevelOk(db, 'pro')).toBe(true);
    expect(await wagerLevelOk(db, 'almost')).toBe(false);
    expect(await wagerLevelOk(db, 'nobody')).toBe(false);
  });
});

describe('escrow / refund', () => {
  it('escrow deducts once; a repeat escrow is a no-op success', async () => {
    const db = await seed();
    expect(await wagerEscrow(db, 'u1', CID, 250, NOW)).toBe(true);
    expect(await balance(db, 'u1')).toBe(9750);
    expect(await wagerEscrow(db, 'u1', CID, 250, NOW)).toBe(true);
    expect(await balance(db, 'u1')).toBe(9750);
    expect(await wagerIsEscrowed(db, 'u1', CID)).toBe(true);
  });

  it('escrow refuses on insufficient balance and writes nothing', async () => {
    const db = await seed(20, 100);
    expect(await wagerEscrow(db, 'u1', CID, 250, NOW)).toBe(false);
    expect(await balance(db, 'u1')).toBe(100);
    expect(await wagerIsEscrowed(db, 'u1', CID)).toBe(false);
  });

  it('escrow refuses a non-ladder amount', async () => {
    const db = await seed();
    expect(await wagerEscrow(db, 'u1', CID, 150, NOW)).toBe(false);
    expect(await balance(db, 'u1')).toBe(10_000);
  });

  it('refund returns the escrow exactly once, and only when escrowed', async () => {
    const db = await seed();
    expect(await wagerRefund(db, 'u1', CID, 1000, NOW)).toBe(false); // never escrowed
    await wagerEscrow(db, 'u1', CID, 1000, NOW);
    expect(await wagerRefund(db, 'u1', CID, 1000, NOW)).toBe(true);
    expect(await balance(db, 'u1')).toBe(10_000);
    expect(await wagerRefund(db, 'u1', CID, 1000, NOW)).toBe(true); // idempotent
    expect(await balance(db, 'u1')).toBe(10_000);
  });
});

describe('pay win (stake-cap folding)', () => {
  it('refunds the escrow and pays the NET win as wager_win', async () => {
    const db = await seed();
    await wagerEscrow(db, 'u1', CID, 100, NOW);
    // winner's gross share of the pot is 200 → +100 refund +100 wager_win
    expect(await wagerPayWin(db, 'u1', CID, 100, 200, NOW)).toEqual({ winPaid: 100, capped: false });
    expect(await balance(db, 'u1')).toBe(10_100);
    expect(await todayStakeWinnings(db, 'u1', NOW)).toBe(100);
    // idempotent: a second identical settle changes nothing
    expect(await wagerPayWin(db, 'u1', CID, 100, 200, NOW)).toEqual({ winPaid: 0, capped: false });
    expect(await balance(db, 'u1')).toBe(10_100);
  });

  it('todayStakeWinnings sums stake_win AND wager_win (cap folding)', async () => {
    const db = await seed();
    await move(db, 'u1', 300, 'stake_win', 't1', NOW);
    await move(db, 'u1', 200, 'wager_win', CID, NOW);
    await move(db, 'u1', 50, 'challenge_reward', null, NOW); // not a stake win
    expect(await todayStakeWinnings(db, 'u1', NOW)).toBe(500);
  });

  it('over the daily cap: the win part is skipped but the escrow refund still lands', async () => {
    const db = await seed();
    await move(db, 'u1', 5000, 'stake_win', 't9', NOW); // cap already full today
    await wagerEscrow(db, 'u1', CID, 100, NOW);
    const before = await balance(db, 'u1');
    expect(await wagerPayWin(db, 'u1', CID, 100, 200, NOW)).toEqual({ winPaid: 0, capped: true });
    expect(await balance(db, 'u1')).toBe(before + 100); // refund only, no win
  });

  it('a win that would cross the cap is skipped whole (settleTable convention), not clamped', async () => {
    const db = await seed();
    await move(db, 'u1', 4950, 'wager_win', 'other', NOW); // 50 of headroom left
    await wagerEscrow(db, 'u1', CID, 100, NOW);
    expect(await wagerPayWin(db, 'u1', CID, 100, 400, NOW)).toEqual({ winPaid: 0, capped: true }); // net win 300 > 50 headroom
    expect(await balance(db, 'u1')).toBe(14_950); // seed 10,000 + 4,950 earlier win; escrow refunded, no new win paid
    expect(await todayStakeWinnings(db, 'u1', NOW)).toBe(4950);
  });
});

describe('forfeit credit', () => {
  it('credits a no-show split once, idempotently, and bypasses the daily win cap', async () => {
    const db = await seed();
    await move(db, 'u1', 5000, 'stake_win', 't9', NOW); // cap full — forfeits still pay
    const before = await balance(db, 'u1');
    expect(await wagerForfeit(db, 'u1', CID, 50, NOW)).toBe(true);
    expect(await balance(db, 'u1')).toBe(before + 50);
    expect(await wagerForfeit(db, 'u1', CID, 50, NOW)).toBe(true); // idempotent
    expect(await balance(db, 'u1')).toBe(before + 50);
    expect(await todayStakeWinnings(db, 'u1', NOW)).toBe(5000); // forfeits don't count as stake winnings
    expect(await wagerForfeit(db, 'u1', 'othercid0000', 0, NOW)).toBe(true); // zero split is a no-op
  });
});

describe('concurrency count', () => {
  it('counts escrowed players in live-ish challenges only', async () => {
    const db = await makeD1();
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind('u1', 'U1', 'u1', NOW).run();
    const rows: [string, string, number][] = [['c1', 'pending', 1], ['c2', 'live', 1], ['c3', 'settled', 1], ['c4', 'scheduled', 0]];
    for (const [cid, status] of rows) {
      await db.prepare('INSERT INTO wager_challenges (id, challenger_id, format, mode, rules, wager, start_at, checkin_opens_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(cid, 'u1', 'partnership', 'joker', '{}', 100, NOW + 1, NOW, status, NOW).run();
    }
    for (const [cid, , esc] of rows) {
      await db.prepare('INSERT INTO wager_challenge_players (challenge_id, user_id, side, role, status, escrowed) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(cid, 'u1', 0, 'challenger', 'accepted', esc).run();
    }
    expect(await wagerEscrowedCount(db, 'u1')).toBe(2); // pending + live, not settled, not un-escrowed
    expect(await wagerEscrowedCount(db, 'someone-else')).toBe(0);
  });
});
