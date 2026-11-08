/**
 * Online trick pacing — the SEPARATION trim (owner, 2026-11-08: "Trim plain
 * tricks only — nukes keep their full pause"). The offline trim cut its
 * plain-branch hold by 350 while its nuke branch kept the untrimmed base;
 * online, leadIn() composes BOTH branches on the one trickPauseMs, so the
 * 350 comes off the plain composition only, inside leadIn:
 *   plain trick  → 1300 − 350 = 950 base (+ the unchanged seeded pace draw)
 *   nuked trick  → 1300 + NUKE_ALLOWANCE_MS[intensity], byte-identical
 *                  (full 5300 / classic 4800 / off 2500)
 * DEFAULT_TIMING.trickPauseMs itself stays 1300 — the trim lives in the
 * composition, which is exactly what keeps the nuke base intact.
 *
 * leadIn is private; its observable effect is the next bot's due time
 * (turnStartedAt + leadIn + botPaceDelayMs draw), so these pins drive a
 * room to just-after-a-trick (the timer-presets synthetic-state pattern)
 * and read botDueAt back, netting out the exact draw the room schedules.
 */
import { describe, expect, it } from 'vitest';
import { botPaceDelayMs, makeRules, type GameState, type Trick } from '@spades/rules';
import { DEFAULT_TIMING } from '../src/room';
import { FakeEnv } from './harness';

const PLAIN_TRICK: Trick = {
  leader: 0,
  plays: [
    { seat: 0, card: 'AS' }, { seat: 1, card: 'KS' }, { seat: 2, card: 'QS' }, { seat: 3, card: 'JS' },
  ],
  winner: 1,
};

/** Both Jokers in one trick (either order) = a nuked trick. */
const NUKED_TRICK: Trick = {
  leader: 0,
  plays: [
    { seat: 0, card: 'LJ' }, { seat: 1, card: 'BJ' }, { seat: 2, card: 'QS' }, { seat: 3, card: 'JS' },
  ],
  winner: 1,
};

function table(): FakeEnv {
  const env = new FakeEnv(); // DEFAULT_TIMING: botMs 750, trickPauseMs 1300
  env.join('a', 'Meech');
  env.send('a', { t: 'sit', seat: 0 });
  env.send('a', { t: 'addBot', seat: 1 });
  env.send('a', { t: 'addBot', seat: 2 });
  env.send('a', { t: 'addBot', seat: 3 });
  env.send('a', { t: 'config', rules: makeRules('joker', { firstHandBidsItself: false }) });
  env.send('a', { t: 'start' });
  return env;
}

/**
 * Put the room just after `last` completed, with bot seat 1 to lead the next
 * trick, and return the lead-in the room actually scheduled (botDueAt minus
 * the turn start minus the seeded pace draw the room adds on top).
 */
function scheduledLeadIn(env: FakeEnv, last: Trick, intensity: 'full' | 'classic' | 'off'): number {
  const d = env.room.data;
  const g = d.game!;
  d.game = {
    ...g,
    phase: 'playing',
    hands: [['2C', '3C', '4C', '5C'], ['2D', '3D', '4D', '5D'], ['2H', '3H', '4H', '5H'], ['3S', '4S', '5S', '6S']],
    bids: [3, 3, 3, 3],
    tricks: [last], tricksWon: [0, 1, 0, 0], turn: 1,
    trick: { leader: 1, plays: [], winner: null }, spadesBroken: true,
  } as GameState;
  d.nukeIntensity = intensity;
  d.botTalk = false; // no pre-play talk beat on top of the due time
  d.seq = (d.seq ?? 0) + 1;
  d.turnKey = null;
  d.deadline = null;
  d.botDueAt = null;
  d.dropSeat = null;
  d.dropDueAt = null;
  d.turnStartedAt = env.t;
  env.room.tick();
  const ng = env.room.data.game!;
  // the exact draw scheduleBots adds for this turn (room.ts bot branch)
  const draw = botPaceDelayMs({
    seed: ng.seed, handNo: ng.handNo, trickNo: ng.tricks.length, seat: 1,
    position: 0, playerCount: ng.rules.playerCount, kind: 'play',
    baseMs: DEFAULT_TIMING.botMs, jokerDown: false,
  });
  expect(env.room.data.botDueAt).not.toBeNull();
  return env.room.data.botDueAt! - env.t - draw;
}

describe('online trick pacing (separation trim)', () => {
  it('keeps the shared constant at 1300 — the trim lives in the leadIn composition, not the constant', () => {
    expect(DEFAULT_TIMING.trickPauseMs).toBe(1300);
    expect(DEFAULT_TIMING.botMs).toBe(750);
  });

  it('a plain completed trick leads in at 950 (1300 − the 350 trim), pace draw on top', () => {
    expect(scheduledLeadIn(table(), PLAIN_TRICK, 'full')).toBe(950);
  });

  it('a nuked trick keeps its full pause at every intensity: 1300 + allowance, no trim', () => {
    expect(scheduledLeadIn(table(), NUKED_TRICK, 'full')).toBe(5300);
    expect(scheduledLeadIn(table(), NUKED_TRICK, 'classic')).toBe(4800);
    expect(scheduledLeadIn(table(), NUKED_TRICK, 'off')).toBe(2500);
  });
});
