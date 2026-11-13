import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Bid,
  type Card,
  type GameState,
  type TableRules,
  makeRules,
  newGame,
} from '@spades/rules';
import { bigJokerCrackTier, landCueFor } from '../src/landCue';
import { fireCue, fx } from '../src/fx';

/**
 * Big Joker crack tiers (2026-11-06). The Big Joker is the top card in
 * the trump order — NOTHING played after it can take its trick — so the
 * book it wins is sealed the moment it lands, and every consequence
 * keyed on that book is knowable at the throw from public state:
 *
 *   4 MAX      the Little Joker is already down in this trick (the
 *              nuke's own pair); the blast at trick completion is the
 *              same moment's second half.
 *   3 HEAVY    the throw carries a consequence: it busts a live nil,
 *              takes a book off a live nil bidder who stood winning,
 *              makes its side's contract, locks the other side's set
 *              (in cutthroat: the elimination locks), or, on the final
 *              trick, ends the game.
 *   2 STANDARD a trump steal — today's five-crack quake.
 *   1 LIGHT    everything else (led plainly, plain follow, over its
 *              own side's standing trump).
 *
 * The tier rides the cue grammar (`jokerBig|<tier>`, the overcut
 * precedent) onto FxEvent.level; the host threads it to the quake
 * module as `power` and to the glassCrack gain. Seats are play order
 * (seat = index); partnerships pair seats 0+2 vs 1+3.
 */
const joker = makeRules('joker');
const cutthroat = makeRules('cutthroat');

interface Stub {
  rules?: TableRules;
  bids?: (Bid | null)[];
  won?: number[];
  done?: Card[][];
  trick?: Card[];
  scores?: number[];
  bags?: number[];
  handNo?: number;
  failStreak?: number[];
}
function state(o: Stub = {}): GameState {
  const st = newGame(o.rules ?? joker, 'crack');
  const mk = (cs: Card[]) => ({ ...st.trick, plays: cs.map((card, seat) => ({ seat, card })) });
  return {
    ...st,
    bids: o.bids ?? st.bids,
    tricksWon: o.won ?? st.tricksWon,
    tricks: (o.done ?? []).map(mk),
    trick: mk(o.trick ?? []),
    scores: o.scores ?? st.scores,
    bags: o.bags ?? st.bags,
    handNo: o.handNo ?? st.handNo,
    ...(o.failStreak ? { failStreak: o.failStreak } : {}),
  } as GameState;
}
// Filler completed tricks. The joker54 deck removes 2♣/2♥, so the low
// cards here start at the 3s — every card named must exist in the deck
// (cardPower throws on a card that was removed).
const PLAIN4: Card[][] = [
  ['3H', '4H', '5H', '6H'],
  ['7H', '8H', '9H', '10H'],
  ['3C', '4C', '5C', '6C'],
  ['7C', '8C', '9C', '10C'],
  ['3D', '4D', '5D', '6D'],
  ['7D', '8D', '9D', '10D'],
];

