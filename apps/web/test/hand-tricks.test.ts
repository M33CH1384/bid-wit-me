/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Trick } from '@spades/rules';
import { clearHandTricks, handTricksFor, rememberHandTricks } from '../src/handTricks';

const trick = (n: number): Trick => ({ leader: 0, winner: 1, plays: [{ seat: 0, card: `${n}H` }, { seat: 1, card: `${n}S` }] } as unknown as Trick);

describe('handTricks: each finished hand keeps its play-by-play for the score pad', () => {
  beforeEach(() => clearHandTricks());

  it('files a hand and reads it back, per hand number', () => {
    rememberHandTricks('seedA', 1, [trick(2), trick(3)]);
    rememberHandTricks('seedA', 2, [trick(4)]);
    expect(handTricksFor('seedA', 1)).toHaveLength(2);
    expect(handTricksFor('seedA', 2)).toHaveLength(1);
    expect(handTricksFor('seedA', 3)).toBeNull();
  });

  it('a different game replaces the record; no seed or no tricks files nothing', () => {
    rememberHandTricks('seedA', 1, [trick(2)]);
    rememberHandTricks('seedB', 1, [trick(5)]);
    expect(handTricksFor('seedA', 1)).toBeNull();
    expect(handTricksFor('seedB', 1)).toHaveLength(1);
    rememberHandTricks(null, 2, [trick(6)]);
    rememberHandTricks('seedB', 3, []);
    expect(handTricksFor('seedB', 2)).toBeNull();
    expect(handTricksFor('seedB', 3)).toBeNull();
  });

  it('a shorter re-file never overwrites the full hand, and the copy is its own', () => {
    const full = [trick(2), trick(3), trick(4)];
    rememberHandTricks('seedA', 1, full);
    rememberHandTricks('seedA', 1, full.slice(0, 1));
    expect(handTricksFor('seedA', 1)).toHaveLength(3);
    (full[0]!.plays as { card: string }[])[0]!.card = 'XX';
    expect(handTricksFor('seedA', 1)![0]!.plays[0]!.card).toBe('2H');
  });

  it('survives a reload: read back from storage', () => {
    rememberHandTricks('seedA', 4, [trick(9)]);
    const raw = localStorage.getItem('bwm.handTricks')!;
    clearHandTricks();
    localStorage.setItem('bwm.handTricks', raw);
    expect(handTricksFor('seedA', 4)).toHaveLength(1);
  });
});
