import { describe, expect, it } from 'vitest';
import { platePersona } from '@spades/bots';
import { FakeEnv } from './harness';

describe('bot plate tags', () => {
  it('three bots at one table do not share a tag', () => {
    for (let i = 0; i < 12; i++) {
      const env = new FakeEnv();
      env.join('a', 'Meech');
      env.send('a', { t: 'sit', seat: 0 });
      for (const seat of [1, 2, 3]) env.send('a', { t: 'addBot', seat });
      const names = env.room.data.seats.flatMap((s) => (s.kind === 'bot' ? [s.name] : []));
      const tags = names.map((n) => platePersona(n));
      expect(new Set(tags).size, `${names.join(', ')} → ${tags.join(', ')}`).toBe(3);
    }
  });
});
