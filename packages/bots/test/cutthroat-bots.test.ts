import { describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { simulateGame } from '../src';

describe('bots in Cutthroat respect the table options', () => {
  for (const pc of [3, 4] as const) {
    it(`${pc} players: min bid 3, Nil off, Blind Nil off`, () => {
      const rules = makeRules('cutthroat', { playerCount: pc, minTeamBid: 3, nil: { allowed: false }, firstHandBidsItself: false });
      for (const seed of ['a', 'b', 'c']) {
        const bids: unknown[] = [];
        simulateGame(rules, `ct-${pc}-${seed}`, { levels: Array(pc).fill('shark'), onAction: (_, a) => { if (a.type === 'bid') bids.push(a.bid); } });
        expect(bids.length).toBeGreaterThan(0);
        for (const b of bids) { expect(typeof b).toBe('number'); expect(b as number).toBeGreaterThanOrEqual(3); }
      }
    });
    it(`${pc} players: Nil and Blind Nil are off, so every bid is a number`, () => {
      const rules = makeRules('cutthroat', { playerCount: pc, nil: { allowed: true }, blindNil: { allowed: true, onlyWhenBehindBy: null } });
      expect(rules.nil.allowed).toBe(false);
      expect(rules.blindNil.allowed).toBe(false);
      const bids: unknown[] = [];
      for (const seed of ['d', 'e', 'f', 'g']) simulateGame(rules, `ctn-${pc}-${seed}`, { levels: Array(pc).fill('shark'), onAction: (_, a) => { if (a.type === 'bid') bids.push(a.bid); } });
      expect(bids.length).toBeGreaterThan(0);
      for (const b of bids) { expect(typeof b).toBe('number'); expect(b as number).toBeGreaterThanOrEqual(1); }
    });
  }
});
