import { describe, expect, it } from 'vitest';
import { FakeEnv } from './harness';

describe('rejoin when driving the table throws', () => {
  it('still sends state after welcome, so the loader is not stuck on hello', () => {
    const env = new FakeEnv();
    env.join('a', 'Ada');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'start' });
    const d = env.room.data;
    const g = d.game!;
    if (g.phase !== 'bidding' && g.phase !== 'playing') g.phase = 'playing';
    g.turn = 0;
    (d.rules as { turnTimerSec?: unknown }).turnTimerSec = undefined;
    env.clear();
    env.join('b', 'Bea');
    expect(env.last('b', 'welcome')?.code).toBe('ABCDE');
    expect(env.last('b', 'state')?.room.code).toBe('ABCDE');
    expect(env.errors('b').map((e) => e.code)).not.toContain('INTERNAL');
  });
});
