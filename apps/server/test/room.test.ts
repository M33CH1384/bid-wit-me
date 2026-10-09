import { describe, expect, it } from 'vitest';
import { type Card, makeRules } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { GameAction } from '@spades/protocol';
import { FakeEnv } from './harness';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

function fourHumans(env = new FakeEnv(undefined, FAST)) {
  const ps = ['a', 'b', 'c', 'd'].map((cid, i) => {
    const p = env.join(cid, ['Dee', 'Ray', 'Kim', 'Jo'][i]!);
    env.send(cid, { t: 'sit', seat: i });
    return { cid, ...p };
  });
  return { env, ps };
}

/** Acts for whoever's turn it is via the client protocol, using the bot brain on that client's own view. */
function playTurn(env: FakeEnv, cids: string[]): boolean {
  for (const cid of cids) {
    const st = env.last(cid, 'state');
    const v = st?.view;
    if (!v || st.room.phase !== 'playing') continue;
    if (v.phase === 'handOver') { env.send(cid, { t: 'next' }); continue; }
    if (v.turn !== v.seat) continue;
    const a = chooseBotAction(v, 'normal');
    if (!a) continue;
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', card: a.card } : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
    env.send(cid, { t: 'act', action });
    return true;
  }
  return false;
}

describe('lobby', () => {
  it('first player is host; welcome carries a token; others are not host', () => {
    const env = new FakeEnv();
    const a = env.join('a', 'Demetrius');
    const b = env.join('b', 'Ray');
    expect(a.token).toHaveLength(32);
    const room = env.last('b', 'state')!.room;
    expect(room.hostId).toBe(a.pid);
    expect(room.members.map((m) => m.playerId)).toEqual([a.pid, b.pid]);
  });

  it('cleans names (length, control chars, profanity)', () => {
    const env = new FakeEnv();
    env.join('a', '  A\u0000very   long name that goes on and on  ');
    env.join('b', 'shit');
    const m = env.last('b', 'state')!.room.members;
    expect(m[0]!.name).toBe('A very long name tha');
    expect(m[1]!.name).toBe('Player');
  });

  it('seat picking: taken seats are refused; partners sit across', () => {
    const env = new FakeEnv();
    env.join('a', 'A'); env.join('b', 'B');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 0 });
    expect(env.errors('b').at(-1)!.code).toBe('SEAT_TAKEN');
    env.send('b', { t: 'sit', seat: 2 });
    const seats = env.last('a', 'state')!.room.seats;
    expect(seats[0]).toMatchObject({ kind: 'human', name: 'A' });
    expect(seats[2]).toMatchObject({ kind: 'human', name: 'B' });
    // moving seats frees the old one
    env.send('b', { t: 'sit', seat: 1 });
    expect(env.last('a', 'state')!.room.seats[2]).toEqual({ kind: 'empty' });
  });

  it('only the host can configure, add/remove bots and start', () => {
    const env = new FakeEnv();
    env.join('a', 'Host'); env.join('b', 'Guest');
    env.send('b', { t: 'addBot', seat: 1 });
    env.send('b', { t: 'start' });
    env.send('b', { t: 'config', rules: makeRules('aceDown') });
    expect(env.errors('b').map((e) => e.code)).toEqual(['NOT_HOST', 'NOT_HOST', 'NOT_HOST']);
    env.send('a', { t: 'addBot', seat: 1 });
    expect(env.last('a', 'state')!.room.seats[1]).toMatchObject({ kind: 'bot' });
    env.send('a', { t: 'removeBot', seat: 1 });
    expect(env.last('a', 'state')!.room.seats[1]).toEqual({ kind: 'empty' });
  });

  it('validates house rules; cutthroat-3 vacates seat 4; cutthroat deck choice sticks', () => {
    const env = new FakeEnv();
    env.join('a', 'Host'); env.join('b', 'G');
    env.send('b', { t: 'sit', seat: 3 });
    env.send('a', { t: 'config', rules: { ...makeRules('joker'), removedCards: ['2C'] } });
    expect(env.errors('a').at(-1)!.code).toBe('BAD_RULES');
    env.send('a', { t: 'config', rules: makeRules('cutthroat', { playerCount: 3, deck: 'standard52' }) });
    const st = env.last('b', 'state')!;
    expect(st.room.rules).toMatchObject({ mode: 'cutthroat', playerCount: 3, deck: 'standard52' });
    expect(st.room.seats).toHaveLength(3);
    expect(st.seat).toBeNull();
  });

  it('start needs a seated human and fills empty seats with bots', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    env.send('a', { t: 'start' });
    expect(env.errors('a').at(-1)!.code).toBe('NO_PLAYERS');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'start' });
    const st = env.last('a', 'state')!;
    expect(st.room.phase).toBe('playing');
    expect(st.room.seats.map((s) => s.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(st.view!.hand ?? []).toHaveLength(st.view!.handCounts[0]!);
  });
});

