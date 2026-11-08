import { describe, expect, it } from 'vitest';
import { FakeEnv } from './harness';

/**
 * Seat/team integrity — owner report 2026-11-06 21:57 EST: mid-game his teammate
 * "got switched to the other team"; when he moved to join her side, "the team
 * names got swapped". In partnership, side is derived (seat % 2), so a side can
 * only change with a seat — these tests pin where seats and names can cross.
 *
 * Two tests are PROOFS (they pass on master: the surfaces that cannot cross).
 * Two are CONVICTIONS (they assert the safe invariant and FAIL on master).
 */

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

describe('seat/team integrity (owner report 2026-11-06)', () => {
  it('PROOF: a seated player cannot move seats mid-game — their side cannot change under them', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Partner');
    env.send('b', { t: 'sit', seat: 2 });
    env.send('a', { t: 'start' });
    env.advance(2000);
    expect(env.room.data.phase).toBe('playing');
    env.send('b', { t: 'sit', seat: 1 });
    expect(env.errors('b').at(-1)!.code).toBe('IN_GAME');
    const seats = env.last('a', 'state')!.room.seats;
    expect(seats[2]).toMatchObject({ kind: 'human', name: 'Partner' });
    expect(seats[1]!.kind).not.toBe('human');
  });

  it('PROOF: a reconnect with the same token returns the player to the same seat', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    const b = env.join('b', 'Partner');
    env.send('b', { t: 'sit', seat: 2 });
    env.send('a', { t: 'start' });
    env.advance(2000);
    const b2 = env.join('b2', 'Partner', b.token);
    expect(b2.pid).toBe(b.pid);
    expect(env.last('b2', 'state')!.room.seats[2]).toMatchObject({ kind: 'human', name: 'Partner' });
  });

  it('CONVICTION (M2): a team name stays glued to the side after its namer moves to the other side', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Partner');
    env.send('b', { t: 'sit', seat: 2 });
    env.send('a', { t: 'teamName', name: 'Homies' });
    expect(env.last('a', 'state')!.room.teamNames).toEqual(['Homies', null]);
    // lobby seat moves are free: the host crosses to the other side to sit with them
    env.send('a', { t: 'sit', seat: 3 });
    const room = env.last('a', 'state')!.room;
    expect(room.seats[3]).toMatchObject({ kind: 'human', name: 'Host' });
    // SAFE INVARIANT: a side's name belongs to the players sitting on that side.
    // The side the namer left (his partner sits there alone now) must not keep
    // wearing his name — on master it does, so the two names read swapped.
    expect(room.teamNames![0]).toBeNull();
  });

  it('CONVICTION (M3): linking an account teleports a seated player to the other seat mid-game', () => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Her');
    env.send('a', { t: 'sit', seat: 0 });
    const b = env.join('b', 'Her');
    env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'start' });
    env.advance(2000);
    expect(env.room.data.phase).toBe('playing');
    // Both sessions sat before the account link landed (production hello runs
    // with uid=null; the account is linked only after the ticket verifies).
    env.room.linkUser('a', 'uid-her');
    env.room.linkUser('b', 'uid-her');
    const room = env.last('a', 'state')!.room;
    // SAFE INVARIANT: an account link must not move a seated player. b's session
    // still controls seat 1, and no seat is handed to a bot by the link.
    // On master the fold keeps the older member: seat 1 becomes a bot and b's
    // connection is re-pointed at a's member (seat 0 — the other side).
    expect(room.seats[1]).toMatchObject({ kind: 'human', name: 'Her' });
    expect(env.last('b', 'welcome')!.you).toBe(b.pid);
    expect(a.pid).not.toBe(b.pid);
  });
});

/**
 * The fix pins (owner bundle, 2026-11-08): names follow their namer, renames
 * lock at game start, and the account fold can never move a seated player —
 * while the ordinary second-tab fold (one member seated, one watching) and
 * the lobby fold (second seat released as a vacancy) keep working.
 */
