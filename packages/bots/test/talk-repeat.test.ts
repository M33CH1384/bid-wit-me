/**
 * Repetition budget (owner, 2026-10-22): the same bot line/phrase ~3× in
 * ONE hand (Cookout, vs the twins), and the same phrasings hand after hand.
 * The pre-existing dedupe (60 s exact-text in the web layer, per-persona
 * shuffle-bags here) could not see either: COMMON pool text sits behind
 * four personas' separate bags, so one sentence landed from three mouths
 * in a single hand, and a spent bag wiped itself and restarted its loop
 * mid-match. The budget pinned here:
 *  - a normalized phrase fires at most ONCE per hand, table-wide, from
 *    any seat/pool/trigger (the hand rolls when an event carries a new
 *    hand number — every production caller stamps one);
 *  - catchphrase topics: at most once per hand while alternatives exist,
 *    bigram catchphrases capped per match with an absolute ceiling at
 *    twice the cap (a slogan may pressure-valve, never loop);
 *  - across hands, a spent pool recycles its least-recently-said line
 *    instead of wiping — a line returns only after the pool has cycled;
 *  - the budget is per-hand BY DEFINITION: with no hand stamped it is
 *    off and rotation behaves exactly as before (the density/rotation
 *    suites' unstamped world).
 * Authored beats never pass through pick() (scenes, guide, rail,
 * tributes) and consultation has its own bags — neither is capped here.
 */
import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES, botTalk, lineTopics, newTalkState, normPhrase, noteTalkHand, personaForName, poolFor, prePlayLine,
  type PersonaId, type TalkTable,
} from '../src';

const nameFor = (p: PersonaId) => BOT_NAMES.find((n) => personaForName(n) === p)!;
const table = (names: string[]): TalkTable => ({
  seats: names.map((name, i) => ({ name, bot: i !== 0 })), partnerships: true, teamNames: ['Us', 'Them'], intensity: 'cookout', jokers: true,
});
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

/** drive a stream of generic talk events at one hand; returns the lines */
const DRIVE_KINDS = ['made', 'cut', 'slam', 'roast', 'duck', 'bigBid'] as const;
function drive(st: ReturnType<typeof newTalkState>, t: TalkTable, handNo: number | undefined, n: number, seed = 5, clock0 = 1_000_000) {
  const rnd = rng32(seed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const kind = DRIVE_KINDS[i % DRIVE_KINDS.length]!;
    const l = botTalk(st, t, { kind, side: i % 2, seat: 1 + (i % 3), bid: 4, bidderSeat: 1 + (i % 3), bidderSide: i % 2, ...(handNo !== undefined ? { handNo } : {}) }, clock0 + i * 3000, rnd);
    if (l?.text) out.push(l.text);
  }
  return out;
}

