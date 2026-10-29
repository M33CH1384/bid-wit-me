import { describe, expect, it } from 'vitest';
import { LIMITS } from '@spades/protocol';
import { FakeEnv } from './harness';

/**
 * Streaming package — the watch door (owner, 2026-10-29).
 *
 * A hello carrying `watch: true` (the /watch/<CODE> routes, guests included)
 * marks the member watch-only: they receive the redacted spectator view and
 * nothing else, they count against the ordinary spectator cap, and they can
 * never sit or post chat from that door. Arriving later through the play
 * door (a hello without `watch`, same seat token) clears the flag while the
 * member is seatless. Story rooms refuse watch hellos like everyone else.
 */

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

function watchJoin(env: FakeEnv, cid: string, name: string, token?: string) {
  env.room.open(cid);
  env.send(cid, { t: 'hello', name, watch: true, ...(token ? { token } : {}) });
  const w = env.last(cid, 'welcome');
  return { pid: w?.you, token: w?.token };
}

/** A running game: one human host, three bots. */
function runningGame() {
  const env = new FakeEnv(undefined, FAST);
  env.join('h', 'Host');
  env.send('h', { t: 'sit', seat: 0 });
  env.send('h', { t: 'start' });
  env.advance(200);
  return env;
}

describe('watch door', () => {
  it('a watch hello joins as a watch-only member and never becomes host', () => {
    const env = new FakeEnv(undefined, FAST);
    const g = watchJoin(env, 'g', 'Guest-AB12');
    expect(g.pid).toBeTruthy();
    expect(env.room.data.members[g.pid!]!.watchOnly).toBe(true);
    expect(env.room.data.members[g.pid!]!.seat).toBeNull();
    // the watcher is not the host: the next ordinary join takes the gavel
    expect(env.room.data.hostId).not.toBe(g.pid);
    const h = env.join('h', 'Host');
    expect(env.room.data.hostId).toBe(h.pid);
  });

  it('watch-only members cannot sit, in the lobby or mid-game', () => {
    const env = new FakeEnv(undefined, FAST);
    watchJoin(env, 'g', 'Guest-AB12');
    env.send('g', { t: 'sit', seat: 1 });
    expect(env.errors('g').at(-1)!.code).toBe('WATCH_ONLY');

    const env2 = runningGame();
    watchJoin(env2, 'w', 'Guest-CD34');
    env2.send('w', { t: 'sit', seat: 1 });
    expect(env2.errors('w').at(-1)!.code).toBe('WATCH_ONLY');
    expect(env2.room.data.members[env2.last('w', 'welcome')!.you]!.seat).toBeNull();
  });

  it('watch-only members read chat but cannot post or react', () => {
    const env = runningGame();
    // a line exists to react to (the host posts once the game is running)
    env.send('h', { t: 'chat', text: 'gl all' });
    const line = env.room.data.chat.at(-1)!;
    expect(line.text).toBe('gl all');

    const w = watchJoin(env, 'w', 'Guest-EF56');
    // the watcher RECEIVES the chat history in the welcome…
    expect(env.last('w', 'welcome')!.chat.some((l) => l.text === 'gl all')).toBe(true);
    // …but a post is refused and never broadcast
    env.clear();
    env.send('w', { t: 'chat', text: 'spam spam' });
    expect(env.errors('w').at(-1)!.code).toBe('WATCH_ONLY');
    expect(env.msgs('h').filter((m) => m.t === 'chat' && m.text.includes('spam'))).toEqual([]);
    expect(env.room.data.chat.some((l) => l.text.includes('spam'))).toBe(false);
    // …and a reaction is dropped silently (no chatReact reaches anyone)
    env.send('w', { t: 'react', id: line.id, emoji: '🔥' });
    expect(env.msgs('h').filter((m) => m.t === 'chatReact')).toEqual([]);
    expect(env.msgs('w').filter((m) => m.t === 'error')).toHaveLength(1); // only the chat refusal
    void w;
  });

  it('the play door clears watch-only for a seatless member (same seat token)', () => {
    const env = new FakeEnv(undefined, FAST);
    const g = watchJoin(env, 'g', 'Guest-GH78');
    const pid = g.pid!;
    const token = g.token!;
    // same browser, new socket, arriving through /t/<CODE> this time
    env.room.open('g2');
    env.send('g2', { t: 'hello', name: 'Guest-GH78', token });
    expect(env.last('g2', 'welcome')!.you).toBe(pid);
    expect(env.room.data.members[pid]!.watchOnly).toBeUndefined();
    env.send('g2', { t: 'sit', seat: 2 });
    expect(env.room.data.members[pid]!.seat).toBe(2);
  });

  it('guests count against the same spectator cap', () => {
    const env = runningGame();
    for (let i = 0; i < LIMITS.spectators; i++) {
      const cid = `w${i}`;
      const w = watchJoin(env, cid, `Guest-${i}`);
      expect(w.pid, `watcher ${i} admitted`).toBeTruthy();
    }
    const over = watchJoin(env, 'w-over', 'Guest-OVER');
    expect(over.pid).toBeUndefined();
    expect(env.errors('w-over').at(-1)!.code).toBe('TABLE_FULL');
    expect(env.closed).toContain('w-over');
  });

  it('REDACTION: a guest watcher’s payloads carry no seated hand — ever', () => {
    const env = runningGame();
    const g = env.room.data.game!;
    expect(g.phase === 'bidding' || g.phase === 'playing').toBe(true);
    const handsJson = g.hands.map((h) => JSON.stringify(h));
    // control: the seated host's own view DOES hold their real hand
    const hostView = env.last('h', 'state')!.view!;
    expect(hostView.hand).toHaveLength(g.hands[0]!.length);
    expect(new Set(hostView.hand)).toEqual(new Set(g.hands[0]));

    watchJoin(env, 'w', 'Guest-MARK');
    const states = env.msgs('w').filter((m) => m.t === 'state');
    expect(states.length).toBeGreaterThan(0);
    for (const st of states) {
      expect(st.spectator).toBe(true);
      expect(st.view!.hand).toBeNull();
      expect(st.view!.handCounts).toEqual(g.hands.map((h) => h.length));
      // no seat's dealt hand appears anywhere in anything the watcher was sent
      const wire = JSON.stringify(st);
      for (const hj of handsJson) expect(wire).not.toContain(hj);
    }
    // and nothing else on the wire to the watcher leaks a hand either
    const allWire = JSON.stringify(env.msgs('w'));
    for (const hj of handsJson) expect(allWire).not.toContain(hj);
  });

  it('story rooms refuse a guest watch hello at the door (SPOKEN_FOR)', () => {
    const env = new FakeEnv();
    env.room.setupStory('porch', 'ua', 'uc', 'Host');
    env.room.open('g');
    env.send('g', { t: 'hello', name: 'Guest-STORY', watch: true });
    expect(env.errors('g').at(-1)!.code).toBe('SPOKEN_FOR');
    expect(env.last('g', 'welcome')).toBeUndefined();
    expect(Object.keys(env.room.data.members)).toHaveLength(0);
    expect(env.closed).toContain('g');
  });
});
