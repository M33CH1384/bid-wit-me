import { describe, expect, it } from 'vitest';
import { makeRules, type GameState } from '@spades/rules';
import { FakeEnv } from './harness';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

/** Play is the longer clock. These are the host presets, plus the default Normal table. */
const PRESETS = [
  { name: 'Relaxed', bid: 30, play: 45 },
  { name: 'Normal', bid: 30, play: 30 },
  { name: 'Fast', bid: 10, play: 15 },
] as const;

function pin(env: FakeEnv, kind: 'bid' | 'play'): void {
  const g = env.room.data.game!;
  env.room.data.game = {
    ...g,
    phase: kind === 'bid' ? 'bidding' : 'playing',
    hands: [['AS', 'KS'], ['3C', '4C'], ['5D', '6D'], ['7H', '8H']],
    bids: kind === 'bid' ? [null, null, null, null] : [1, 1, 1, 1],
    tricks: [], tricksWon: [0, 0, 0, 0], turn: 0,
    trick: { leader: 0, plays: [], winner: null }, spadesBroken: true,
  } as GameState;
  env.room.data.seq = (env.room.data.seq ?? 0) + 1;
  env.room.data.turnKey = null;
  env.room.data.deadline = null;
  env.room.tick();
}

describe('table timer presets', () => {
  it('the default table is Normal, and play is longer than the bid', () => {
    expect(makeRules('joker').turnTimerSec).toEqual({ bid: 30, play: 30 });
    for (const p of PRESETS) expect(p.play).toBeGreaterThan(p.bid);
  });

  it('a bid turn uses the bid seconds and a play turn uses the play seconds', () => {
    for (const p of PRESETS) {
      const env = new FakeEnv(undefined, FAST);
      env.join('a', 'Meech');
      env.send('a', { t: 'sit', seat: 0 });
      env.send('a', { t: 'addBot', seat: 1 });
      env.send('a', { t: 'addBot', seat: 2 });
      env.send('a', { t: 'addBot', seat: 3 });
      env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: p.bid, play: p.play }, firstHandBidsItself: false }) });
      env.send('a', { t: 'start' });
      pin(env, 'bid');
      expect(env.room.data.deadline! - env.t, `${p.name} bid`).toBe(p.bid * 1000);
      expect(env.last('a', 'state')!.room.turnSec, `${p.name} bid length`).toBe(p.bid);
      pin(env, 'play');
      expect(env.room.data.deadline! - env.t, `${p.name} play`).toBe(p.play * 1000);
      expect(env.last('a', 'state')!.room.turnSec, `${p.name} play length`).toBe(p.play);
    }
  });
});
