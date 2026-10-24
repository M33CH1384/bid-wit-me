import { describe, expect, it } from 'vitest';
import { dispatchTableMessage } from '../src/dispatch';
import { FakeEnv } from './harness';

/**
 * The story door over the PRODUCTION socket path (2026-10-24 live failure).
 *
 * The room suites join by calling room.message(..., uid) with the account id
 * injected — a contract production never provides. Real dispatch (see
 * dispatch.ts) must run hello with uid=null: the socket binds first, the D1
 * ticket lookup resolves after, and room.linkUser(cid, uid) carries the
 * verified account in. A first-ever story join therefore arrived at the door
 * check with no uid and no member to read one from, and the room refused BOTH
 * pair members at their own table ("This story table is spoken for").
 *
 * These tests drive dispatchTableMessage end to end: hello → ticket verify →
 * linkUser. A ticket-carrying story hello is HELD at the door (no member, no
 * welcome, no refusal) until the account is proven; then the pair check runs
 * under the real uid.
 */

const verify = (tickets: Record<string, string>) =>
  (ticket: string) => Promise.resolve(tickets[ticket] ? { uid: tickets[ticket]! } : null);

const hello = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ t: 'hello', name, ...extra });

function storyRoom(hostUid: string, partnerUid: string | null): FakeEnv {
  const env = new FakeEnv();
  env.room.setupStory('porch', hostUid, partnerUid, 'Host');
  return env;
}

