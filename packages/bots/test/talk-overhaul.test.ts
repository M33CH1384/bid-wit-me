/**
 * Commentary overhaul (2026-10-21): the anti-repetition rebuild.
 *  - rotation: a persona's pool must fully cycle before any line repeats (the old pick()
 *    reset its memory inside the tiny fact/Ace-preferred slice, so 1–2 "preferred" lines
 *    looped all game in a persistent context);
 *  - context: collectionBanter routes the hand that just ended to its own banks
 *    (set / made / nil / bags / Boston / match point), winners and losers both speak;
 *  - personas: pool floors per persona, signature lines, and the score-gap mood
 *    (gapBias) that makes chattiness itself part of the personality;
 *  - TTS safety: every new line must survive the talkPrefs speech cleanup with words left.
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type HandRecord, type SideHandResult, makeRules, newGame } from '@spades/rules';
import {
  BOT_NAMES, COMMON, LINE_META, PERSONAS, applyPronunciation, banterContextFor, botTalk, collectionBanter, gapBiasOf, lineById,
  maskMild, momentsFor, newTalkState, personaForName, poolFor,
  type PersonaId, type TalkKind, type TalkTable,
} from '../src';
import { POOLS2 } from '../src/pools2';

const nameFor = (p: PersonaId) => BOT_NAMES.find((n) => personaForName(n) === p)!;
const table = (names: string[]): TalkTable => ({
  seats: names.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['Us', 'Them'], intensity: 'cookout', jokers: true,
});
/** deterministic rng (mulberry32) */
const rng32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};
const distinctFor = (kind: TalkKind) => new Set([...(COMMON[kind] ?? []), ...Object.values(PERSONAS).flatMap((p) => p.lines[kind] ?? [])]);

