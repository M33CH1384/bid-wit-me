/**
 * Moment-fit (owner, 2026-10-22): lines that assert a checkable claim may
 * only fire when the claim is true under the event's fact snapshot. Before
 * this pass the fact tags were an 85% preference — a line tagged for a big
 * lead stayed drawable while down 200, "{bid}" lines filled "that many" on
 * bid-less events, and a revenge line referenced sets that never happened.
 */
import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES, LINE_META, PERSONAS, botTalk, lineById, newTalkState, personaForName, poolFor,
  type PersonaId, type TalkEvent, type TalkTable,
} from '../src';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** a BOT_NAMES name whose persona is `p` (personaOf resolves by name) */
const nameFor = (p: PersonaId): string => BOT_NAMES.find((n) => personaForName(n) === p) ?? BOT_NAMES[0]!;
/** a persona whose pool for `kind` (either gender) actually contains `raw` */
function speakerFor(kind: Parameters<typeof poolFor>[1], raw: string): PersonaId {
  for (const p of Object.keys(PERSONAS) as PersonaId[]) {
    for (const g of ['f', 'm'] as const) if (poolFor(p, kind, 'nomercy', g, undefined, true).includes(raw)) return p;
  }
  throw new Error(`no persona pool for ${kind} contains ${raw}`);
}
/** every line in a persona's `kind` pool whose fact tag is `fact` */
function poolLinesWithFact(p: PersonaId, kind: Parameters<typeof poolFor>[1], fact: string): string[] {
  const all = new Set<string>();
  for (const g of ['f', 'm'] as const) for (const l of poolFor(p, kind, 'nomercy', g, undefined, true)) all.add(l);
  return [...all].filter((l) => LINE_META[l]?.fact === fact);
}
/** a 4-seat partnership table: side 0 = seats 0,2 — side 1 = seats 1,3 */
function table(botNames: (string | null)[]): TalkTable {
  return {
    seats: botNames.map((n, i) => ({ bot: n !== null, name: n ?? `Human${i}` })),
    partnerships: true,
    teamNames: ['Us', 'Them'],
    intensity: 'nomercy',
    jokers: true,
    profile: 'lively',
  };
}


describe('fact gate: a tagged claim fires only when it is true', () => {
  it('aheadBig win lines never fire on a close win, and do fire on a blowout', () => {
    const owner = speakerFor('win', 'Who got NEXT?!');
    const aheadLines = poolLinesWithFact(owner, 'win', 'aheadBig');
    expect(aheadLines.length).toBeGreaterThan(0);
    const t = table([nameFor(owner), null, 'Rex', null]);
    const st = newTalkState();
    const rnd = mulberry(42);
    let now = 1_000_000;
    const closeRaws: string[] = [];
    for (let i = 0; i < 300; i++) {
      now += 5000;
      const line = botTalk(st, t, { kind: 'win', side: 0, seat: 0, gapBucket: 'close', pressure: true }, now, rnd);
      if (line?.line) closeRaws.push(lineById(line.line) ?? '');
    }
    expect(closeRaws.length).toBeGreaterThan(0); // the win pool still speaks — claim-free lines carry it
    for (const raw of aheadLines) expect(closeRaws).not.toContain(raw);
    let saw = 0;
    for (let i = 0; i < 300; i++) {
      now += 5000;
      const line = botTalk(st, t, { kind: 'win', side: 0, seat: 0, gapBucket: 'aheadBig', pressure: true }, now, rnd);
      if (line?.line && aheadLines.includes(lineById(line.line) ?? '')) saw++;
    }
    expect(saw).toBeGreaterThan(0);
  });

  it('a bidderOpp line never fires when the speaker’s own side held the contract', () => {
    const raw = "y'all bid {bid} with what?";
    expect(LINE_META[raw]?.fact).toBe('bidderOpp');
    const owner = speakerFor('setThem', raw);
    const t = table([nameFor(owner), null, 'Rex', null]);
    const st = newTalkState();
    const rnd = mulberry(7);
    let now = 1_000_000;
    // the set side is the SPEAKER's side (bidderSide 0, contract seat = the speaker)
    for (let i = 0; i < 300; i++) {
      now += 5000;
      const line = botTalk(st, t, { kind: 'setThem', side: 0, seat: 0, bid: 7, books: 4, bidderSeat: 0, bidderSide: 0 }, now, rnd);
      if (line?.line) expect(lineById(line.line)).not.toBe(raw);
    }
    // the set side is the opponents': the line is eligible and lands
    let saw = 0;
    for (let i = 0; i < 300; i++) {
      now += 5000;
      const line = botTalk(st, t, { kind: 'setThem', side: 0, seat: 0, bid: 7, books: 4, bidderSeat: 1, bidderSide: 1 }, now, rnd);
      if (line?.line && lineById(line.line) === raw) saw++;
    }
    expect(saw).toBeGreaterThan(0);
  });

  it('{bid} lines sit out bid-less events (no "that many"), {gap} lines sit out gap-less ones', () => {
    const bidLine = Object.values(PERSONAS).flatMap((p) => p.lines.cut ?? []).find((l) => l.includes('{bid}'));
    expect(bidLine).toBeTruthy();
    const t = table(['Rex', null, 'Marla', null]);
    const st = newTalkState();
    const rnd = mulberry(99);
    let now = 1_000_000;
    for (let i = 0; i < 400; i++) {
      now += 5000;
      const line = botTalk(st, t, { kind: 'cut', side: 0, seat: 0, card: 'AS' }, now, rnd);
      if (line) {
        expect(line.text).not.toContain('that many');
        if (line.line) expect(lineById(line.line) ?? '').not.toContain('{bid}');
      }
    }
    for (let i = 0; i < 400; i++) {
      now += 5000;
      const line = botTalk(st, t, { kind: 'setThem', side: 0, seat: 0, bid: 7, books: 3, bidderSeat: 1, bidderSide: 1 }, now, rnd);
      if (line) expect(line.text).not.toContain('BYE BYE 0 POINTS');
    }
  });

  it("the set-revenge line waits for a set that actually happened ('oppSet')", () => {
    const raw = "this one's for that set earlier.";
    expect(LINE_META[raw]?.fact).toBe('oppSet');
    const owner = speakerFor('prePlay', raw);
    const t = table([null, nameFor(owner), null, 'Marla']);
    const st = newTalkState();
    const rnd = mulberry(1234);
    let now = 1_000_000;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      now += 6000;
      const line = botTalk(st, t, { kind: 'trickPop', side: 1, setsBySide: [0, 0] }, now, rnd);
      if (line?.line) seen.add(lineById(line.line) ?? '');
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.has(raw)).toBe(false);
    let saw = 0;
    for (let i = 0; i < 400; i++) {
      now += 6000;
      const line = botTalk(st, t, { kind: 'trickPop', side: 1, setsBySide: [2, 0] }, now, rnd);
      if (line?.line && lineById(line.line) === raw) saw++;
    }
    expect(saw).toBeGreaterThan(0);
  });
});