describe('game', () => {
  it('never sends other players their opponents\' cards', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'start' });
    const game = env.room.data.game!;
    for (const [i, cid] of ['a', 'b', 'c', 'd'].entries()) {
      const raw = JSON.stringify(env.last(cid, 'state'));
      expect(raw).not.toContain('"hands"');
      expect(raw).not.toContain('"seed"');
      const v = env.last(cid, 'state')!.view!;
      expect(v.seat).toBe(i);
      if (v.hand) expect(v.hand.sort()).toEqual([...game.hands[i]!].sort());
    }
  });

  it('rejects out-of-turn and illegal plays', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'start' });
    const g = env.room.data.game!;
    const notTurn = ['a', 'b', 'c', 'd'][(g.turn! + 1) % 4]!;
    env.send(notTurn, { t: 'act', action: { type: 'bid', bid: 3 } });
    expect(env.errors(notTurn).at(-1)!.code).toBe('NOT_YOUR_TURN');
    const turn = ['a', 'b', 'c', 'd'][g.turn!]!;
    env.send(turn, { t: 'act', action: { type: 'play', card: 'AS' } });
    expect(env.errors(turn).at(-1)!.code).toBe('WRONG_PHASE');
    env.send(turn, { t: 'act', action: { type: 'bid', bid: 99 } });
    expect(env.errors(turn).at(-1)!.code).toBe('BAD_MESSAGE');
  });

  it('bots play their turns and stop at the human', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Solo');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 20; i++) env.advance(50);
    const g = env.room.data.game!;
    expect(g.turn).toBe(0);
    expect(env.last('a', 'state')!.room.deadline).toBeGreaterThan(env.t);
  });

  it('a human who runs out of time gets auto-played', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Slow');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: 5, play: 5 } }) });
    env.send('a', { t: 'start' });
    env.advance(500);
    expect(env.room.data.game!.turn).toBe(0);
    const before = env.room.data.game!.bids.filter((b) => b !== null).length;
    env.advance(5200);
    expect(env.room.data.game!.bids.filter((b) => b !== null).length).toBeGreaterThan(before);
    expect(env.room.data.chat.some((l) => l.text.includes('ran out of time'))).toBe(true);
  });

  it('plays a complete 4-human game over the protocol', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 250 }) });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 5000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a', 'b', 'c', 'd'])) env.advance(100);
    expect(env.room.data.phase).toBe('over');
    expect(env.last('c', 'state')!.view!.result).not.toBeNull();
    // writes: the room asks for a save after each change; the DO debounces these into far fewer rows
    expect(env.persists).toBeGreaterThan(50);
  });

  it('sends the hand history only when it changes (bandwidth)', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'start' });
    for (let i = 0; i < 5000 && (env.room.data.game?.history.length ?? 0) < 2; i++) if (!playTurn(env, ['a', 'b', 'c', 'd'])) env.advance(100);
    const states = env.raw.filter((m) => m.t === 'state' && m.view) as Extract<import('@spades/protocol').ServerMsg, { t: 'state' }>[];
    const full = states.filter((m) => m.view!.history !== null).length;
    expect(full).toBeLessThan(states.length / 10);
    expect(env.last('a', 'state')!.view!.history).toHaveLength(env.room.data.game!.history.length);
  });

  it('reconnect with the seat token rejoins the same seat; a disconnected turn uses a short grace', () => {
    const { env, ps } = fourHumans();
    env.send('a', { t: 'start' });
    const turnSeat = env.room.data.game!.turn!;
    const p = ps[turnSeat]!;
    env.room.close(p.cid);
    env.advance(10);
    const dl = env.room.data.deadline!;
    expect(dl - env.t).toBeLessThanOrEqual(5000);
    expect(env.last(ps[(turnSeat + 1) % 4]!.cid, 'state')!.room.seats[turnSeat]).toMatchObject({ connected: false });
    // comes back on a new socket with the stored token
    const again = env.join('z', 'whatever', p.token);
    expect(again.pid).toBe(p.pid);
    const st = env.last('z', 'state')!;
    expect(st.seat).toBe(turnSeat);
    expect(st.view!.turn).toBe(turnSeat);
    // their old socket was replaced; deadline was not extended
    expect(env.room.data.deadline).toBe(dl);
  });

  it('survives a restart (JSON round-trip of the saved row) mid-game', () => {
    const { env, ps } = fourHumans();
    env.send('a', { t: 'start' });
    for (let i = 0; i < 30; i++) playTurn(env, ['a', 'b', 'c', 'd']);
    const before = JSON.stringify(env.room.data.game);
    env.restart(ps.map((p) => [p.cid, p.pid]));
    expect(JSON.stringify(env.room.data.game)).toBe(before);
    for (let i = 0; i < 5000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a', 'b', 'c', 'd'])) env.advance(100);
    expect(env.room.data.phase).toBe('over');
  });

  it('freezes when nobody is connected (no bot moves, no timers)', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Solo');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'start' });
    env.room.close('a');
    const snap = JSON.stringify(env.room.data.game);
    env.advance(60_000);
    expect(JSON.stringify(env.room.data.game)).toBe(snap);
    expect(env.room.data.deadline).toBeNull();
  });

  it('leaving mid-game hands the seat to a bot and passes host', () => {
    const { env, ps } = fourHumans();
    env.send('a', { t: 'start' });
    env.send('a', { t: 'leave' });
    const st = env.last('b', 'state')!;
    expect(st.room.seats[0]).toMatchObject({ kind: 'bot', name: 'Dee (bot)' });
    expect(st.room.hostId).toBe(ps[1]!.pid);
  });

  it('a waiting member can take over a bot seat mid-game', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host'); env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'start' });
    env.join('b', 'Late');
    env.send('b', { t: 'sit', seat: 2 });
    const st = env.last('b', 'state')!;
    expect(st.seat).toBe(2);
    expect(st.view!.seat).toBe(2);
  });

  it('rematch starts a fresh game with the same seats (host only, after game over)', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('cutthroat', { playerCount: 4, targetScore: 100 }) });
    env.send('a', { t: 'start' });
    env.send('a', { t: 'rematch' });
    expect(env.errors('a').at(-1)!.code).toBe('WRONG_PHASE');
    for (let i = 0; i < 5000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a', 'b', 'c', 'd'])) env.advance(100);
    env.send('b', { t: 'rematch' });
    expect(env.errors('b').at(-1)!.code).toBe('NOT_HOST');
    env.send('a', { t: 'rematch' });
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.gamesPlayed).toBe(2);
  });
});

