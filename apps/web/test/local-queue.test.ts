import { describe, expect, it } from 'vitest';
import { enqueueLocal, keepQueued, shouldQueue, type LocalGamePost } from '../src/localStats';

const item = (id: string): LocalGamePost => ({ clientGameId: id, startedAt: 1, endedAt: 2, names: [], teamNames: null, game: {} as LocalGamePost['game'] });

describe('offline stats queue', () => {
  it('queues a signed-in or still-loading player, not a known guest', () => {
    expect(shouldQueue(false, null)).toBe(true);
    expect(shouldQueue(true, 'ed41194162a842d61600fdf573d9a9d5')).toBe(true);
    expect(shouldQueue(true, null)).toBe(false);
  });
  it('dedupes on the client game id and keeps the newest copy', () => {
    const next = enqueueLocal([item('a'), item('b')], { ...item('a'), endedAt: 9 });
    expect(next.map((x) => x.clientGameId)).toEqual(['b', 'a']);
    expect(next[1]!.endedAt).toBe(9);
  });
  it('drops saved and rejected posts, and keeps rate limits and network failures', () => {
    expect(keepQueued(200)).toBe(false);
    expect(keepQueued(400)).toBe(false);
    expect(keepQueued(413)).toBe(false);
    expect(keepQueued(401)).toBe(true);
    expect(keepQueued(429)).toBe(true);
    expect(keepQueued(500)).toBe(true);
  });
});