describe('murmur discipline', () => {
  it('a murmur stays silent in the quiet window after a significant moment', () => {
    const t = table([null, 'Rex', null, 'Marla']);
    const st = newTalkState();
    const rnd = mulberry(5);
    // a set lands at t0 (the event itself stamps the window, spoken or not)
    botTalk(st, t, { kind: 'setThem', side: 1, seat: 1, bid: 6, books: 2, bidderSeat: 0, bidderSide: 0 }, 100_000, rnd);
    expect(st.lastBigAt).toBe(100_000);
    const quiet = botTalk(st, t, { kind: 'trickPop', seat: 1, murmur: true }, 104_000, rnd);
    expect(quiet).toBeNull();
    const later = botTalk(st, t, { kind: 'trickPop', seat: 1, murmur: true }, 120_000, rnd);
    expect(later).not.toBeNull();
  });
});

describe('claim dedupe', () => {
  it('the same score claim from a side does not repeat while the facts stand still', () => {
    const owner = speakerFor('win', 'Who got NEXT?!');
    expect(poolLinesWithFact(owner, 'win', 'aheadBig').length).toBeGreaterThan(0);
    const t = table([nameFor(owner), null, 'Marla', null]);
    const st = newTalkState();
    const rnd = mulberry(2024);
    let now = 1_000_000;
    const aheadClaims = (n: number) => {
      let c = 0;
      for (let i = 0; i < n; i++) {
        now += 5000;
        const line = botTalk(st, t, { kind: 'win', side: 0, seat: 0, gapBucket: 'aheadBig', pressure: true }, now, rnd);
        if (line?.line && LINE_META[lineById(line.line) ?? '']?.fact === 'aheadBig') c++;
      }
      return c;
    };
    // many wins at the same standing facts: at most ONE aheadBig-claim line total
    expect(aheadClaims(80)).toBeLessThanOrEqual(1);
    // the facts move (side 0's bucket flips to close, then back): the claim may be made again
    now += 5000;
    botTalk(st, t, { kind: 'made', side: 0, seat: 0, bid: 5, gapBucket: 'close', bidderSeat: 0, bidderSide: 0 }, now, rnd);
    expect(aheadClaims(80)).toBeGreaterThanOrEqual(1);
  });
});

describe('answer-chain plumbing', () => {
  it('excludeSeat is honored outside the trickPop path (a co-sign never comes from the origin speaker)', () => {
    const t = table(['Rex', null, 'Marla', null]);
    const st = newTalkState();
    const rnd = mulberry(31);
    let now = 1_000_000;
    let spoke = 0;
    for (let i = 0; i < 200; i++) {
      now += 6000;
      const ev: TalkEvent = { kind: 'hypePartner', side: 0, them: 0, excludeSeat: 0 };
      const line = botTalk(st, t, ev, now, rnd);
      if (line) { spoke++; expect(line.seat).toBe(2); }
    }
    expect(spoke).toBeGreaterThan(0);
  });
});
