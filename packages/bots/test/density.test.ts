/**
 * Speech density (2026-10-22): per-stop talk profiles, the trickPop
 * trigger, silent-seat exclusion, and banter's third line. The load-bearing
 * guarantee is at the top: a table WITHOUT a profile runs the standard
 * profile, which is today's tuning bit-for-bit — regular (server/online)
 * talk cannot drift.
 */
import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES, STORY_STOPS, STOP_DENSITY_CLASS, TALK, TALK_PROFILES, botTalk, collectionBanter,
  newTalkState, personaForName, profileOf, type TalkTable,
} from '../src';
import { makeRules, newGame, type GameState, type HandRecord, type SideHandResult } from '@spades/rules';

const rng32 = (seed = 1) => { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; }; };
const nameFor = (p: string) => BOT_NAMES.find((n) => personaForName(n) === p)!;
const table = (names: string[], profile?: TalkTable['profile']): TalkTable => ({
  seats: names.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['Us', 'Them'],
  ...(profile ? { profile } : {}),
});
const zero = () => 0;

describe('density profiles', () => {
  it('standard is today’s tuning, bit-for-bit', () => {
    const s = TALK_PROFILES.standard;
    expect(s.globalGapMs).toBe(TALK.globalGapMs);
    expect(s.seatGapMs).toBe(TALK.seatGapMs);
    expect(s.bigGapMs).toBe(TALK.bigGapMs);
    expect(s.chanceScale).toBe(1);
    expect(s.prePlay).toBe(TALK.chance.prePlay);
    expect(s.trickPop).toBe(0); // the new trigger is dormant without a profile
    expect(s.answerP).toBe(0);
    expect(s.maxChain).toBe(0);
  });

  it('a table without a profile resolves to standard; every stop has a class', () => {
    expect(profileOf(table(['You', 'A', 'B', 'C']))).toBe(TALK_PROFILES.standard);
    for (const stop of STORY_STOPS) expect(STOP_DENSITY_CLASS[stop.id], stop.id).toBeTruthy();
    expect(STOP_DENSITY_CLASS['rec-center']).toBe('loud');
    expect(STOP_DENSITY_CLASS['cookout']).toBe('loud');
    expect(STOP_DENSITY_CLASS['porch']).toBe('lively');
    expect(STOP_DENSITY_CLASS['church-basement']).toBe('slow');
    expect(STOP_DENSITY_CLASS['rooftop']).toBe('slow');
    expect(STOP_DENSITY_CLASS['king']).toBe('climax');
  });

  it('the slow stops keep their air: gaps ~2× the loud stops, chatter dials lower', () => {
    expect(TALK_PROFILES.slow.globalGapMs).toBeGreaterThan(TALK_PROFILES.loud.globalGapMs * 2);
    expect(TALK_PROFILES.slow.chanceScale).toBeLessThan(TALK_PROFILES.loud.chanceScale);
    expect(TALK_PROFILES.slow.murmurMs).toBeGreaterThan(TALK_PROFILES.loud.murmurMs);
    expect(TALK_PROFILES.slow.maxChain).toBe(1); // one reply, no comeback
    expect(TALK_PROFILES.tense.maxChain).toBe(1);
    expect(TALK_PROFILES.cold.maxChain).toBe(1);
    // the King's second gear tightens every dial
    expect(TALK_PROFILES.climaxLate.globalGapMs).toBeLessThan(TALK_PROFILES.climax.globalGapMs);
    expect(TALK_PROFILES.climaxLate.trickPop).toBeGreaterThan(TALK_PROFILES.climax.trickPop);
    expect(TALK_PROFILES.climaxLate.answerP).toBe(0.55);
  });

  it('no-profile and explicit-standard tables speak identically (regular tables unchanged)', () => {
    const names = ['You', nameFor('hype'), nameFor('mama'), nameFor('og')];
    const kinds = ['cut', 'joker', 'made', 'setThem', 'duck', 'slam', 'bigBid', 'streak'] as const;
    const run = (t: TalkTable) => {
      const st = newTalkState();
      const rnd = rng32(99);
      const out: (string | null)[] = [];
      let now = 10_000;
      for (let i = 0; i < 40; i++) {
        now += 4_000;
        const l = botTalk(st, t, { kind: kinds[i % kinds.length], seat: 1 + (i % 3), side: i % 2 }, now, rnd);
        out.push(l ? `${l.seat}:${l.text}` : null);
      }
      return out;
    };
    expect(run(table(names))).toEqual(run(table(names, 'standard')));
  });

  it('a profiled table talks more often than standard over the same event stream', () => {
    const names = ['You', nameFor('hype'), nameFor('mama'), nameFor('og')];
    const count = (profile?: TalkTable['profile']) => {
      const st = newTalkState();
      const rnd = rng32(7);
      let n = 0;
      let now = 10_000;
      for (let i = 0; i < 120; i++) {
        now += 2_000;
        if (botTalk(st, table(names, profile), { kind: 'cut', seat: 1, side: 1 }, now, rnd)) n++;
      }
      return n;
    };
    expect(count('loud')).toBeGreaterThan(count(undefined));
  });
});

