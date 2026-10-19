/** Street Cred Phase 3b: coin economy — ledger, flags, welcome, daily login, stakes, caps. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { balance, move, grantWelcome, dailyLogin, stakeCapCheck, coinsEnabled, flag, ledger } from '../src/cred/coins';
import { STAKE_TABLES, tableById, canEnter, escrow, settleTable, voidGame, leaverForfeit } from '../src/cred/stakes';

let db: D1Database;
const NOW = 1_800_000_000_000; // 2027-01-15T00:00:00Z (UTC)
const DAY = 86_400_000;

beforeEach(async () => {
  db = await makeD1();
});

describe('flags', () => {
  it('seeds the tuning flags', async () => {
    expect(await flag(db, 'coins_enabled', '0')).toBe('1');
    expect(await flag(db, 'stake_tables_enabled', '0')).toBe('1');
    expect(await flag(db, 'earn_multiplier', '0')).toBe('1');
    expect(await flag(db, 'daily_stake_cap', '0')).toBe('5000');
    expect(await coinsEnabled(db)).toBe(true);
  });
  it('disabling coins blocks moves', async () => {
    await db.prepare("UPDATE cred_flags SET value = '0' WHERE key = 'coins_enabled'").run();
    expect(await coinsEnabled(db)).toBe(false);
    expect(await move(db, 'u', 100, 'welcome', null, NOW)).toBe(false);
    expect(await balance(db, 'u')).toBe(0);
  });
});

describe('ledger + balance', () => {
  it('credits and debits move the balance', async () => {
    expect(await move(db, 'u', 500, 'welcome', null, NOW)).toBe(true);
    expect(await move(db, 'u', -200, 'stake_escrow', 'g1', NOW)).toBe(true);
    expect(await balance(db, 'u')).toBe(300);
    const rows = await ledger(db, 'u', 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ delta: -200, reason: 'stake_escrow', refId: 'g1' });
  });
  it('a debit that would go negative is refused with no row written', async () => {
    await move(db, 'u', 100, 'welcome', null, NOW);
    expect(await move(db, 'u', -150, 'stake_escrow', 'g1', NOW)).toBe(false);
    expect(await balance(db, 'u')).toBe(100);
    expect(await ledger(db, 'u', 10)).toHaveLength(1);
  });
  it('zero moves are no-ops', async () => {
    expect(await move(db, 'u', 0, 'welcome', null, NOW)).toBe(true);
    expect(await ledger(db, 'u', 10)).toHaveLength(0);
  });
});

describe('welcome grant', () => {
  it('grants 1000 once, idempotent', async () => {
    expect(await grantWelcome(db, 'u', NOW)).toBe(true);
    expect(await balance(db, 'u')).toBe(1000);
    expect(await grantWelcome(db, 'u', NOW + 999)).toBe(false);
    expect(await balance(db, 'u')).toBe(1000);
  });
});

describe('daily login', () => {
  it('pays 100 day one, +25 per streak day, caps at 200', async () => {
    const d1 = await dailyLogin(db, 'u', NOW);
    expect(d1).toMatchObject({ granted: true, amount: 100, streak: 1 });
    const d2 = await dailyLogin(db, 'u', NOW + DAY);
    expect(d2).toMatchObject({ granted: true, amount: 125, streak: 2 });
    // streak keeps climbing; amount caps at 200
    let last = d2;
    for (let i = 3; i <= 8; i++) last = await dailyLogin(db, 'u', NOW + (i - 1) * DAY);
    expect(last.amount).toBe(200);
    expect(last.streak).toBe(8);
  });
  it('is idempotent within a UTC day and resets the streak after a gap', async () => {
    await dailyLogin(db, 'u', NOW);
    const again = await dailyLogin(db, 'u', NOW + 3600_000);
    expect(again.granted).toBe(false);
    expect(await balance(db, 'u')).toBe(100); // only one grant
    const afterGap = await dailyLogin(db, 'u', NOW + 3 * DAY);
    expect(afterGap).toMatchObject({ granted: true, amount: 100, streak: 1 });
  });
});

describe('stake tables', () => {
  it('defines the four approved tables', () => {
    expect(STAKE_TABLES.map((t) => [t.id, t.buyIn])).toEqual([
      ['casual', 100], ['competitive', 250], ['high-roller', 1000], ['elite', 5000],
    ]);
    expect(tableById('elite')?.minDivision).toBe('avenue');
    expect(tableById('high-roller')?.minGames).toBe(20);
  });
  it('casual is open to everyone with funds; higher tables gate on games/division/funds', async () => {
    await move(db, 'u', 10_000, 'welcome', null, NOW);
    expect((await canEnter(db, 'u', 'casual', NOW)).ok).toBe(true);
    const comp = await canEnter(db, 'u', 'competitive', NOW);
    expect(comp.ok).toBe(false);
    expect(comp.reason).toMatch(/10 rated games/);
    await move(db, 'poor', 50, 'welcome', null, NOW);
    const broke = await canEnter(db, 'poor', 'casual', NOW);
    expect(broke.ok).toBe(false);
    expect(broke.reason).toMatch(/Not enough coins/);
  });
  it('escrow debits the buy-in; void refunds it', async () => {
    await move(db, 'u', 1000, 'welcome', null, NOW);
    expect(await escrow(db, 'u', 'casual', 'g1', NOW)).toBe(true);
    expect(await balance(db, 'u')).toBe(900);
    await voidGame(db, { gameId: 'g1', seats: ['u'], buyIn: 100, now: NOW });
    expect(await balance(db, 'u')).toBe(1000);
  });
  it('escrow fails without funds', async () => {
    expect(await escrow(db, 'u', 'casual', 'g1', NOW)).toBe(false);
  });
  it('settle splits the pot, floor division with remainder to the first winner', async () => {
    // 4 seats × 100 = 400 pot; 3 winners → 134/133/133
    await settleTable(db, { gameId: 'g1', seats: ['a', 'b', 'c', 'd'], winners: ['a', 'b', 'c'], buyIn: 100, now: NOW });
    expect(await balance(db, 'a')).toBe(134);
    expect(await balance(db, 'b')).toBe(133);
    expect(await balance(db, 'c')).toBe(133);
    expect(await balance(db, 'd')).toBe(0);
  });
  it('leaver forfeits the buy-in split among remainers', async () => {
    await leaverForfeit(db, { gameId: 'g1', leaver: 'x', remainers: ['a', 'b', 'c'], buyIn: 100, now: NOW });
    expect(await balance(db, 'a')).toBe(34); // 33 + 1 remainder
    expect(await balance(db, 'b')).toBe(33);
    expect(await balance(db, 'c')).toBe(33);
  });
});

describe('daily stake cap', () => {
  it('winnings past the cap are forfeited', async () => {
    await db.prepare("UPDATE cred_flags SET value = '300' WHERE key = 'daily_stake_cap'").run();
    expect(await stakeCapCheck(db, 'u', 200, NOW)).toBe(true);
    expect(await stakeCapCheck(db, 'u', 400, NOW)).toBe(false);
    // 'a' already won 200 today; another 200 win would pass the 300 cap → forfeited
    await settleTable(db, { gameId: 'g0', seats: ['a', 'x'], winners: ['a'], buyIn: 100, now: NOW });
    expect(await balance(db, 'a')).toBe(200);
    await settleTable(db, { gameId: 'g1', seats: ['a', 'b'], winners: ['a', 'b'], buyIn: 200, now: NOW });
    expect(await balance(db, 'a')).toBe(200); // forfeited, still 200
    expect(await balance(db, 'b')).toBe(200); // under cap, paid
  });
});
