import { describe, expect, it } from 'vitest';
import { clientDeadline } from '../src/online/useOnline';

describe('turn countdown', () => {
  it('keeps one target so the seconds move as the client clock moves', () => {
    const serverNow = 1_000_000;
    const deadline = serverNow + 30_000;
    const seenAt = 5_000;
    const target = clientDeadline(deadline, serverNow, seenAt);
    expect(target).toBe(seenAt + 30_000);
    expect(Math.ceil((target! - (seenAt + 12_000)) / 1000)).toBe(18);
    // Rebuilding the target 12s later from the same snapshot would freeze the display at 30s.
    const slid = clientDeadline(deadline, serverNow, seenAt + 12_000)!;
    expect(Math.ceil((slid - (seenAt + 12_000)) / 1000)).toBe(30);
  });
});