describe('pool sizes: the starved banks are fed', () => {
  it('distinct-line floors per kind (before the overhaul: made 5, wheels 4, streak 3, onNotice 3, shotOut 3, gotNuked 4)', () => {
    // distinct raws PLACED in each kind's pools across personas (redistribution counts:
    // a persona's own recorded win line now also lives in its wheels pool, etc.)
    const floors: Partial<Record<TalkKind, number>> = {
      made: 45, gotSet: 60, wheels: 55, streak: 55, onNotice: 55, shotOut: 50, gotNuked: 45,
      gotRan: 25, duck: 20, overcut: 60, roastBid: 30, matchPoint: 25, bags: 45, boston: 45,
    };
    for (const [kind, floor] of Object.entries(floors)) expect(distinctFor(kind as TalkKind).size, kind).toBeGreaterThanOrEqual(floor);
  });

  it('every persona (bar the Silent Assassin) can speak the hand-end kinds', () => {
    const floors: Partial<Record<TalkKind, number>> = { made: 3, gotSet: 4, wheels: 3, streak: 3, matchPoint: 4 };
    for (const p of Object.values(PERSONAS)) {
      if (p.id === 'silent') continue;
      for (const [kind, floor] of Object.entries(floors) as [TalkKind, number][]) {
        const n = Math.min(poolFor(p.id, kind, 'cookout', 'f').length, poolFor(p.id, kind, 'cookout', 'm').length);
        expect(n, `${p.id}/${kind}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('existing line ids did not move (recorded clips stay attached)', () => {
    expect(lineById('common.cut.0')).toBe('CUT. sit down.');
    expect(lineById('common.made.0')).toBe('bid made. easy work.');
    expect(lineById('common.nilMade.0')).toBe('nil made. nothing to see here 😌');
    expect(lineById('common.wheels.0')).toBe('WHEELS! 🏎️ we outta here.');
    expect(lineById('common.prePlay.9')).toBe("lemme see what y'all workin with.");
    expect(lineById('professor.runIt.0')).toBe('the remaining tricks are a formality. observe.');
    expect(lineById('mama.prePlay.0')).toBe("mm-hm. mama's thinking.");
    // the matchPoint COMMON bank is appended last, and only holds lines already
    // recorded for every persona (see personas.ts) — index 0 is the heater line
    expect(lineById('common.matchPoint.0')).toBe("we're on a heater 🔥");
  });
});

describe('rotation: no repeat until the pool has cycled', () => {
  it('a full cycle of one persona+kind says every pool line exactly once — fact-preferred lines included', () => {
    const prof = nameFor('professor');
    const t = table(['You', prof, nameFor('mama'), nameFor('og')]);
    const pool = poolFor('professor', 'made', 'cookout', 'f');
    const st = newTalkState();
    const said: string[] = [];
    // the contract holder is the speaker every time: the fact-preferred slice stays "hot" all game,
    // which is exactly the persistent context that used to loop its 1–2 lines
    for (let i = 0; i < pool.length; i++) {
      const l = botTalk(st, t, { kind: 'made', side: 1, seat: 1, bid: 4, bidderSeat: 1, bidderSide: 1, handNo: 2 }, 1_000_000 + i * 10_000, () => 0.1);
      expect(l, `fire ${i}`).not.toBeNull();
      said.push(l!.line!);
    }
    expect(new Set(said).size).toBe(pool.length);
    // and only NOW may a line come back — never back-to-back
    const next = botTalk(st, t, { kind: 'made', side: 1, seat: 1, bid: 4, bidderSeat: 1, bidderSide: 1, handNo: 3 }, 1_000_000 + pool.length * 10_000, () => 0.1); // the comeback lives in a later hand — the per-hand budget has rolled
    expect(next).not.toBeNull();
    expect(next!.line).not.toBe(said[said.length - 1]);
  });
});

describe('persona mood: chattiness follows the score', () => {
  it('gapBias data: frontrunners, sore losers, and steady personas', () => {
    expect(gapBiasOf('hype', 'aheadBig')).toBeGreaterThan(1);
    expect(gapBiasOf('hype', 'behindBig')).toBeLessThan(1);
    expect(gapBiasOf('sorelose', 'behindBig')).toBeGreaterThan(1);
    expect(gapBiasOf('sorelose', 'aheadBig')).toBeLessThan(1);
    expect(gapBiasOf('og', 'aheadBig')).toBe(1);
    expect(gapBiasOf('hype', undefined)).toBe(1);
  });

  it('the Hype Man talks when winning and clams up when buried; the Sore Loser is the reverse', () => {
    const t = table(['You', nameFor('hype'), nameFor('og'), nameFor('sorelose')]);
    const count = (bucket: 'aheadBig' | 'behindBig') => {
      const rnd = rng32(42);
      const tally: Record<number, number> = {};
      for (let i = 0; i < 600; i++) {
        const l = botTalk(newTalkState(), t, { kind: 'made', side: 1, gapBucket: bucket }, 1_000_000, rnd);
        if (l) tally[l.seat] = (tally[l.seat] ?? 0) + 1;
      }
      return tally;
    };
    const ahead = count('aheadBig'); // seat 1 = hype, seat 3 = sorelose, both on side 1
    const behind = count('behindBig');
    expect(ahead[1] ?? 0).toBeGreaterThan((ahead[3] ?? 0) * 2);
    expect(behind[3] ?? 0).toBeGreaterThan((behind[1] ?? 0) * 2);
    expect(ahead[1] ?? 0).toBeGreaterThan((behind[1] ?? 0) * 2);
    expect(behind[3] ?? 0).toBeGreaterThan((ahead[3] ?? 0) * 2);
  });
});

// ---- fabricated hand records for the banter router ----
const sideRes = (o: Partial<SideHandResult> & { side: number }): SideHandResult => ({
  seats: o.side === 0 ? [0, 2] : [1, 3], contract: 0, contractTricks: 0, tricks: 0, contractMade: null,
  contractPoints: 0, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0,
  points: 0, totalScore: 0, totalBags: 0, ...o,
});
const handRec = (sides: SideHandResult[]): HandRecord => ({ handNo: 1, dealer: 0, bids: [3, 4, 2, 3], tricksWon: [3, 4, 3, 3], sides });
const afterWith = (hands: HandRecord[], scores: number[], bags: number[] = [0, 0]): GameState => {
  const st = newGame(makeRules('joker'), 'banter-test');
  st.history = hands; st.scores = scores; st.bags = bags; st.result = null;
  return st;
};
const banterTable = () => table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
const kindsOf = (lines: { line?: string }[]) => lines.map((l) => l.line?.split('.')[1]);

describe('collectionBanter: the hand that just ended picks the bank', () => {
  it('a set: the setters gloat (setThem), the set side copes (gotSet), speakers on the right sides', () => {
    const after = afterWith([handRec([
      sideRes({ side: 0, contract: 5, contractMade: false, tricks: 3, points: -50 }),
      sideRes({ side: 1, contract: 4, contractMade: true, tricks: 10, points: 140 }),
    ])], [100, 300]);
    const lines = collectionBanter(newTalkState(), banterTable(), after, 1_000, rng32(7));
    expect(lines).toHaveLength(2);
    expect(kindsOf(lines)).toEqual(['setThem', 'gotSet']);
    expect([1, 3]).toContain(lines[0]!.seat);
    expect(lines[1]!.seat).toBe(2); // the only bot on the set side
    for (const l of lines) expect(l.text).not.toMatch(/\{[a-z]+\}/);
  });

  it('a made Nil speaks nilMade, from the nil seat when it is a bot', () => {
    const after = afterWith([handRec([
      sideRes({ side: 0, contract: 4, contractMade: true, tricks: 7, points: 60, nils: [{ seat: 2, kind: 'nil', tricks: 0, made: true, points: 100 }] }),
      sideRes({ side: 1, contract: 5, contractMade: true, tricks: 6, points: 40 }),
    ])], [120, 90]);
    const lines = collectionBanter(newTalkState(), banterTable(), after, 1_000, rng32(3));
    expect(kindsOf(lines)).toContain('nilMade');
    expect(lines.find((l) => l.line?.includes('nilMade'))!.seat).toBe(2);
  });

  it('match point: the leading side says so', () => {
    const after = afterWith([handRec([
      sideRes({ side: 0, contract: 4, contractMade: true, tricks: 7, points: 70 }),
      sideRes({ side: 1, contract: 5, contractMade: true, tricks: 6, points: 60 }),
    ])], [430, 200]);
    expect(banterContextFor(after)!.matchPointSides).toEqual([0]);
    const lines = collectionBanter(newTalkState(), banterTable(), after, 1_000, rng32(5));
    expect(kindsOf(lines)[0]).toBe('matchPoint');
    expect(lines[0]!.seat).toBe(2);
  });

  it('bags trouble: 8 running bags draws a bags line from the other side', () => {
    const after = afterWith([handRec([
      sideRes({ side: 0, contract: 4, contractMade: true, tricks: 5, points: 50 }),
      sideRes({ side: 1, contract: 5, contractMade: true, tricks: 8, points: 60 }),
    ])], [200, 210], [8, 0]);
    const lines = collectionBanter(newTalkState(), banterTable(), after, 1_000, rng32(9));
    expect(kindsOf(lines)[0]).toBe('bags');
    expect([1, 3]).toContain(lines[0]!.seat);
  });

  it('a Boston leads the banter', () => {
    const after = afterWith([handRec([
      sideRes({ side: 0, contract: 4, contractMade: true, tricks: 0, points: 40 }),
      sideRes({ side: 1, contract: 5, contractMade: true, tricks: 13, points: 350 }),
    ])], [50, 400]);
    const lines = collectionBanter(newTalkState(), banterTable(), after, 1_000, rng32(11));
    expect(kindsOf(lines)[0]).toBe('boston');
  });

  it('the same hand twice in a game never repeats the set side\u2019s line (shared anti-repeat memory)', () => {
    const mk = () => afterWith([handRec([
      sideRes({ side: 0, contract: 5, contractMade: false, tricks: 3, points: -50 }),
      sideRes({ side: 1, contract: 4, contractMade: true, tricks: 10, points: 140 }),
    ])], [100, 300]);
    const st = newTalkState();
    const t = banterTable();
    const first = collectionBanter(st, t, mk(), 1_000, rng32(13));
    const second = collectionBanter(st, t, mk(), 2_000, rng32(14));
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    const gotSet = (ls: typeof first) => ls.find((l) => l.line?.includes('gotSet'))!.text;
    expect(gotSet(second)).not.toBe(gotSet(first)); // same bot (seat 2), same pool: memory forbids the repeat
    expect(new Set([...first, ...second].map((l) => l.seat)).size).toBeGreaterThanOrEqual(2);
  });
});

describe('moments: match point and bags trouble are real events now', () => {
  const base = () => newGame(makeRules('joker'), 'moments-x');
  it('matchPoint fires for the leading side within 100 of the target, not otherwise', () => {
    const before = base();
    const after = base();
    after.history = [handRec([sideRes({ side: 0, contractMade: true }), sideRes({ side: 1, contractMade: true })])];
    after.scores = [430, 200];
    expect(momentsFor(before, { type: 'nextHand' }, after).some((e) => e.kind === 'matchPoint' && e.side === 0)).toBe(true);
    after.scores = [300, 200];
    expect(momentsFor(before, { type: 'nextHand' }, after).some((e) => e.kind === 'matchPoint')).toBe(false);
  });
  it('bags fires at 7+ running bags even without a penalty that hand', () => {
    const before = base();
    const after = base();
    after.history = [handRec([
      sideRes({ side: 0, contract: 4, contractMade: true, tricks: 6 }),
      sideRes({ side: 1, contract: 5, contractMade: true, tricks: 7 }),
    ])];
    after.scores = [200, 210];
    after.bags = [8, 0];
    expect(momentsFor(before, { type: 'nextHand' }, after).some((e) => e.kind === 'bags' && e.side === 1)).toBe(true);
    after.bags = [6, 0];
    expect(momentsFor(before, { type: 'nextHand' }, after).some((e) => e.kind === 'bags')).toBe(false);
  });
});

describe('TTS safety of the redistributed lines', () => {
  // talkPrefs.webSpeech cleanup: mask mild cursing, apply the shared pronunciation
  // dictionary, then strip everything that is not a letter / number / space / light
  // punctuation (emoji are display-only)
  const spokenForm = (raw: string) => applyPronunciation(maskMild(raw))
    .replace(/[^\p{L}\p{N}\s'?!.,…-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const placed: { persona: PersonaId; kind: TalkKind; raw: string }[] = [];
  for (const [id, kinds] of Object.entries(POOLS2) as [PersonaId, Partial<Record<TalkKind, string[]>>][])
    for (const [kind, raws] of Object.entries(kinds) as [TalkKind, string[]][])
      for (const raw of raws) placed.push({ persona: id, kind, raw });

  it('redistribution only re-homes lines: every placed line already lives in another of that persona\u2019s pools, or in COMMON', () => {
    expect(placed.length).toBeGreaterThan(900);
    const commonRaws = new Set(Object.values(COMMON).flatMap((a) => a ?? []));
    for (const { persona, kind, raw } of placed) {
      const kindsWith = Object.entries(PERSONAS[persona].lines).filter(([k, arr]) => k !== kind && (arr ?? []).includes(raw));
      expect(kindsWith.length + (commonRaws.has(raw) ? 1 : 0), `${persona}/${kind}: ${raw}`).toBeGreaterThanOrEqual(1);
    }
  });
  it('every placed line still has words after the speech cleanup, and none is bubble-busting', () => {
    for (const { raw } of placed) {
      expect(spokenForm(raw).length, raw).toBeGreaterThanOrEqual(2);
      expect(raw, raw).not.toContain('*');
      expect(raw.length, raw).toBeLessThanOrEqual(90); // one breath, bubble-sized
    }
    void LINE_META;
  });
});
