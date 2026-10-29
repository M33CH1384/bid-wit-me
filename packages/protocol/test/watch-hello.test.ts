import { describe, expect, it } from 'vitest';
import { parseClientMsg } from '../src/index';

/**
 * Streaming package: the hello's `watch` flag survives wire sanitization —
 * and only a literal true does. The flag is what marks a member watch-only
 * in the room (spectate, never sit, never post chat).
 */
describe('hello watch flag', () => {
  it('keeps watch: true', () => {
    expect(parseClientMsg({ t: 'hello', name: 'Guest-AB12', watch: true }))
      .toMatchObject({ t: 'hello', name: 'Guest-AB12', watch: true });
    expect(parseClientMsg(JSON.stringify({ t: 'hello', name: 'Guest-AB12', watch: true })))
      .toMatchObject({ t: 'hello', watch: true });
  });

  it('drops non-true watch values (no truthy smuggling)', () => {
    for (const watch of [false, 1, 'true', {}, []]) {
      const m = parseClientMsg({ t: 'hello', name: 'Guest-AB12', watch });
      expect(m && 'watch' in m).toBe(false);
    }
  });

  it('a plain hello carries no watch flag (the play door)', () => {
    const m = parseClientMsg({ t: 'hello', name: 'Host' });
    expect(m && 'watch' in m).toBe(false);
  });
});