describe('seat/team fix pins (owner bundle 2026-11-08)', () => {
  it('M2: the name lands on the side the namer moved TO, not just off the side they left', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Partner');
    env.send('b', { t: 'sit', seat: 2 });
    env.send('a', { t: 'teamName', name: 'Homies' });
    env.send('a', { t: 'sit', seat: 3 });
    expect(env.last('a', 'state')!.room.teamNames).toEqual([null, 'Homies']);
  });

  it('M2: a name owned by a member still seated on the destination side wins — the carried name is dropped', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('c', 'Rival');
    env.send('c', { t: 'sit', seat: 1 });
    env.send('a', { t: 'teamName', name: 'Homies' });
    env.send('c', { t: 'teamName', name: 'Rivals' });
    env.send('a', { t: 'sit', seat: 3 });
    expect(env.last('a', 'state')!.room.teamNames).toEqual([null, 'Rivals']);
  });

  it('M2: a rename from the partner seat takes ownership — the name then follows THAT member', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Partner');
    env.send('b', { t: 'sit', seat: 2 });
    env.send('a', { t: 'teamName', name: 'Homies' });
    env.send('b', { t: 'teamName', name: 'New Crew' });
    expect(env.last('a', 'state')!.room.teamNames).toEqual(['New Crew', null]);
    env.send('b', { t: 'sit', seat: 1 });
    expect(env.last('a', 'state')!.room.teamNames).toEqual([null, 'New Crew']);
  });

  it('M2: an unseated namer moves nothing — the follow fires when they sit again, on either side', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'teamName', name: 'Homies' });
    env.send('a', { t: 'stand' });
    expect(env.last('a', 'state')!.room.teamNames).toEqual(['Homies', null]);
    env.send('a', { t: 'sit', seat: 1 });
    expect(env.last('a', 'state')!.room.teamNames).toEqual([null, 'Homies']);
  });

  it('M2: clearing a name clears its ownership — nothing follows the mover afterwards', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'teamName', name: 'Homies' });
    env.send('a', { t: 'teamName', name: '' });
    env.send('a', { t: 'sit', seat: 3 });
    expect(env.last('a', 'state')!.room.teamNames).toEqual([null, null]);
  });

  it('M2: a rename while the game is playing is refused IN_GAME and the names do not change', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Partner');
    env.send('b', { t: 'sit', seat: 2 });
    env.send('a', { t: 'teamName', name: 'Homies' });
    env.send('a', { t: 'start' });
    env.advance(2000);
    expect(env.room.data.phase).toBe('playing');
    // (the all-bot side gets its fun name at game start — that is startSeries,
    // not a rename; the pin is that MY rename changes nothing from here)
    const before = env.last('a', 'state')!.room.teamNames;
    expect(before![0]).toBe('Homies');
    env.send('a', { t: 'teamName', name: 'New Name' });
    expect(env.errors('a').at(-1)!.code).toBe('IN_GAME');
    expect(env.last('a', 'state')!.room.teamNames).toEqual(before);
  });

  it('M3: the lobby fold still works — the second seat is released as an EMPTY vacancy, never a bot', () => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Her');
    env.send('a', { t: 'sit', seat: 0 });
    const b = env.join('b', 'Her');
    env.send('b', { t: 'sit', seat: 1 });
    env.room.linkUser('a', 'uid-her');
    env.room.linkUser('b', 'uid-her');
    const room = env.last('a', 'state')!.room;
    expect(room.seats[1]).toMatchObject({ kind: 'empty' });
    expect(room.seats[0]).toMatchObject({ kind: 'human', name: 'Her' });
    // the second connection attaches to the kept member, like a second tab
    expect(env.last('b', 'welcome')!.you).toBe(a.pid);
    expect(b.pid).not.toBe(a.pid);
  });

  it('M3: the second-tab fold still works mid-game when only one member is seated', () => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Host');
    env.send('a', { t: 'start' });
    env.advance(2000);
    expect(env.room.data.phase).toBe('playing');
    env.room.linkUser('a', 'uid-host');
    env.room.linkUser('b', 'uid-host');
    const room = env.last('a', 'state')!.room;
    expect(room.seats[0]).toMatchObject({ kind: 'human', name: 'Host' });
    expect(env.last('b', 'welcome')!.you).toBe(a.pid);
  });

  it('M3: the refused fold answers the linking connection with a clear error', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Her');
    env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Her');
    env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'start' });
    env.advance(2000);
    env.room.linkUser('a', 'uid-her');
    env.room.linkUser('b', 'uid-her');
    expect(env.errors('b').at(-1)).toMatchObject({ code: 'ALREADY_SEATED' });
  });
});