describe('LIGHT — the Big Joker takes an ordinary trick', () => {
  it('a plain follow of a plain lead, nothing at stake', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['AH', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
    expect(landCueFor(st, 'BJ')).toContain('jokerBig|1');
  });
  it('led plainly', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('over its own side’s standing trump is not a steal', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['AS', '5H', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('the Little Joker in a FINISHED trick does not make this one MAX', () => {
    const st = state({
      bids: [4, 4, 4, 4],
      done: [['LJ', '3H', '4H', '5H']],
      trick: ['BJ', '3H'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('thrown first, the Little Joker landing after it changes nothing — hidden at the throw', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['BJ', 'LJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
});

describe('STANDARD — a trump steal (today’s quake)', () => {
  it('crossing a cut ace', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['KH', 'AS', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(2);
    expect(landCueFor(st, 'BJ')).toContain('jokerBig|2');
  });
  it('crossing a led trump deuce', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['2D', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(2);
  });
});

describe('HEAVY — the throw carries a consequence', () => {
  it('busts the thrower’s own live nil', () => {
    const st = state({ bids: [4, 'nil', 4, 4], done: PLAIN4.slice(0, 2), trick: ['AH', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(3);
  });
  it('a nil already dead swings nothing', () => {
    const st = state({
      bids: [4, 'nil', 4, 4],
      won: [0, 1, 0, 0],
      done: PLAIN4.slice(0, 2),
      trick: ['AH', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('saves a live nil: the nil bidder stood winning and the BJ takes the book off them', () => {
    const st = state({ bids: ['nil', 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['AH', '3H', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(3);
  });
  it('no save when the nil bidder is not the one standing winning', () => {
    const st = state({ bids: ['nil', 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['KH', 'AH', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('wins the book that makes its side’s contract', () => {
    const st = state({
      bids: [4, 4, 3, 4], // side 0 contracted 7
      won: [3, 0, 3, 0], // side 0 holds 6 — one book short
      done: PLAIN4,
      trick: ['3H', '4H', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(3);
  });
  it('one book short of the contract book is not the contract book', () => {
    const st = state({
      bids: [4, 4, 3, 4],
      won: [3, 0, 2, 0], // side 0 holds 5 — two short, and the other
      // side’s set was already locked before this throw, so the throw
      // locks nothing either
      done: PLAIN4,
      trick: ['3H', '4H', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('wins the book that locks the other side’s set', () => {
    const st = state({
      bids: [4, 5, 4, 4], // side 1 contracted 9
      won: [0, 4, 0, 3], // side 1 holds 7 — needs 2 with 1 trick left after this
      done: [...PLAIN4, ...PLAIN4.slice(0, 5)],
      trick: ['AH', '3H', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(3);
  });
  it('one more trick of slack and the same throw locks nothing', () => {
    const st = state({
      bids: [4, 5, 4, 4],
      won: [0, 4, 0, 3],
      done: [...PLAIN4, ...PLAIN4.slice(0, 4)], // 2 tricks left after this one
      trick: ['AH', '3H', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('cutthroat: locking a set on hand 1 is an elimination lock', () => {
    const st = state({
      rules: cutthroat,
      bids: [3, 3, 3, 3],
      won: [0, 0, 1, 0], // seat 2 needs 2 with 1 trick left after this
      done: [...PLAIN4, ...PLAIN4.slice(0, 5)],
      handNo: 1,
      trick: ['BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(3);
  });
  it('on the final trick, ends the game on the projected score', () => {
    const st = state({
      bids: [4, 4, 3, 4],
      won: [3, 3, 3, 3],
      scores: [300, 440], // side 1 makes 7 → +70 → 510 ≥ 500, the top score
      done: [...PLAIN4, ...PLAIN4],
      trick: ['3H', '4H', '5H', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(3);
  });
  it('the same final trick with nothing decided is LIGHT', () => {
    const st = state({
      bids: [3, 3, 3, 3], // both contracts already made before this trick
      won: [3, 3, 3, 3],
      scores: [300, 300],
      done: [...PLAIN4, ...PLAIN4],
      trick: ['3H', '4H', '5H', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
  it('books hands have no contracts to make or lock', () => {
    const st = state({
      bids: ['books', 'books', 'books', 'books'],
      done: PLAIN4.slice(0, 2),
      trick: ['AH', 'BJ'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(1);
  });
});

describe('MAX — the Big Joker meets the Little Joker', () => {
  it('the Little Joker already down in this trick', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['LJ', '3H', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(4);
    expect(landCueFor(st, 'BJ')).toContain('jokerBig|4');
  });
  it('MAX outranks a HEAVY the same throw also carries', () => {
    const st = state({ bids: [4, 'nil', 4, 4], done: PLAIN4.slice(0, 2), trick: ['LJ', 'BJ'] });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(4);
  });
  it('a late-built cue (trick already complete) reads the same tier', () => {
    const st = state({
      bids: [4, 4, 4, 4],
      won: [1, 0, 1, 0],
      done: [
        ['AH', '3H', '4H', '5H'],
        ['LJ', '3H', 'BJ', '4C'],
      ],
      trick: ['3C'],
    });
    expect(bigJokerCrackTier(st, 'BJ')).toBe(4);
  });
});

describe('controls — nothing else gains a tier', () => {
  it('the Little Joker’s cue stays bare', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['AS', 'LJ'] });
    expect(landCueFor(st, 'LJ')).toBe('play,jokerLittle');
  });
  it('a plain card’s cue carries no jokerBig segment at all', () => {
    const st = state({ bids: [4, 4, 4, 4], done: PLAIN4.slice(0, 2), trick: ['KH', 'AS'] });
    expect(landCueFor(st, 'AS')).not.toContain('jokerBig');
  });
});

describe('the tier rides the cue onto the fx event', () => {
  it('fireCue emits jokerBig with the tier as its level', () => {
    const seen: { kind: string; level?: number }[] = [];
    const off = fx.on((e) => seen.push({ kind: e.kind, level: e.level }));
    fireCue('jokerBig|3');
    // a deuce-Cut landing cue, split into segments the way Card3D fires it
    for (const seg of 'play,jokerBig|1,deuceThump'.split(',')) fireCue(seg);
    fireCue('jokerBig');
    off();
    const big = seen.filter((e) => e.kind === 'jokerBig');
    expect(big.map((e) => e.level)).toEqual([3, 1, undefined]);
  });
});

describe('the stacking rule: one bust, one crack', () => {
  // The plate crack (AnimFxLayer) fires on a busted nil and on a
  // cutthroat elimination with the SAME glassCrack recording the quake
  // uses. When the Big Joker's own throw caused the event, the quake
  // is that event's crack and the plate crack stands down; any other
  // cause keeps it. Behavioural pins: animfx-crack-sound.test.ts and
  // packages/rules/test/bj-out-seats.test.ts.
  const layer = readFileSync(new URL('../src/animfx/AnimFxLayer.tsx', import.meta.url), 'utf8');
  const game = readFileSync(
    new URL('../../../packages/rules/src/game.ts', import.meta.url),
    'utf8',
  );

  it('the nil-bust crack yields when the busting book was the Big Joker', () => {
    expect(layer).toContain("firstBookCard(st.rules, st.tricks, seat) === 'BJ'");
  });
  it('the elimination crack yields to the engine’s causation stamp', () => {
    expect(layer).toContain('lastRec?.outByBigJoker?.includes(seat)');
    expect(game).toContain('record.outByBigJoker = bjOut');
    expect(game).toContain('export function bigJokerOutSeats');
  });
  it('the plate crack’s own call sites are untouched — still three', () => {
    expect(layer.match(/sound\.play\('glassCrack'\)/g)).toHaveLength(3);
  });
});

describe('host + module: the degree reaches the glass', () => {
  const host = readFileSync(new URL('../src/photoreal/host.ts', import.meta.url), 'utf8');
  const quake = readFileSync(
    new URL('../src/photoreal/modules/quake.js', import.meta.url),
    'utf8',
  );
  const dts = readFileSync(
    new URL('../src/photoreal/modules/modules.d.ts', import.meta.url),
    'utf8',
  );

  it('the crack gain follows the tier; STANDARD keeps today’s 1.1', () => {
    expect(host).toContain('QUAKE_CRACK_GAIN');
    expect(host).toContain('[0.85, 1.1, 1.3, 1.35]');
  });
  it('the top tier alone gets the settle layer, on the presented clock', () => {
    expect(host).toContain('QUAKE_SETTLE_T = 1.75');
    expect(host).toContain('T >= QUAKE_SETTLE_T');
    expect(host).toContain('power === 4');
  });
  it('startPhotoreal threads the event level into the quake as power', () => {
    expect(host).toContain("name === 'quake' ? { power: e.level ?? 2 } : {}");
    // Pin rewritten 2026-11-12 with the crash-hardening merge: the host now builds module opts in
    // createOpts(pl, power) for the effect runner. The requirement is unchanged — the tier reaches createFx.
    expect(host).toContain('tableRy: pl.drawRy * pl.pr, power');
    expect(host).toContain('opts: createOpts(pl, power)');
  });
  it('the module opts type carries the degree', () => {
    expect(dts).toContain('power?: number');
  });
  it('the module grows the degree’s fracture — STANDARD row is today’s literals', () => {
    expect(quake).toContain('env.power');
    expect(quake).toContain('[3,5,7,9]');
    expect(quake).toContain('[36,52,64,76]');
    expect(quake).toContain('[.0055,.008,.0105,.013]');
    expect(quake).toContain('i<CN');
    expect(quake).toContain('S*CW');
    // The crack-start time is the sound-sync contract: untouched.
    expect(quake).toContain('.45+rr()*.25');
  });
});
