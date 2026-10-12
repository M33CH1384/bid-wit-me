import { describe, expect, it } from 'vitest';
import { BURST_MS, clearBurst, getBurst, startBurst, subscribeBurst } from '../src/jokerFx';

describe('detonation clock', () => {
  it('stays up for the canvas blast', () => {
    expect(BURST_MS.BJ).toBe(1800);
    expect(BURST_MS.LJ).toBe(500);
  });
});

describe('burst clock', () => {
  it('notifies subscribers and clears', () => {
    const seen: string[] = [];
    const off = subscribeBurst(() => seen.push(getBurst()?.kind ?? 'off'));
    startBurst('BJ', false, 1000);
    expect(getBurst()).toMatchObject({ start: 1000, kind: 'BJ', reduced: false, elapsed: 0 });
    clearBurst();
    expect(getBurst()).toBeNull();
    expect(seen).toEqual(['BJ', 'off']);
    off();
  });
});