describe('chat + signaling', () => {
  it('chat: length limit, links blocked, profanity masked, rate limited', () => {
    const env = new FakeEnv();
    env.join('a', 'A'); env.join('b', 'B');
    env.clear();
    env.send('a', { t: 'chat', text: 'x'.repeat(500) });
    env.send('a', { t: 'chat', text: 'go to www.evil.com now' });
    env.send('a', { t: 'chat', text: 'oh shit' });
    const lines = env.msgs('b').filter((m) => m.t === 'chat').map((m) => (m as { line: { text: string } }).line.text);
    expect(lines[0]).toHaveLength(200);
    expect(lines[1]).toBe('go to [link] now');
    expect(lines[2]).toBe('oh s***');
    env.send('a', { t: 'chat', text: '4' });
    env.send('a', { t: 'chat', text: '5' });
    env.send('a', { t: 'chat', text: '6' });
    expect(env.errors('a').at(-1)!.code).toBe('RATE_LIMITED');
    env.advance(10_001);
    env.send('a', { t: 'chat', text: 'ok again' });
    expect(env.msgs('b').filter((m) => m.t === 'chat').length).toBe(6);
  });

  it('relays WebRTC signaling only to the addressed seated player', () => {
    const env = new FakeEnv();
    const a = env.join('a', 'A'); const b = env.join('b', 'B'); env.join('c', 'C');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'rtc', to: b.pid, data: { sdp: 'x' } });
    expect(env.msgs('b').some((m) => m.t === 'rtc')).toBe(false); // b isn't seated
    env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'rtc', to: b.pid, data: { sdp: 'offer' } });
    expect(env.last('b', 'rtc')).toEqual({ t: 'rtc', from: a.pid, data: { sdp: 'offer' } });
    expect(env.msgs('c').some((m) => m.t === 'rtc')).toBe(false);
    env.send('a', { t: 'media', media: { cam: true, mic: false } });
    expect(env.last('c', 'state')!.room.seats[0]).toMatchObject({ media: { cam: true, mic: false } });
  });

  it('drops malformed messages and requires hello first', () => {
    const env = new FakeEnv();
    env.room.open('x');
    env.room.message('x', '{not json');
    env.room.message('x', JSON.stringify({ t: 'sit', seat: 0 }));
    expect(env.errors('x').map((e) => e.code)).toEqual(['BAD_MESSAGE', 'NOT_JOINED']);
  });
});