describe('within-hand repetition budget', () => {
  it('the same normalized phrase never fires twice in one hand — any seat, pool or trigger', () => {
    const t = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    const st = newTalkState();
    const lines = drive(st, t, 1, 160);
    expect(lines.length).toBeGreaterThanOrEqual(12);
    const phrases = lines.map(normPhrase);
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("the twins cannot echo: Keisha's phrase is spent for Teisha too (shared COMMON text, one hand)", () => {
    const t = table(['You', 'Keisha', 'Dee', 'Teisha']); // influencer + lilcuz + petty: the Cookout seats
    const st = newTalkState();
    const lines = drive(st, t, 4, 180, 11);
    expect(lines.length).toBeGreaterThanOrEqual(12);
    const phrases = lines.map(normPhrase);
    expect(new Set(phrases).size).toBe(phrases.length);
    // and back-to-back lines never share a phrase (the answer-chain echo)
    for (let i = 1; i < phrases.length; i++) expect(phrases[i]).not.toBe(phrases[i - 1]);
  });

  it('the budget rolls with the hand: a new hand may hear everything again', () => {
    const t = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    const st = newTalkState();
    const hand1 = drive(st, t, 1, 160);
    const hand2 = drive(st, t, 2, 160, 9, 10_000_000); // the clock never rewinds between hands
    expect(hand2.length).toBeGreaterThanOrEqual(10);
    // lines flow again in hand 2 (the hand-1 spent set did not leak across)
    expect(hand2.map(normPhrase).some((p) => hand1.map(normPhrase).includes(p))).toBe(true);
  });

  it('unstamped events keep the legacy rotation (no hand identity, no budget)', () => {
    const t = table(['You', nameFor('professor'), nameFor('mama'), nameFor('og')]);
    const st = newTalkState();
    const lines = drive(st, t, undefined, 240, 3);
    expect(lines.length).toBeGreaterThanOrEqual(24);
    const phrases = lines.map(normPhrase);
    // pools exhaust and recycle, so phrases DO come back — as before
    expect(new Set(phrases).size).toBeLessThan(phrases.length);
  });
});

describe('catchphrase caps', () => {
  it('a bigram catchphrase stops at its match cap, with an absolute ceiling at twice the cap', () => {
    const t = { ...table(['You', 'Keisha', 'Dee', 'Teisha']), profile: 'lively' as const }; // the Cookout runs the lively profile (trickPop lives there)
    const st = newTalkState();
    const counts = new Map<string, number>();
    let total = 0;
    for (let hand = 1; hand <= 9; hand++) {
      noteTalkHand(st, hand);
      const rnd = rng32(hand * 31 + 7);
      for (let i = 0; i < 90; i++) {
        const l = botTalk(st, t, { kind: i % 2 ? 'trickPop' : 'prePlay', side: i % 2, handNo: hand }, hand * 1_000_000 + i * 4000, rnd);
        if (l?.text) {
          total++;
          for (const tp of lineTopics(l.text)) if (!tp.startsWith('~')) counts.set(tp, (counts.get(tp) ?? 0) + 1);
        }
      }
    }
    expect(total).toBeGreaterThan(30); // the table still talks — caps ration slogans, not speech
    for (const [tp, c] of counts) expect(c, tp).toBeLessThanOrEqual(4);
    expect(counts.get('hold on') ?? 0).toBeGreaterThanOrEqual(1); // the tic exists — bounded, not muted
    expect(counts.get('hold on') ?? 0).toBeLessThanOrEqual(4);
  });
});

describe('match rotation (LRU recycle)', () => {
  it('a spent pool recycles least-recently-said: over three cycles every line keeps coming back evenly, never back-to-back', () => {
    const prof = nameFor('professor');
    const t = table(['You', prof, nameFor('mama'), nameFor('og')]);
    const pool = poolFor('professor', 'made', 'cookout', 'f');
    const st = newTalkState();
    const said: string[] = [];
    for (let i = 0; i < pool.length * 3; i++) {
      // a fresh hand per cycle (the per-hand budget rolls, as in a match);
      // hand 2+ so the pool's priorEvent-tagged line is in the rotation too
      const l = botTalk(st, t, { kind: 'made', side: 1, seat: 1, bid: 4, bidderSeat: 1, bidderSide: 1, handNo: 2 + Math.floor(i / pool.length) }, 1_000_000 + i * 10_000, () => 0.1);
      expect(l, `fire ${i}`).not.toBeNull();
      said.push(l!.text);
    }
    // the first cycle is a permutation (the pre-existing rotation contract)
    expect(new Set(said.slice(0, pool.length)).size).toBe(pool.length);
    // never back-to-back, across the whole run
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
    // and the rotation keeps reaching the whole pool across the extra
    // cycles — nothing starves once its bag is spent (the old wipe
    // restarted the loop from the same first lines instead)
    expect(new Set(said).size).toBe(pool.length);
  });

  it('prePlayLine routes through the same budget (production stamps the hand first)', () => {
    const t = table(['You', 'Keisha', 'Dee', 'Teisha']);
    const st = newTalkState();
    noteTalkHand(st, 2);
    const rnd = rng32(17);
    const seen = new Set<string>();
    let fired = 0;
    for (let i = 0; i < 60 && fired < 12; i++) {
      const l = prePlayLine(st, t, 1 + (i % 3), 1_000_000 + i * 4000, rnd);
      if (l?.text) {
        fired++;
        const p = normPhrase(l.text);
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
    }
    expect(fired).toBeGreaterThanOrEqual(6);
  });
});

describe('prior-event gating (owner: "somebody gon pay for that last hand" — on hand 1)', () => {
  it('a priorEvent line sits out the whole first hand, then joins the rotation', () => {
    const prof = nameFor('professor');
    const t = table(['You', prof, nameFor('mama'), nameFor('og')]);
    const pool = poolFor('professor', 'made', 'cookout', 'f');
    const driveMade = (st: ReturnType<typeof newTalkState>, handNo: number, fires: number) => {
      const said: string[] = [];
      for (let i = 0; i < fires; i++) {
        const l = botTalk(st, t, { kind: 'made', side: 1, seat: 1, bid: 4, bidderSeat: 1, bidderSide: 1, handNo }, 1_000_000 + handNo * 1_000_000 + i * 10_000, () => 0.1);
        if (l?.text) said.push(l.text);
      }
      return said;
    };
    const st = newTalkState();
    const hand1 = driveMade(st, 1, pool.length * 2);
    expect(hand1.length).toBeGreaterThan(0);
    expect(hand1).not.toContain('the model holds. again.');
    const hand2 = driveMade(st, 2, pool.length * 2);
    expect(hand2).toContain('the model holds. again.');
  });

  it("the owner's exact line: hothead's prePlay payback cannot fire on hand 1, and can from hand 2", () => {
    const t = table(['You', nameFor('hothead'), nameFor('mama'), nameFor('og')]);
    const st = newTalkState();
    const rnd = rng32(23);
    const seen: string[] = [];
    noteTalkHand(st, 1);
    for (let i = 0; i < 60; i++) {
      const l = prePlayLine(st, t, 1, 1_000_000 + i * 4000, rnd);
      if (l?.text) seen.push(l.text);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain('somebody gonna pay for that last hand.');
    noteTalkHand(st, 2);
    const seen2: string[] = [];
    for (let i = 0; i < 80; i++) {
      const l = prePlayLine(st, t, 1, 3_000_000 + i * 4000, rnd);
      if (l?.text) seen2.push(l.text);
    }
    expect(seen2).toContain('somebody gonna pay for that last hand.');
  });

  it('"back to back" needs the previous hand: wonPrevHand gate (wrong winner or hand 1 = silent)', () => {
    const dee = nameFor('lilcuz');
    const t = table(['You', dee, nameFor('mama'), nameFor('og')]);
    // seat 1 is side 1 in a partnership table: the speaker's side is 1
    const driveMade = (handNo: number, prevWinnerSide: number | undefined, fires: number) => {
      const st = newTalkState();
      const said: string[] = [];
      for (let i = 0; i < fires; i++) {
        const l = botTalk(st, t, { kind: 'made', side: 1, seat: 1, bid: 4, bidderSeat: 1, bidderSide: 1, handNo, ...(prevWinnerSide !== undefined ? { prevWinnerSide } : {}) }, 1_000_000 + i * 10_000, () => 0.1);
        if (l?.text) said.push(l.text);
      }
      return said;
    };
    const pool = poolFor('lilcuz', 'made', 'cookout', 'f');
    expect(driveMade(2, 0, pool.length * 3)).not.toContain('back to back. get used to it.'); // the OTHER side won the last hand
    expect(driveMade(1, 1, pool.length * 3)).not.toContain('back to back. get used to it.'); // won it, but it was the only hand
    expect(driveMade(2, 1, pool.length * 3)).toContain('back to back. get used to it.'); // won the last hand, hand 2: legal
  });

  it('an unstamped event cannot verify a prior event: the line sits out (unverifiable = out)', () => {
    const prof = nameFor('professor');
    const t = table(['You', prof, nameFor('mama'), nameFor('og')]);
    const st = newTalkState();
    const pool = poolFor('professor', 'made', 'cookout', 'f');
    const said: string[] = [];
    for (let i = 0; i < pool.length * 2; i++) {
      const l = botTalk(st, t, { kind: 'made', side: 1, seat: 1, bid: 4, bidderSeat: 1, bidderSide: 1 }, 1_000_000 + i * 10_000, () => 0.1);
      if (l?.text) said.push(l.text);
    }
    expect(said.length).toBeGreaterThan(0);
    expect(said).not.toContain('the model holds. again.');
  });
});
