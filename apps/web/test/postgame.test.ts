/** League P-D (Demetrius 2026-10-20): the Postgame Report is computed from
 *  the finished game's hand history only — final scores, books, nils, and
 *  honest best moments. The nuke callout (league data wave) reads the
 *  engine's stamp on the hand record; older histories without it omit it. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPostgame, type PostgameHand } from '../src/GameOverRewards';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const H = (handNo: number, tricksWon: number[], sides: PostgameHand['sides']): PostgameHand => ({ handNo, tricksWon, sides });
const history: PostgameHand[] = [
  H(1, [6, 3, 4, 0], [
    { side: 0, tricks: 10, points: 84, nils: [{ seat: 0, kind: 'nil', made: true }] },
    { side: 1, tricks: 3, points: -40, nils: [] },
  ]),
  H(2, [7, 2, 6, 0], [
    { side: 0, tricks: 13, points: 130, nils: [] },
    { side: 1, tricks: 0, points: -70, nils: [{ seat: 1, kind: 'blindNil', made: false }] },
  ]),
];

describe('buildPostgame', () => {
  const pg = buildPostgame({
    history,
    finalScores: [214, -110],
    sideLabels: ['You + Pat', 'Rivals'],
    seatLabels: ['You', 'Rex', 'Pat', 'Sal'],
    mySeat: 0,
    mySide: 0,
  });
  it('side lines: final score, total books, nils made', () => {
    expect(pg.sides[0]).toEqual({ label: 'You + Pat', score: 214, books: 23, nilsMade: 1 });
    expect(pg.sides[1]).toEqual({ label: 'Rivals', score: -110, books: 3, nilsMade: 0 });
  });
  it('my line: books from my seat, nils I made', () => {
    expect(pg.myBooks).toBe(13);
    expect(pg.myNilsMade).toBe(1);
  });
  it('moments: my nil, the Boston, my best hand — in hand order, capped at 4', () => {
    expect(pg.moments[0]).toBe('You made a nil in hand 1');
    expect(pg.moments[1]).toBe('Boston — You + Pat took every book in hand 2');
    expect(pg.moments[2]).toBe('Your best hand: +130 points in hand 2');
    expect(pg.moments.length).toBeLessThanOrEqual(4);
  });
  it('an empty history yields empty lines, no invented moments', () => {
    const empty = buildPostgame({ history: [], finalScores: [0, 0], sideLabels: ['A', 'B'], seatLabels: [], mySeat: 0, mySide: 0 });
    expect(empty.sides[0]!.books).toBe(0);
    expect(empty.moments).toEqual([]);
  });
  it('nuke callout (league data wave): the stamped seat is named for their hand', () => {
    const nuked: PostgameHand[] = [
      { handNo: 3, tricksWon: [4, 3, 4, 2], nuke: { seat: 2 }, sides: [
        { side: 0, tricks: 8, points: 40, nils: [] },
        { side: 1, tricks: 5, points: 20, nils: [] },
      ] },
      { handNo: 4, tricksWon: [4, 3, 4, 2], nuke: { seat: 0 }, sides: [
        { side: 0, tricks: 8, points: 30, nils: [] },
        { side: 1, tricks: 5, points: 10, nils: [] },
      ] },
    ];
    const pgN = buildPostgame({ history: nuked, finalScores: [70, 30], sideLabels: ['You + Pat', 'Rivals'], seatLabels: ['You', 'Rex', 'Pat', 'Sal'], mySeat: 0, mySide: 0 });
    expect(pgN.moments).toContain('☢ Pat blew the nuke in hand 3');
    expect(pgN.moments).toContain('☢ You blew the nuke in hand 4');
    // and the pre-stamp history above carries no nuke moment at all
    expect(pg.moments.some((m) => m.includes('nuke'))).toBe(false);
  });
});

describe('postgame placement', () => {
  it('renders on the rewards screen and is built at stash time in Table', () => {
    expect(read('../src/GameOverRewards.tsx')).toContain('data-testid="postgame-report"');
    const table = read('../src/Table.tsx');
    expect(table).toContain('data.postgame = buildPostgame({');
    expect(table).toContain('finalScores: st.result.finalScores');
  });
});
