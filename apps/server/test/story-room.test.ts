/**
 * Story co-op rooms (spec §2): reserved pair seats, story bots at tier skill,
 * the both-ready phase machine, Dee covering a vacated seat, concede, and the
 * witnessed game-over — with NO regular game record ever written.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { GameAction } from '@spades/protocol';
import { FakeEnv } from './harness';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

function storyRoom(stopId = 'porch') {
  const env = new FakeEnv(undefined, FAST);
  env.room.setupStory(stopId, 'ua', 'uc');
  const host = env.join('a', 'Host', undefined, 'ua');
  const partner = env.join('c', 'Partner', undefined, 'uc');
  return { env, host, partner };
}

function readyBoth(env: FakeEnv) {
  env.send('a', { t: 'storyReady' });
  env.send('c', { t: 'storyReady' });
}

function toGame(env: FakeEnv) {
  readyBoth(env); // lobby → tape
  readyBoth(env); // tape → scene
  readyBoth(env); // scene → game
  env.advance(50); // pre-deal window is 0 in the harness: the deal lands
}

function playTurn(env: FakeEnv, cids: string[]): boolean {
  for (const cid of cids) {
    const st = env.last(cid, 'state');
    const v = st?.view;
    if (!v || st.room.phase !== 'playing') continue;
    if (v.phase === 'handOver') { env.send(cid, { t: 'next' }); continue; }
    if (v.turn !== v.seat) continue;
    const a = chooseBotAction(v, 'normal');
    if (!a) continue;
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', card: a.card } : a.type === 'runIt' ? { type: 'runIt' } : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
    env.send(cid, { t: 'act', action, seq: st.room.seq });
    return true;
  }
  return false;
}

describe('story room setup', () => {
  it('seats the pair across (0/2) and the stop\u2019s pair as tier bots (1/3)', () => {
    const { env } = storyRoom('porch');
    const d = env.room.data;
    expect(d.story).toMatchObject({ track: 'pair:ua:uc', stopId: 'porch', phase: 'lobby' });
    expect(d.private).toBe(true);
    expect(d.seats[0]).toMatchObject({ kind: 'human' });
    expect(d.seats[2]).toMatchObject({ kind: 'human' });
    expect(d.seats[1]).toMatchObject({ kind: 'bot', name: 'Uncle Ray', level: 'novice' }); // gentle tier
    expect(d.seats[3]).toMatchObject({ kind: 'bot', name: 'Pat', level: 'novice' });
    expect(d.rules.targetScore).toBe(250); // the Porch twist, built server-side
    expect(d.rules.turnTimerSec).toEqual({ bid: 45, play: 45 });
    expect(env.room.listing()).toBeNull(); // never in Open Tables
  });

  it('turns away a third account at the door (no spectators in v1)', () => {
    const { env } = storyRoom();
    env.room.open('x');
    env.room.message('x', JSON.stringify({ t: 'hello', name: 'Snoop' }), 'ux');
    expect(env.errors('x').at(-1)).toMatchObject({ code: 'SPOKEN_FOR' });
    expect(env.closed).toContain('x');
    expect(Object.values(env.room.data.members).some((m) => m.name === 'Snoop')).toBe(false);
  });

  it('locks the regular table controls (start / config / bots / kick)', () => {
    const { env } = storyRoom();
    env.send('a', { t: 'start' });
    expect(env.errors('a').at(-1)).toMatchObject({ code: 'LOCKED' });
    env.send('a', { t: 'addBot', seat: 1 });
    expect(env.errors('a').at(-1)).toMatchObject({ code: 'LOCKED' });
  });
});

describe('story phase machine', () => {
  it('advances lobby → tape → scene → game only when BOTH are ready', () => {
    const { env } = storyRoom();
    env.send('a', { t: 'storyReady' });
    expect(env.room.data.story!.phase).toBe('lobby'); // one ready is not enough
    env.send('c', { t: 'storyReady' });
    expect(env.room.data.story!.phase).toBe('tape');
    readyBoth(env);
    expect(env.room.data.story!.phase).toBe('scene');
    readyBoth(env);
    expect(env.room.data.story!.phase).toBe('game');
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.game).not.toBeNull();
  });

  it('the host may pick a different stop in the lobby; the guest may not', () => {
    const { env } = storyRoom();
    env.send('c', { t: 'storyReady', stopId: 'barbershop' });
    expect(env.room.data.story!.stopId).toBe('porch'); // guest's pick ignored
    env.send('a', { t: 'storyReady', stopId: 'barbershop' });
    expect(env.room.data.story!.stopId).toBe('barbershop');
    expect(env.room.data.seats[1]).toMatchObject({ kind: 'bot', name: 'Mr. Coleman' });
    expect(env.room.data.rules.mode).toBe('aceDown'); // the Barbershop twist
  });
});

describe('story match', () => {
  it('plays to a finish and writes exactly one witness — and no game record', () => {
    const { env } = storyRoom();
    toGame(env);
    for (let i = 0; i < 20000 && env.room.data.phase === 'playing'; i++) {
      if (!playTurn(env, ['a', 'c'])) env.advance(100);
    }
    expect(env.room.data.phase).toBe('over');
    expect(env.room.data.story!.phase).toBe('outro');
    expect(env.storyResults.length).toBe(1);
    const w = env.storyResults[0]!;
    expect(w).toMatchObject({ track: 'pair:ua:uc', stopId: 'porch', uidA: 'ua', uidB: 'uc' });
    expect(w.gameId).toBe(env.last('a', 'state')!.room.story!.gameId);
    const winners = env.room.data.game!.result!.winners;
    expect(w.won).toBe(winners.includes(0));
    expect(w.facts.handsPlayed).toBeGreaterThan(0);
    expect(env.records.length).toBe(0); // unrated: no stats/Elo record, ever
  });

  it('concede ends the match as a witnessed pair loss', () => {
    const { env } = storyRoom();
    toGame(env);
    env.send('c', { t: 'concede' });
    expect(env.room.data.phase).toBe('over');
    expect(env.room.data.story!.phase).toBe('outro');
    expect(env.room.data.story!.concededBy).toBe('Partner');
    expect(env.storyResults.length).toBe(1);
    expect(env.storyResults[0]).toMatchObject({ won: false, track: 'pair:ua:uc', stopId: 'porch' });
    const chat = env.msgs('a').filter((m) => m.t === 'chat').map((m) => (m as { line: { text: string } }).line.text);
    expect(chat.some((t) => t.includes('conceded the match'))).toBe(true);
  });

  it('the outro ready-pair runs it back at the same stop by default', () => {
    const { env } = storyRoom();
    toGame(env);
    env.send('c', { t: 'concede' });
    readyBoth(env);
    expect(env.room.data.story!.phase).toBe('tape');
    expect(env.room.data.story!.stopId).toBe('porch');
  });
});

describe('Dee covers (spec §2.4)', () => {
  it('a partner gone past the grace is covered by Dee, and reclaims on return', () => {
    const { env, partner } = storyRoom();
    toGame(env);
    env.room.close('c'); // socket drop
    env.advance(6000); // past the 5s test grace
    const seat = env.room.data.seats[2]!;
    expect(seat).toMatchObject({ kind: 'bot', name: 'Dee', level: 'novice', was: 'Partner', replacedPid: partner.pid });
    expect(env.room.data.members[partner.pid]!.seat).toBeNull(); // still a member
    const chat = env.msgs('a').filter((m) => m.t === 'chat').map((m) => (m as { line: { text: string } }).line.text);
    expect(chat.some((t) => t.includes("Dee's covering for Partner"))).toBe(true);
    // they come back: the shipped reclaim hands the seat back
    env.join('c2', 'Partner', partner.token, 'uc');
    expect(env.room.data.seats[2]).toMatchObject({ kind: 'human', playerId: partner.pid });
  });

  it('a deliberate leave mid-match is Dee-covered and the leaver stays a member', () => {
    const { env, host } = storyRoom();
    toGame(env);
    env.send('a', { t: 'leave' });
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'bot', name: 'Dee', replacedPid: host.pid });
    expect(env.room.data.members[host.pid]).toBeDefined();
    expect(env.room.data.members[host.pid]!.seat).toBeNull();
    expect(env.records.length).toBe(0); // no abandon record for a story room
  });
});