describe('trickPop: the trick-completion react', () => {
  const names = ['You', nameFor('hype'), nameFor('mama'), nameFor('og')];
  const ev = { kind: 'trickPop' as const, seat: 1, side: 1, them: 2 };

  it('is dormant at standard tables even when the roll always passes', () => {
    const st = newTalkState();
    expect(botTalk(st, table(names), ev, 10_000, zero)).toBeNull();
    expect(botTalk(st, table(names, 'standard'), ev, 10_000, zero)).toBeNull();
  });

  it('fires under a profile and the loser chirps first (60/40 split)', () => {
    // winner side is 1 (seats 1,3); the only losing BOT seat is 2 (seat 0 is human)
    const line = botTalk(newTalkState(), table(names, 'lively'), ev, 10_000, zero);
    expect(line).not.toBeNull();
    expect(line!.seat).toBe(2);
  });

  it('resolves ONLY to recorded prePlay/roast pool ids — never a trickPop pool', () => {
    const st = newTalkState();
    const t = table(names, 'loud');
    let now = 10_000;
    for (let i = 0; i < 12; i++) {
      now += 6_000;
      const l = botTalk(st, t, ev, now, zero);
      if (!l) continue;
      expect(l.line).toBeTruthy();
      expect(l.line!.split('.')[1]).toMatch(/^(prePlay|roast)$/);
    }
  });

  it('rotates its pool source: prePlay, roast, prePlay, roast…', () => {
    const st = newTalkState();
    const t = table(names, 'lively');
    const kinds: string[] = [];
    let now = 10_000;
    for (let i = 0; i < 4; i++) {
      now += 6_000;
      const l = botTalk(st, t, ev, now, zero);
      expect(l).not.toBeNull();
      kinds.push(l!.line!.split('.')[1]!);
    }
    expect(kinds).toEqual(['prePlay', 'roast', 'prePlay', 'roast']);
  });

  it('never selects a silent-persona seat', () => {
    // seat 1 is the Silent Assassin; the winner side is 0 (human + seat 2),
    // so the losers are seats 1 (silent) and 3 — the pop must come from 3.
    const t = table(['You', nameFor('silent'), nameFor('mama'), nameFor('og')], 'lively');
    const line = botTalk(newTalkState(), t, { kind: 'trickPop', seat: 0, side: 0, them: 1 }, 10_000, zero);
    expect(line).not.toBeNull();
    expect(line!.seat).toBe(3);
  });

  it('respects the profile cooldown geometry (loud pops sooner than slow)', () => {
    const mk = (profile: TalkTable['profile']) => {
      const st = newTalkState();
      const t = table(names, profile);
      expect(botTalk(st, t, ev, 10_000, zero)).not.toBeNull();
      return { st, t };
    };
    const loud = mk('loud');
    expect(botTalk(loud.st, loud.t, ev, 10_000 + TALK_PROFILES.loud.globalGapMs + 1, zero)).not.toBeNull();
    const slow = mk('slow');
    expect(botTalk(slow.st, slow.t, ev, 10_000 + TALK_PROFILES.loud.globalGapMs + 1, zero)).toBeNull();
  });
});

describe('trickPop: murmurs and answers ride the same trigger', () => {
  const names = ['You', nameFor('hype'), nameFor('mama'), nameFor('og')];

  it('a murmur names its seat and fires even at a standard table (the timer is the gate)', () => {
    const line = botTalk(newTalkState(), table(names), { kind: 'trickPop', seat: 3, murmur: true }, 10_000, zero);
    expect(line).not.toBeNull();
    expect(line!.seat).toBe(3);
  });

  it('a murmur never comes from a silent-persona seat', () => {
    const t = table(['You', nameFor('silent'), nameFor('mama'), nameFor('og')], 'slow');
    expect(botTalk(newTalkState(), t, { kind: 'trickPop', seat: 1, murmur: true }, 10_000, zero)).toBeNull();
  });

  it('an answer co-sign draws from the original speaker’s side, never the speaker', () => {
    // origin: seat 1 (side 1); the only other bot on side 1 is seat 3
    const line = botTalk(newTalkState(), table(names, 'lively'), { kind: 'trickPop', side: 1, answerSide: 1, excludeSeat: 1 }, 10_000, zero);
    expect(line).not.toBeNull();
    expect(line!.seat).toBe(3);
  });
});

// ---- banter's third line (fabricated hand records, same shape as talk-overhaul) ----
const sideRes = (o: Partial<SideHandResult> & { side: number }): SideHandResult => ({
  seats: o.side === 0 ? [0, 2] : [1, 3], contract: 0, contractTricks: 0, tricks: 0, contractMade: null,
  contractPoints: 0, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0,
  points: 0, totalScore: 0, totalBags: 0, ...o,
});
const handRec = (sides: SideHandResult[]): HandRecord => ({ handNo: 1, dealer: 0, bids: [3, 4, 2, 3], tricksWon: [3, 4, 3, 3], sides });
const afterWith = (hands: HandRecord[], scores: number[]): GameState => {
  const st = newGame(makeRules('joker'), 'density-banter');
  st.history = hands; st.scores = scores; st.bags = [0, 0]; st.result = null;
  return st;
};

describe('collectionBanter maxLines', () => {
  const richHand = () => afterWith([handRec([
    sideRes({ side: 0, contract: 5, contractMade: false, tricks: 3, points: -50 }),
    sideRes({ side: 1, contract: 10, contractMade: true, tricks: 10, points: 200 }),
  ])], [100, 300]);
  const banterTable = () => table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);

  it('defaults to two lines (regular tables unchanged)', () => {
    const lines = collectionBanter(newTalkState(), banterTable(), richHand(), 1_000, rng32(7));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.line?.split('.')[1])).toEqual(['setThem', 'gotSet']);
  });

  it('maxLines 3 takes the next unused context slot (wheels, after setThem + gotSet)', () => {
    const lines = collectionBanter(newTalkState(), banterTable(), richHand(), 1_000, rng32(7), 3);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.line?.split('.')[1])).toEqual(['setThem', 'gotSet', 'wheels']);
    // three distinct speakers — banter never doubles a seat
    expect(new Set(lines.map((l) => l.seat)).size).toBe(3);
  });
});
