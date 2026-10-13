import { describe, expect, it } from 'vitest';
import { FELT } from '../src/three/layout';
import { TABLE_BLAST_REACH, blastPose, clientSeesNuke, nukeBlastCards } from '../src/three/blastSweep';

const trick = [
  { card: 'BJ' as const, seat: 0 },
  { card: '3H' as const, seat: 1 },
  { card: 'LJ' as const, seat: 2 },
  { card: '4C' as const, seat: 3 },
];

describe('nuke sweeps every card on the felt', () => {
  it('targets the trick, the piles, and the other cards on the table, not the hand', () => {
    const items = [
      { key: 'h1-BJ' },
      { key: 'h1-LJ' },
      { key: 'h1-3H' },
      { key: 'h1-4C' },
      { key: 'pile-0' },
      { key: 'h1-b1-0' },
      { key: 'hand-0', hand: true },
    ];
    expect(nukeBlastCards(items).map((it) => it.key)).toEqual(['h1-BJ', 'h1-LJ', 'h1-3H', 'h1-4C', 'pile-0', 'h1-b1-0']);
    expect(TABLE_BLAST_REACH).toBeGreaterThan(FELT.hx + FELT.hz / 2);
  });

  it('carries a table card off the felt and does not spring it back under the cloud', () => {
    const kick = blastPose(0.2, 'table');
    const clear = blastPose(0.7, 'table');
    const cloud = blastPose(2.4, 'table');
    expect(kick && kick.out).toBeGreaterThan(0);
    expect(clear && clear.out).toBeGreaterThan(FELT.hx);
    expect(cloud && cloud.out).toBe(TABLE_BLAST_REACH);
    expect(cloud && clear && cloud.out).toBeGreaterThanOrEqual(clear!.out);
    expect(blastPose(-0.3, 'table')).toBeNull();
  });

  it('still lets a Full Nuke hand card spring home', () => {
    const kick = blastPose(0.2, 'hand');
    const home = blastPose(2.2, 'hand');
    expect(kick && kick.out).toBeGreaterThan(0.05);
    expect(home && home.out).toBeLessThan(0.02);
  });

  it('cues the blast for a seated player and a spectator from the same trick, and not for Run it!', () => {
    expect(clientSeesNuke(trick, false)).toBe(true);
    expect(clientSeesNuke(trick, false)).toBe(true);
    expect(clientSeesNuke(trick, true)).toBe(false);
    expect(clientSeesNuke([{ card: 'BJ', run: true }, { card: 'LJ', run: true }], false)).toBe(false);
    expect(clientSeesNuke([{ card: 'BJ' }, { card: '2H' }], false)).toBe(false);
  });
});