describe('story door over the production dispatch path', () => {
  it('seats both pair members on first join — host first, then partner (A invites B)', async () => {
    const env = storyRoom('ua', 'uc');
    const v = verify({ 'tk-a': 'ua', 'tk-c': 'uc' });

    // The host's hello is processed before the ticket resolves: at that
    // instant nothing may have happened — no member, no welcome, NO refusal.
    env.room.open('h1');
    const p = dispatchTableMessage(env.room, 'h1', hello('Host', { ticket: 'tk-a' }), v);
    expect(env.msgs('h1')).toEqual([]);
    expect(Object.keys(env.room.data.members)).toHaveLength(0);
    await p;
    expect(env.errors('h1')).toEqual([]);
    expect(env.last('h1', 'welcome')).toBeTruthy();
    const hostPid = env.last('h1', 'welcome')!.you;
    expect(env.room.data.members[hostPid]!.seat).toBe(0);

    env.room.open('p1');
    await dispatchTableMessage(env.room, 'p1', hello('Partner', { ticket: 'tk-c' }), v);
    expect(env.errors('p1')).toEqual([]);
    const partnerPid = env.last('p1', 'welcome')!.you;
    expect(env.room.data.members[partnerPid]!.seat).toBe(2);
  });

  it('seats both pair members when the partner enters first (B invites A)', async () => {
    // uc hosts this time; the invited partner (ua) walks in before the host.
    const env = storyRoom('uc', 'ua');
    const v = verify({ 'tk-a': 'ua', 'tk-c': 'uc' });

    env.room.open('p1');
    await dispatchTableMessage(env.room, 'p1', hello('Partner', { ticket: 'tk-a' }), v);
    expect(env.errors('p1')).toEqual([]);
    const partnerPid = env.last('p1', 'welcome')!.you;
    expect(env.room.data.members[partnerPid]!.seat).toBe(2);

    env.room.open('h1');
    await dispatchTableMessage(env.room, 'h1', hello('Host', { ticket: 'tk-c' }), v);
    expect(env.errors('h1')).toEqual([]);
    const hostPid = env.last('h1', 'welcome')!.you;
    expect(env.room.data.members[hostPid]!.seat).toBe(0);
  });

  it('still refuses a genuine third account — at the door, no member created', async () => {
    const env = storyRoom('ua', 'uc');
    const v = verify({ 'tk-x': 'ux' });
    env.room.open('x1');
    await dispatchTableMessage(env.room, 'x1', hello('Stranger', { ticket: 'tk-x' }), v);
    expect(env.errors('x1').map((e) => e.code)).toEqual(['SPOKEN_FOR']);
    expect(env.last('x1', 'welcome')).toBeUndefined();
    expect(env.closed).toContain('x1');
    expect(Object.keys(env.room.data.members)).toHaveLength(0);
  });

  it('refuses a ticketless hello immediately (no account proof is coming)', async () => {
    const env = storyRoom('ua', 'uc');
    const v = verify({});
    env.room.open('g1');
    await dispatchTableMessage(env.room, 'g1', hello('Guest'), v);
    expect(env.errors('g1').map((e) => e.code)).toEqual(['SPOKEN_FOR']);
    expect(Object.keys(env.room.data.members)).toHaveLength(0);
  });

  it('an unverifiable ticket seats nobody and refuses nobody — the hello just never completes', async () => {
    const env = storyRoom('ua', 'uc');
    const v = verify({}); // every ticket resolves null
    env.room.open('b1');
    await dispatchTableMessage(env.room, 'b1', hello('Forged', { ticket: 'tk-forged' }), v);
    expect(env.last('b1', 'welcome')).toBeUndefined();
    expect(env.errors('b1')).toEqual([]);
    expect(Object.keys(env.room.data.members)).toHaveLength(0);
  });

  it('account identity is the exact account id — mixed-case display names never split or merge it', async () => {
    const env = storyRoom('uAbC', 'uXyZ');
    const v = verify({ 'tk-1': 'uAbC', 'tk-2': 'uXyZ', 'tk-3': 'uabc' });
    env.room.open('m1');
    await dispatchTableMessage(env.room, 'm1', hello('LovleyT714', { ticket: 'tk-1' }), v);
    expect(env.errors('m1')).toEqual([]);
    env.room.open('m2');
    await dispatchTableMessage(env.room, 'm2', hello('M33CH', { ticket: 'tk-2' }), v);
    expect(env.errors('m2')).toEqual([]);
    // a case-variant id is a DIFFERENT account, not the same player typed loosely
    env.room.open('m3');
    await dispatchTableMessage(env.room, 'm3', hello('lovleyt714', { ticket: 'tk-3' }), v);
    expect(env.errors('m3').map((e) => e.code)).toEqual(['SPOKEN_FOR']);
    expect(Object.keys(env.room.data.members)).toHaveLength(2);
  });

  it('share-code room: host seats, the bound partner seats, a third is refused', async () => {
    const env = storyRoom('ua', null); // open seat until a joiner binds
    const v = verify({ 'tk-a': 'ua', 'tk-c': 'uc', 'tk-x': 'ux' });
    env.room.open('h1');
    await dispatchTableMessage(env.room, 'h1', hello('Host', { ticket: 'tk-a' }), v);
    expect(env.errors('h1')).toEqual([]);
    expect(env.room.data.members[env.last('h1', 'welcome')!.you]!.seat).toBe(0);

    // the HTTP room-join binds the second seat to uc (story/routes room-join)
    expect(env.room.bindStoryPartner('uc')).toBe(true);

    env.room.open('p1');
    await dispatchTableMessage(env.room, 'p1', hello('Partner', { ticket: 'tk-c' }), v);
    expect(env.errors('p1')).toEqual([]);
    expect(env.room.data.members[env.last('p1', 'welcome')!.you]!.seat).toBe(2);

    env.room.open('x1');
    await dispatchTableMessage(env.room, 'x1', hello('Stranger', { ticket: 'tk-x' }), v);
    expect(env.errors('x1').map((e) => e.code)).toEqual(['SPOKEN_FOR']);
  });

  it('reconnect by member token seats immediately — no ticket round-trip needed', async () => {
    const env = storyRoom('ua', 'uc');
    const v = verify({ 'tk-a': 'ua', 'tk-c': 'uc' });
    env.room.open('h1');
    await dispatchTableMessage(env.room, 'h1', hello('Host', { ticket: 'tk-a' }), v);
    env.room.open('p1');
    await dispatchTableMessage(env.room, 'p1', hello('Partner', { ticket: 'tk-c' }), v);
    const token = env.last('p1', 'welcome')!.token;

    // partner drops, returns on a fresh socket carrying only the member token:
    // the member match supplies the account, so the welcome is synchronous and
    // never waits on (or needs) ticket verification or linkUser.
    env.room.close('p1');
    env.clear();
    env.room.open('p2');
    await dispatchTableMessage(env.room, 'p2', hello('Partner', { token }), verify({}));
    expect(env.errors('p2')).toEqual([]);
    const w = env.last('p2', 'welcome');
    expect(w).toBeTruthy();
    expect(env.room.data.members[w!.you]!.seat).toBe(2);
  });
});
