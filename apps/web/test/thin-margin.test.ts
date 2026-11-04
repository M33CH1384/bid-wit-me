/**
 * Thin-margin plate marker (owner, 2026-11-04): "they should also get
 * something in their plate if they bid a bunch of books and it's getting
 * close to impossible to make them."
 *
 * The derivation composes the engine's own bookkeeping — booksStillNeeded
 * (scoreHand's contract arithmetic) and tricksStillRemaining (the hand's
 * real trick count, short tables included). slack = remaining − needed is
 * exactly "mistakes left": a won trick moves both numbers, a lost trick
 * moves only the clock.
 *
 * Pins: the slack boundaries (2 → nothing, 1 → THIN ICE, 0 → MUST WIN OUT,
 * <0 → SET), both partnership plates carrying the side's light, cutthroat's
 * single plate, nil never feeding a contract, the opening gate (the marker
 * arms only once a trick has resolved — before that, slack is just the bid
 * the side chose), hand-end clear with no leak into the next hand, and the
 * book-win bookkeeping at slack 0.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeRules, type Bid, type Trick } from '@spades/rules';
import { MARGIN_LABEL, marginSlack, marginTier, marginTierForSeat } from '../src/thinMargin';

const joker = makeRules('joker'); // 4p partnerships, 13 tricks
const cut4 = makeRules('cutthroat'); // 4p, no partnerships, 13 tricks
const cut3 = makeRules('cutthroat', { playerCount: 3 }); // 17 tricks

type St = Parameters<typeof marginTier>[0];
const st = (over: Partial<St> & { done?: number } = {}): St => {
  const { done = 0, ...rest } = over;
  return {
    rules: joker,
    phase: 'playing',
    bids: [5, 4, 5, 4] as (Bid | null)[],
    tricksWon: [0, 0, 0, 0],
    tricks: Array.from({ length: done }, () => ({}) as Trick),
    ...rest,
  } as St;
};

describe('slack boundaries (partnership)', () => {
  // Side 0 = seats 0+2, contract 10 with the default bids.
  it('slack 2 shows nothing', () => {
    // 8 done, side 0 took 7 → needs 3, 5 tricks remain → 2 mistakes left.
    const s = st({ done: 8, tricksWon: [4, 1, 3, 0] });
    expect(marginSlack(s, 0)).toBe(2);
    expect(marginTier(s, 0)).toBe(0);
  });

  it('slack 1 is tier 1, on BOTH partners\' plates and no one else\'s', () => {
    // 10 done, side 0 took 8 → needs 2, 3 remain → one mistake left.
    const s = st({ done: 10, tricksWon: [4, 2, 4, 0] });
    expect(marginSlack(s, 0)).toBe(1);
    expect(marginTier(s, 0)).toBe(1);
    expect(marginTierForSeat(s, 0)).toBe(1);
    expect(marginTierForSeat(s, 2)).toBe(1);
    // Side 1 (contract 8) took 2 → needs 6 with 3 left: sealed, its own story.
    expect(marginTierForSeat(s, 1)).toBe(3);
    expect(marginTierForSeat(s, 3)).toBe(3);
  });

  it('slack 0 is tier 2 — must win out', () => {
    // 10 done, side 0 took 7 → needs 3, exactly 3 remain.
    const s = st({ done: 10, tricksWon: [3, 3, 4, 0] });
    expect(marginSlack(s, 0)).toBe(0);
    expect(marginTier(s, 0)).toBe(2);
  });

  it('at slack 0 a won book holds slack 0; a lost book seals the set', () => {
    const before = st({ done: 10, tricksWon: [3, 3, 4, 0] });
    const won = st({ done: 11, tricksWon: [4, 3, 4, 0] }); // needs 2, 2 remain
    const lost = st({ done: 11, tricksWon: [3, 4, 4, 0] }); // needs 3, 2 remain
    expect(marginTier(before, 0)).toBe(2);
    expect(marginSlack(won, 0)).toBe(0);
    expect(marginTier(won, 0)).toBe(2);
    expect(marginSlack(lost, 0)).toBe(-1);
    expect(marginTier(lost, 0)).toBe(3);
  });

  it('a made contract shows nothing, however few tricks remain', () => {
    // Side 0 took all 10 of its contract with 3 tricks left: home already.
    const s = st({ done: 10, tricksWon: [5, 0, 5, 0] });
    expect(marginTier(s, 0)).toBe(0);
    // Over-made reads the same.
    expect(marginTier(st({ done: 11, tricksWon: [6, 0, 5, 0] }), 0)).toBe(0);
  });
});

describe('the opening gate', () => {
  it('an extreme bid at hand start shows nothing before a trick resolves', () => {
    // Contract 12 of 13: slack 1 on paper, but no card has fallen — the
    // number is the bid the side chose, not danger that arrived.
    const s = st({ bids: [6, 4, 6, 4], done: 0, tricksWon: [0, 0, 0, 0] });
    expect(marginTier(s, 0)).toBe(0);
    // One trick in, the same arithmetic arms: won it → thin ice; lost it →
    // must win out; lost the first two → sealed before the third card falls.
    expect(marginTier(st({ bids: [6, 4, 6, 4], done: 1, tricksWon: [1, 0, 0, 0] }), 0)).toBe(1);
    expect(marginTier(st({ bids: [6, 4, 6, 4], done: 1, tricksWon: [0, 1, 0, 0] }), 0)).toBe(2);
    expect(marginTier(st({ bids: [6, 4, 6, 4], done: 2, tricksWon: [0, 2, 0, 0] }), 0)).toBe(3);
  });

  it('nothing outside live play: bidding, exchange, hand over', () => {
    const live = { done: 9, tricksWon: [4, 1, 4, 0] };
    expect(marginTier(st({ ...live, phase: 'bidding' }), 0)).toBe(0);
    expect(marginTier(st({ ...live, phase: 'exchange' }), 0)).toBe(0);
    expect(marginTier(st({ ...live, phase: 'handOver' }), 0)).toBe(0);
    expect(marginTier(st({ ...live, phase: 'gameOver' }), 0)).toBe(0);
  });

  it('no leak into the next hand: a fresh deal carrying last hand\'s tally stays dark', () => {
    const sealedLastHand = { bids: [5, 4, 5, 4] as (Bid | null)[], tricksWon: [3, 4, 4, 0] };
    expect(marginTier(st({ ...sealedLastHand, phase: 'bidding', done: 0 }), 0)).toBe(0);
    expect(marginTier(st({ ...sealedLastHand, phase: 'playing', done: 0 }), 0)).toBe(0);
  });
});

describe('nil handling', () => {
  it('a nil bid never feeds the contract: the numeric partner\'s bid stands alone', () => {
    // Seat 2 bid nil; side 0's contract is seat 0's 5 alone, made only with
    // seat 0's books (nilTricksCountForPartner is off in these rules).
    const s = st({ bids: [5, 4, 'nil', 4], done: 11, tricksWon: [3, 3, 2, 3] });
    // Seat 0 took 3 → still needs 2 with 2 tricks left: must win out.
    expect(marginTier(s, 0)).toBe(2);
    // Had the nil seat's 2 books counted, the contract would read made.
    const counting = { ...joker, nilTricksCountForPartner: true };
    expect(marginTier(st({ rules: counting, bids: [5, 4, 'nil', 4], done: 11, tricksWon: [3, 3, 2, 3] }), 0)).toBe(0);
  });

  it('a pure-nil side has no contract and never gets the marker', () => {
    const s = st({ bids: ['nil', 4, 'blindNil', 4], done: 11, tricksWon: [0, 5, 1, 5] });
    expect(marginSlack(s, 0)).toBeNull();
    expect(marginTier(s, 0)).toBe(0);
  });

  it('a books hand answers to the host minimum, which can run thin', () => {
    // First hand bids itself: side 0 must take the minimum (4) or be set at it.
    const s = st({ bids: ['books', 'books', 'books', 'books'], done: 11, tricksWon: [2, 5, 1, 3] });
    // Side 0 took 3 → needs 1 with 2 left: thin ice.
    expect(marginTier(s, 0)).toBe(1);
  });
});

describe('cutthroat', () => {
  it('the marker rides the endangered seat\'s plate only', () => {
    // Seat 0 bid 8, took 5 with 3 tricks left → must win out. Others are safe.
    const s = st({ rules: cut4, bids: [8, 3, 3, 2], done: 10, tricksWon: [5, 2, 2, 1] });
    expect(marginTierForSeat(s, 0)).toBe(2);
    expect(marginTierForSeat(s, 1)).toBe(0);
    expect(marginTierForSeat(s, 2)).toBe(0);
    expect(marginTierForSeat(s, 3)).toBe(0);
  });

  it('a 3-player table runs on 17 tricks, not 13', () => {
    const s = st({ rules: cut3, bids: [9, 4, 4], done: 15, tricksWon: [7, 4, 4] });
    // Seat 0 needs 2 with exactly 2 of 17 left.
    expect(marginSlack(s, 0)).toBe(0);
    expect(marginTierForSeat(s, 0)).toBe(2);
  });

  it('a short hand\'s trickCount overrides the rules hand size', () => {
    const s = st({ rules: cut4, bids: [6, 3, 3, 3], done: 8, tricksWon: [4, 2, 1, 1], trickCount: 10 });
    // Seat 0 needs 2 with 2 of this hand's 10 left.
    expect(marginTierForSeat(s, 0)).toBe(2);
  });
});

describe('labels', () => {
  it('one short label per state, plain words, no emoji', () => {
    expect(MARGIN_LABEL[1]).toBe('THIN ICE');
    expect(MARGIN_LABEL[2]).toBe('MUST WIN OUT');
    expect(MARGIN_LABEL[3]).toBe('SET');
  });
});

describe('plate wiring (source pins)', () => {
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  it('both plate render sites carry the chip, keyed per seat', () => {
    expect(table).toContain('testId={`margin-${seat}`}');
    expect(table).toContain('testId="margin-0"');
    expect(table).toContain('data-testid={testId}');
    expect(table).toContain("from './thinMargin'");
  });

  it('the chip carries the bad class, so the plate-facts sync never indexes it', () => {
    expect(table).toContain('chip bad margin');
  });

  it('three tier styles: ice steady, red pulsing on the notice cadence, sealed solid', () => {
    expect(css).toMatch(/\.chip\.margin\.t1\s*\{[^}]*background:/);
    expect(css).toMatch(/\.chip\.margin\.t2\s*\{[^}]*animation:\s*notice-pulse/);
    expect(css).toMatch(/\.chip\.margin\.t3\s*\{[^}]*background:/);
    const t1 = /\.chip\.margin\.t1\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const t3 = /\.chip\.margin\.t3\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(t1).not.toBe(t3);
  });
});
