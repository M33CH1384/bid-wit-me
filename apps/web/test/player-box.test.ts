/**
 * Owner, 2026-11-13: "We need a box score button here to look at all the players performances side
 * by side separated by team" and "I want the matchup screens (right before the venue) to look like"
 * a sports app's matchup page.
 *
 * Pins the box score arithmetic (straight off the scored hands), its wiring into both results
 * screens, and the matchup predictor's honesty: ratings, then the viewer's own record, then even.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeRules, type HandRecord } from '@spades/rules';
import { diffText, ofText, playerBoxScore } from '../src/playerBox';
import { PREDICTION_FLOOR, predictMatchup, predictionCaption } from '../src/matchupPredictor';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const r = makeRules('joker');
const hand = (bids: (number | 'nil')[], won: number[], made: (boolean | null)[], opts: { runs?: number[]; nilMade?: number[]; nuke?: number; bags?: number[] } = {}): HandRecord => ({
  handNo: 1, dealer: 0, bids, tricksWon: won, bestRuns: opts.runs, ...(opts.nuke !== undefined ? { nuke: { seat: opts.nuke } } : {}),
  sides: [0, 1].map((side) => ({ side, seats: side ? [1, 3] : [0, 2], contractMade: made[side]!, bagsAdded: opts.bags?.[side] ?? 0, nils: bids.flatMap((b, seat) => (b === 'nil' && seat % 2 === side ? [{ seat, made: !!opts.nilMade?.includes(seat) }] : [])) })),
} as unknown as HandRecord);

describe('player box score', () => {
  const history = [
    hand([3, 5, 2, 2], [3, 5, 2, 3], [true, true], { runs: [2, 3, 1, 2], bags: [0, 1] }),
    hand([4, 'nil', 3, 4], [5, 0, 2, 6], [true, true], { runs: [4, 0, 1, 5], nilMade: [1], nuke: 3, bags: [0, 2] }),
    hand([4, 3, 3, 2], [2, 4, 3, 4], [false, true], { runs: [1, 2, 2, 2], bags: [0, 3] }),
  ];
  const [a, b] = playerBoxScore(r, history, [120, 210]);

  it('groups seats by side, with the final score', () => {
    expect(a!.players.map((p) => p.seat)).toEqual([0, 2]);
    expect(b!.players.map((p) => p.seat)).toEqual([1, 3]);
    expect([a!.score, b!.score]).toEqual([120, 210]);
  });

  it('adds up each player straight off the hands', () => {
    const you = a!.players[0]!;
    expect(you).toMatchObject({ bid: 11, books: 10, diff: -1, bidHands: 3, hitBid: 2, nilsTried: 0, bestRun: 4, nukes: 0 });
    const fatima = b!.players[0]!; // one nil hand: it counts as a nil, not as a bid
    expect(fatima).toMatchObject({ bid: 8, books: 9, diff: 1, bidHands: 2, hitBid: 2, nilsTried: 1, nilsMade: 1 });
    expect(b!.players[1]!).toMatchObject({ books: 13, bestRun: 5, nukes: 1 });
  });

  it('team totals: books and bids summed, MADE is contracts, plus sets and bags', () => {
    expect(a!.total).toMatchObject({ bid: 19, books: 17, bidHands: 3, hitBid: 2, bestRun: 4 });
    expect(a!.sets).toBe(1);
    expect(b!.total).toMatchObject({ books: 22, bidHands: 3, hitBid: 3, nilsTried: 1, nilsMade: 1, nukes: 1 });
    expect(b!.bags).toBe(6);
  });

  it('the books in the box add up to the tricks played', () => {
    expect(a!.total.books + b!.total.books).toBe(39);
  });

  it('formats', () => {
    expect([diffText(0), diffText(3), diffText(-2)]).toEqual(['E', '+3', '−2']);
    expect([ofText(2, 3), ofText(0, 0)]).toEqual(['2/3', '—']);
  });

  it('is offered on both results screens, and is not the button the inline pad hides', () => {
    const src = read('../src/Table.tsx');
    expect(src.match(/data-testid="box-score-open"/g)).toHaveLength(2);
    expect(src).toContain('className="ghost-btn box-score-btn"');
    expect(src).toContain('<PlayerBoxScore teams={playerBoxScore(r, st.history, st.scores)}');
  });
});

describe('matchup predictor', () => {
  it('ratings on every side: the rating gap decides, and it sums to 100', () => {
    const p = predictMatchup({ ratings: [1600, 1400], viewerSide: 0 })!;
    expect(p.basis).toBe('ratings');
    expect(p.pct[0]! + p.pct[1]!).toBe(100);
    expect(p.pct[0]!).toBeGreaterThan(65);
    expect(predictMatchup({ ratings: [1500, 1500], viewerSide: 0 })!.pct).toEqual([50, 50]);
  });

  it('never calls it a lock', () => {
    const p = predictMatchup({ ratings: [2600, 900], viewerSide: 0 })!;
    expect(p.pct[1]!).toBeGreaterThanOrEqual(PREDICTION_FLOOR);
  });

  it('no ratings: the viewer’s own record against them, pulled toward even on a small sample', () => {
    const two = predictMatchup({ ratings: [null, null], viewerSide: 0, vsRecord: { games: 2, wins: 2 } })!;
    expect(two.basis).toBe('record');
    expect(two.pct[0]!).toBeLessThan(75); // 2–0 is not 100%
    const many = predictMatchup({ ratings: [null, null], viewerSide: 0, vsRecord: { games: 40, wins: 30 } })!;
    expect(many.pct[0]!).toBeGreaterThan(two.pct[0]!);
    // the viewer on the right-hand side gets the right-hand number
    expect(predictMatchup({ ratings: [null, null], viewerSide: 1, vsRecord: { games: 40, wins: 30 } })!.pct[1]).toBe(many.pct[0]);
  });

  it('nothing to go on: even, and it says so', () => {
    const p = predictMatchup({ ratings: [null, null], viewerSide: 0, vsRecord: null })!;
    expect(p).toMatchObject({ basis: 'even', pct: [50, 50] });
    expect(predictionCaption(p)).toContain('No history');
    expect(predictMatchup({ ratings: [null, null, null, null], viewerSide: 2 })!.pct).toEqual([25, 25, 25, 25]);
  });

  it('a partial set of ratings is not used as if it were whole', () => {
    expect(predictMatchup({ ratings: [1700, null], viewerSide: 0 })!.basis).toBe('even');
  });

  it('captions name the source', () => {
    expect(predictionCaption({ pct: [60, 40], basis: 'ratings' })).toContain('league ratings');
    expect(predictionCaption({ pct: [60, 40], basis: 'record', games: 1 })).toContain('your 1 game against them');
  });

  it('the matchup screen shows it outside story mode, under the stage and above the tape', () => {
    const src = read('../src/VersusIntro.tsx');
    expect(src).toContain('if (model.story) return null;');
    const at = src.indexOf('{preview && <VersusPreview');
    expect(at).toBeGreaterThan(src.indexOf('<div className="versus-flash"'));
    expect(at).toBeLessThan(src.indexOf('<VersusTape mode={model.mode}'));
  });
});
