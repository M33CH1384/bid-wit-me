import { describe, expect, it } from 'vitest';
import { type Card, type Seat, bidOrder, checkGameEnd, handSize, legalPlays, makeRules, scoreHand, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { GameAction } from '@spades/protocol';
import { HAND_END_HOLD_MS } from '@spades/protocol';
import { BOT_NAMES } from '@spades/bots';
import { BOT_WATCHDOG_MS, HOST_DISCONNECT_GRACE_MS } from '../src/room';
import { FakeEnv } from './harness';

/** a bot seat got a name from the shared pool, unique at the table and not a human's name */
function expectPoolBot(seats: readonly unknown[], i: number) {
  const ss = seats as { kind: string; name?: string; playerId?: string }[];
  const name = ss[i]!.name!;
  expect(BOT_NAMES).toContain(name);
  expect(ss.filter((x, k) => k !== i && x.kind === 'bot').map((x) => x.name)).not.toContain(name);
}

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
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', card: a.card } : a.type === 'runIt' ? { type: 'runIt' } : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
    env.send(cid, { t: 'act', action, seq: st.room.seq });
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

  it('rejects a string nil value so a made nil stays a number and can end the game', () => {
    const env = new FakeEnv();
    env.join('a', 'Host');
    env.send('a', { t: 'config', rules: { ...makeRules('joker'), nil: { allowed: true, value: '100' } } as never });
    expect(env.errors('a').at(-1)!.code).toBe('BAD_RULES');
    expect(env.errors('a').at(-1)!.message).toMatch(/nil\.value/);
    const rules = env.room.data.rules;
    expect(rules.nil.value).toBe(100);
    // seat 0 nil (+100) and partner bid 4 made (+40) from 400 → 540, over the 500 target.
    // a string "100" concatenates instead (400 + "…100…") and the end check never sees a numeric leader
    const hand = scoreHand(rules, ['nil', 4, 4, 4], [0, 5, 4, 4], [400, 0], [0, 0]);
    expect(hand[0]!.totalScore).toBe(540);
    expect(typeof hand[0]!.totalScore).toBe('number');
    expect(checkGameEnd(rules, hand.map((s) => s.totalScore))?.endReason).toBe('target');
  });

  it('a missing nil does not freeze the table, and one bad bid cannot wedge the room', () => {
    const env = new FakeEnv();
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    const hole = { ...makeRules('joker', { firstHandBidsItself: false }) } as { nil?: unknown };
    delete hole.nil;
    expect(() => env.send('a', { t: 'config', rules: hole as never })).not.toThrow();
    expect(env.room.data.rules.nil).toEqual({ allowed: true, value: 100 });
    expect(env.room.data.rules.firstHandBidsItself).toBe(false);
    env.send('a', { t: 'start' });
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.game!.phase).toBe('bidding');
    env.room.data.game!.turn = 0;
    env.send('a', { t: 'act', action: { type: 'bid', bid: 3 }, seq: env.room.data.seq });
    expect(env.room.data.game!.bids[0]).toBe(3);
    // A live game (an older table, or a damaged row) can be missing nil and blindNil.
    // That used to throw inside bid options (`reading 'allowed'`) and drop the bid.
    delete (env.room.data.game!.rules as { nil?: unknown }).nil;
    delete (env.room.data.game!.rules as { blindNil?: unknown }).blindNil;
    env.room.data.game!.turn = 0;
    env.room.data.game!.bids[0] = null;
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    try {
      expect(() => env.room.message('a', JSON.stringify({ t: 'act', seq: env.room.data.seq, id: 'b1', action: { type: 'bid', bid: 4 } }))).not.toThrow();
      expect(env.msgs('a').some((m) => m.t === 'ack' && m.id === 'b1' && m.ok === true)).toBe(true);
      expect(env.room.data.game!.bids[0]).toBe(4);
      expect(env.room.data.game!.rules.nil).toEqual({ allowed: true, value: 100 });
      expect(env.room.data.game!.rules.blindNil.allowed).toBe(true);
      expect(() => env.send('a', { t: 'chat', text: 'still here' })).not.toThrow();
      expect(env.msgs('a').some((m) => m.t === 'chat' && m.line.text === 'still here')).toBe(true);
      expect(() => env.room.tick()).not.toThrow();
      // a bid the rules reject is an ack, and the table is still there
      env.room.data.game!.turn = 0;
      expect(() => env.room.message('a', JSON.stringify({ t: 'act', seq: env.room.data.seq, id: 'b2', action: { type: 'bid', bid: 14 } }))).not.toThrow();
      expect(env.msgs('a').some((m) => m.t === 'ack' && m.id === 'b2' && m.ok === false)).toBe(true);
      expect(env.room.data.game!.bids[0]).toBe(4);
    } finally {
      console.error = orig;
    }
    expect(logged.some((l) => l.includes('allowed'))).toBe(false);
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
    env.send('a', { t: 'config', rules: makeRules('joker', { firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    const g = env.room.data.game!;
    const notTurn = ['a', 'b', 'c', 'd'][(g.turn! + 1) % 4]!;
    env.send(notTurn, { t: 'act', action: { type: 'bid', bid: 3 }, seq: env.room.data.seq });
    expect(env.errors(notTurn).at(-1)!.code).toBe('NOT_YOUR_TURN');
    const turn = ['a', 'b', 'c', 'd'][g.turn!]!;
    env.send(turn, { t: 'act', action: { type: 'play', card: 'AS' }, seq: env.room.data.seq });
    expect(env.errors(turn).at(-1)!.code).toBe('WRONG_PHASE');
    env.send(turn, { t: 'act', action: { type: 'bid', bid: 99 } });
    expect(env.errors(turn).at(-1)!.code).toBe('BAD_MESSAGE');
  });

  it('offers and accepts 2v2 Nil with no minimum, and when the partner bid meets the floor', () => {
    const cids = ['a', 'b', 'c', 'd'];
    const open = (rules: ReturnType<typeof makeRules>) => {
      const { env } = fourHumans();
      env.send('a', { t: 'config', rules });
      expect(env.room.data.rules.nil.allowed).toBe(true);
      expect(env.room.data.rules.mode).not.toBe('cutthroat');
      env.send('a', { t: 'start' });
      return env;
    };
    const whose = (env: ReturnType<typeof fourHumans>['env']) => {
      const seat = env.room.data.game!.turn!;
      return { seat, cid: cids[seat]! };
    };

    // No minimum: Nil is legal before the partner bids, and still legal after a low partner bid.
    const none = open(makeRules('joker', { firstHandBidsItself: false, firstHandMin: null, minTeamBid: 0 }));
    let turn = whose(none);
    expect(none.last(turn.cid, 'state')!.view!.bidOptions).toMatchObject({ nil: true, nilReason: null, min: 1 });
    none.send(turn.cid, { t: 'act', action: { type: 'bid', bid: 'nil' }, seq: none.room.data.seq });
    expect(none.room.data.game!.bids[turn.seat]).toBe('nil');
    expect(none.errors(turn.cid).at(-1)?.code).not.toBe('NIL_NOT_ALLOWED');

    // Minimum 4: the first partner may Nil. Once they bid 4, the other seat may Nil too.
    const met = open(makeRules('joker', { firstHandBidsItself: false, firstHandMin: 4, minTeamBid: 0 }));
    turn = whose(met);
    expect(met.last(turn.cid, 'state')!.view!.rules.nil.allowed).toBe(true);
    expect(met.last(turn.cid, 'state')!.view!.bidOptions).toMatchObject({ nil: true, nilReason: null });
    met.send(turn.cid, { t: 'act', action: { type: 'bid', bid: 4 }, seq: met.room.data.seq });
    const cover = whose(met);
    expect((cover.seat + 2) % 4).toBe(turn.seat);
    expect(met.last(cover.cid, 'state')!.view!.bidOptions).toMatchObject({ nil: true, nilReason: null, min: 1 });
    met.send(cover.cid, { t: 'act', action: { type: 'bid', bid: 'nil' }, seq: met.room.data.seq });
    expect(met.room.data.game!.bids[cover.seat]).toBe('nil');

    // Same floor, partner bid under it: Nil is refused with the reason. Cutthroat stays off (next test).
    const low = open(makeRules('joker', { firstHandBidsItself: false, firstHandMin: 4, minTeamBid: 0 }));
    turn = whose(low);
    low.send(turn.cid, { t: 'act', action: { type: 'bid', bid: 2 }, seq: low.room.data.seq });
    const blocked = whose(low);
    expect(low.last(blocked.cid, 'state')!.view!.bidOptions).toMatchObject({
      nil: false, nilReason: "Can't Nil — partner bid 2", blockReason: 'Minimum is 4',
    });
    low.send(blocked.cid, { t: 'act', action: { type: 'bid', bid: 'nil' }, seq: low.room.data.seq });
    expect(low.errors(blocked.cid).at(-1)).toMatchObject({ code: 'NIL_NOT_ALLOWED', message: "Can't Nil — partner bid 2" });
    expect(low.room.data.game!.bids[blocked.seat]).toBeNull();

    // A saved 2v2 game that lost its nil object must not come back with Nil off.
    const hole = open(makeRules('joker', { firstHandBidsItself: false, firstHandMin: null, minTeamBid: 0 }));
    delete (hole.room.data.rules as { nil?: unknown }).nil;
    delete (hole.room.data.game!.rules as { nil?: unknown }).nil;
    hole.room.tick();
    expect(hole.room.data.rules.nil.allowed).toBe(true);
    expect(hole.room.data.game!.rules.nil.allowed).toBe(true);
    const healed = whose(hole);
    const view = hole.last(healed.cid, 'state')!.view!;
    expect(view.rules.nil.allowed).toBe(true);
    expect(view.bidOptions).toMatchObject({ nil: true, nilReason: null });
    hole.send(healed.cid, { t: 'act', action: { type: 'bid', bid: 'nil' }, seq: hole.room.data.seq });
    expect(hole.room.data.game!.bids[healed.seat]).toBe('nil');
  });

  it('enforces the host minimum on bids, including a Nil partner', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { firstHandBidsItself: false, firstHandMin: 4, minTeamBid: 0 }) });
    env.send('a', { t: 'start' });
    const cids = ['a', 'b', 'c', 'd'];
    const firstSeat = env.room.data.game!.turn!;
    const first = cids[firstSeat]!;
    env.send(first, { t: 'act', action: { type: 'bid', bid: 1 }, seq: env.room.data.seq });
    expect(env.room.data.game!.bids[firstSeat]).toBe(1);
    const partner = cids[env.room.data.game!.turn!]!;
    env.send(partner, { t: 'act', action: { type: 'bid', bid: 'nil' }, seq: env.room.data.seq });
    expect(env.errors(partner).at(-1)).toMatchObject({ code: 'NIL_NOT_ALLOWED', message: "Can't Nil — partner bid 1" });
    env.send(partner, { t: 'act', action: { type: 'bid', bid: 2 }, seq: env.room.data.seq });
    expect(env.errors(partner).at(-1)).toMatchObject({ code: 'BID_TOO_LOW', message: 'Minimum is 4' });
    expect(env.room.data.game!.bids[env.room.data.game!.turn!]).toBeNull();
    env.send(partner, { t: 'act', action: { type: 'bid', bid: 3 }, seq: env.room.data.seq });
    expect(env.room.data.game!.bids[(firstSeat + 2) % 4]).toBe(3);
  });

  it('stores Cutthroat with Nil and Blind Nil off and rejects those bids', () => {
    const { env } = fourHumans();
    const raw = makeRules('cutthroat', { playerCount: 4, firstHandBidsItself: false, minTeamBid: 4 });
    env.send('a', { t: 'config', rules: { ...raw, nil: { allowed: true, value: 100 }, blindNil: { allowed: true, value: 200, onlyWhenBehindBy: null, exchangeCards: 0 } } });
    expect(env.room.data.rules.nil.allowed).toBe(false);
    expect(env.room.data.rules.blindNil.allowed).toBe(false);
    env.send('a', { t: 'start' });
    const cid = ['a', 'b', 'c', 'd'][env.room.data.game!.turn!]!;
    env.send(cid, { t: 'act', action: { type: 'bid', bid: 'nil' }, seq: env.room.data.seq });
    expect(env.errors(cid).at(-1)).toMatchObject({ code: 'NIL_NOT_ALLOWED', message: 'Nil is off in Cutthroat' });
    env.send(cid, { t: 'act', action: { type: 'bid', bid: 'blindNil' }, seq: env.room.data.seq });
    expect(env.errors(cid).at(-1)).toMatchObject({ code: 'BLIND_NIL_NOT_ALLOWED', message: 'Blind Nil is off in Cutthroat' });
    env.send(cid, { t: 'act', action: { type: 'bid', bid: 3 }, seq: env.room.data.seq });
    expect(env.errors(cid).at(-1)).toMatchObject({ code: 'BID_TOO_LOW', message: 'Minimum bid is 4' });
  });

  it('an eliminated Cutthroat player stays to watch and cannot sit again', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('cutthroat', { playerCount: 4, firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    const g = env.room.data.game!;
    const handNo = g.handNo;
    g.eliminated = [true, false, false, false];
    g.failStreak = [1, 0, 0, 0];
    g.phase = 'bidding';
    g.turn = 1;
    env.room.testLoadGame(g);
    expect(env.room.data.seats[0]).toEqual({ kind: 'empty' });
    expect(env.room.data.outPlayers).toHaveLength(1);
    const gone = env.room.data.outPlayers![0]!;
    expect(env.room.data.members[gone]!.seat).toBeNull();
    env.send('a', { t: 'sit', seat: 0 });
    expect(env.errors('a').at(-1)!.code).toBe('ELIMINATED');
    env.send('a', { t: 'sit', seat: 1 });
    expect(env.errors('a').at(-1)!.code).toBe('ELIMINATED');
    const view = env.last('b', 'state')!.view!;
    expect(view.eliminated).toEqual([true, false, false, false]);
    expect(view.failStreak).toEqual([1, 0, 0, 0]);
    expect(view.handNo).toBe(handNo);
    expect(env.last('a', 'state')!.spectator).toBe(true);
    // The eliminated player is still watching, so the table keeps its clock and the seat stays empty.
    expect(env.room.data.deadline).toBeGreaterThan(env.t);
    env.advance(500);
    expect(env.room.data.seats[0]).toEqual({ kind: 'empty' });
    expect(env.last('a', 'state')!.spectator).toBe(true);
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

  it('a hibernated bot turn still plays on the durable alarm and is broadcast', () => {
    const env = new FakeEnv(undefined, { ...FAST, botMs: 800 });
    const a = env.join('a', 'Solo');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 500 }), botTalk: false });
    env.send('a', { t: 'start' });
    if (env.room.data.game!.turn === 0) {
      env.alarm = null;
      const v = env.last('a', 'state')!.view!;
      env.send('a', { t: 'act', action: { type: 'play', card: v.legal[0]! }, seq: env.room.data.seq });
    }
    const due = env.room.data.botDueAt!;
    const seat = env.room.data.game!.turn!;
    expect(seat).not.toBe(0);
    expect(env.alarm).toBe(due);
    expect(due - env.t).toBeLessThanOrEqual(800);
    const before = [...env.room.data.game!.hands[seat]!];
    const legal = legalPlays(env.room.data.game!, seat as Seat);
    const seq = env.room.data.seq;
    env.hibernate([['a', a.pid]]);
    expect(env.wakes).toEqual([]);
    expect(env.alarm).toBe(due);
    expect(env.room.data.botDueAt).toBe(due);
    env.advance(due - env.t + 20);
    expect(env.t).toBeLessThan(due + BOT_WATCHDOG_MS);
    expect(env.room.data.seq).toBeGreaterThan(seq);
    const left = env.room.data.game!.hands[seat]!;
    const played = before.filter((c) => !left.includes(c));
    expect(played).toHaveLength(1);
    expect(legal).toContain(played[0]);
    expect(env.last('a', 'state')!.room.seq).toBe(env.room.data.seq);
    expect(env.last('a', 'state')!.view!.turn).not.toBe(seat);
  });

  it('a stalled bot play is forced to a legal card and broadcast a few seconds later', () => {
    const env = new FakeEnv(undefined, { ...FAST, botMs: 800 });
    env.join('a', 'Solo');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 500 }), botTalk: false });
    env.send('a', { t: 'start' });
    if (env.room.data.game!.turn === 0) {
      env.alarm = null;
      const v = env.last('a', 'state')!.view!;
      env.send('a', { t: 'act', action: { type: 'play', card: v.legal[0]! }, seq: env.room.data.seq });
    }
    const due = env.room.data.botDueAt!;
    const seat = env.room.data.game!.turn! as Seat;
    const before = [...env.room.data.game!.hands[seat]!];
    const legal = legalPlays(env.room.data.game!, seat);
    const seq = env.room.data.seq;
    env.room.stallsLeft = 4;
    env.wakes = [];
    env.advance(due - env.t);
    expect(env.room.data.seq).toBe(seq);
    expect(env.room.data.game!.turn).toBe(seat);
    expect(env.room.data.game!.hands[seat]).toEqual(before);
    expect(env.alarm! - due).toBe(BOT_WATCHDOG_MS);
    env.wakes = [];
    env.advance(env.alarm! - env.t);
    const left = env.room.data.game!.hands[seat]!;
    const played = before.filter((c) => !left.includes(c));
    expect(played).toHaveLength(1);
    expect(legal).toContain(played[0]);
    expect(env.room.data.seq).toBe(seq + 1);
    const msg = env.last('a', 'state')!;
    expect(msg.room.seq).toBe(env.room.data.seq);
    expect(msg.view!.handCounts[seat]).toBe(before.length - 1);
    expect(msg.view!.turn).not.toBe(seat);
  });

  it('a stalled bot bid is forced to a legal bid or reveal and broadcast', () => {
    const env = new FakeEnv(undefined, { ...FAST, botMs: 800 });
    env.join('a', 'Solo');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 500, firstHandBidsItself: false }), botTalk: false });
    env.send('a', { t: 'start' });
    if (env.room.data.game!.turn === 0) {
      env.alarm = null;
      const mine = env.last('a', 'state')!.view!;
      if (mine.hand === null) env.send('a', { t: 'act', action: { type: 'reveal' }, seq: env.room.data.seq });
      else env.send('a', { t: 'act', action: { type: 'bid', bid: mine.bidOptions!.min }, seq: env.room.data.seq });
    }
    expect(env.room.data.game!.phase).toBe('bidding');
    const due = env.room.data.botDueAt!;
    const seat = env.room.data.game!.turn! as Seat;
    const view = viewFor(env.room.data.game!, seat);
    const seq = env.room.data.seq;
    env.room.stallsLeft = 4;
    env.wakes = [];
    env.advance(due - env.t);
    expect(env.room.data.seq).toBe(seq);
    expect(env.room.data.game!.turn).toBe(seat);
    expect(env.alarm! - due).toBe(BOT_WATCHDOG_MS);
    env.wakes = [];
    env.advance(env.alarm! - env.t);
    const g = env.room.data.game!;
    if (view.hand === null) expect(g.revealed[seat]).toBe(true);
    else expect(g.bids[seat]).toBe(view.bidOptions!.min);
    expect(env.room.data.seq).toBe(seq + 1);
    const msg = env.last('a', 'state')!;
    expect(msg.room.seq).toBe(env.room.data.seq);
    if (view.hand === null) expect(msg.view!.revealed[seat]).toBe(true);
    else expect(msg.view!.bids[seat]).toBe(view.bidOptions!.min);
  });

  it('a human who runs out of time gets auto-played', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Slow');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: 5, play: 5 }, firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    env.advance(500);
    expect(env.room.data.game!.turn).toBe(0);
    const before = env.room.data.game!.bids.filter((b) => b !== null).length;
    env.advance(5200);
    expect(env.room.data.game!.bids.filter((b) => b !== null).length).toBeGreaterThan(before);
    expect(env.room.data.chat.some((l) => l.text.includes('ran out of time'))).toBe(true);
  });

  it('first hand: books bid themselves (default) — play starts after the deal pause, no bidding; host can switch it off', () => {
    const env = new FakeEnv(undefined, { ...FAST, dealMs: 2000 });
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    expect(env.last('a', 'state')!.room.rules.firstHandBidsItself).toBe(true);
    env.send('a', { t: 'start' });
    const v = env.last('a', 'state')!.view!;
    expect(v.phase).toBe('playing');
    expect(v.bids).toEqual(['books', 'books', 'books', 'books']);
    // nobody moves during the deal animation, even though it's already trick play
    const turn = env.room.data.game!.turn;
    env.advance(1500);
    if (turn !== 0) expect(env.room.data.game!.trick.plays.length).toBe(0);
    // a 'books' bid can't be smuggled in over the protocol
    env.send('a', { t: 'act', action: { type: 'bid', bid: 'books' } as unknown as GameAction });
    expect(env.errors('a').at(-1)!.code).toBe('BAD_MESSAGE');
    const env2 = new FakeEnv(undefined, FAST);
    env2.join('a', 'Host');
    env2.send('a', { t: 'sit', seat: 0 });
    env2.send('a', { t: 'config', rules: makeRules('cutthroat', { firstHandBidsItself: false }) });
    env2.send('a', { t: 'start' });
    expect(env2.last('a', 'state')!.view!.phase).toBe('bidding');
  });

  it('plays a complete 4-human game over the protocol', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 250 }) });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 5000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a', 'b', 'c', 'd'])) env.advance(100);
    expect(env.room.data.phase).toBe('over');
    const result = env.room.data.game!.result!;
    expect(env.last('c', 'state')!.view!.result).toMatchObject({ endReason: result.endReason, finalScores: result.finalScores, winners: result.winners });
    // A books hand under the minimum is an instant loss, so a finished game can be one hand.
    // That still saves as it plays; the ending is the result, not a fixed save count.
    expect(env.persists).toBeGreaterThan(0);
    expect(result.finalScores).toHaveLength(2);
    if (result.endReason === 'target') expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(250);
    else if (result.endReason === 'floor') expect(result.finalScores.some((s) => s <= -200)).toBe(true);
    else {
      expect(result.endReason).toBe('shotOut');
      expect(result.shotOut?.length).toBeGreaterThan(0);
    }
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
    expect(st.room.seats[0]).toMatchObject({ kind: 'bot' });
    expectPoolBot(st.room.seats, 0);
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

describe('cutthroat 3 online', () => {
  it('keeps 2♣ out while three play and brings it back for two; options (min bid, Nil off, bags off) are enforced', () => {
    const env = new FakeEnv(undefined, FAST);
    const ps = ['a', 'b', 'c'].map((cid, i) => { const p = env.join(cid, ['Dee', 'Ray', 'Kim'][i]!); return { cid, ...p }; });
    env.send('a', { t: 'config', rules: makeRules('cutthroat', { playerCount: 3, deck: 'standard52', minTeamBid: 2, nil: { allowed: false }, bagsOn: false, targetScore: 100, firstHandBidsItself: false }) });
    ps.forEach((p, i) => env.send(p.cid, { t: 'sit', seat: i }));
    env.send('a', { t: 'start' });
    const cids = ps.map((p) => p.cid);
    let checked = 0, nilTried = false, sawThree = false;
    for (let i = 0; i < 20000 && env.room.data.phase === 'playing'; i++) {
      for (const cid of cids) {
        const v = env.last(cid, 'state')?.view;
        if (!v) continue;
        const live = v.eliminated.filter((out) => !out).length;
        if (v.hand) {
          // Three still in: 2♣ stays out of the deck. Two still in: the wide deck puts 2♣ back.
          if (live >= 3) {
            sawThree = true;
            expect(v.hand).not.toContain('2C');
            expect(v.hand.length).toBeLessThanOrEqual(17);
          } else {
            expect(v.rules.removedCards).not.toContain('2C');
            expect(v.hand.length).toBeLessThanOrEqual(13);
          }
          for (const card of v.hand) expect(v.rules.removedCards).not.toContain(card);
          checked++;
        }
        if (v.bidOptions) expect(v.bidOptions).toMatchObject({ min: 2, nil: false });
        if (!nilTried && v.phase === 'bidding' && v.turn === v.seat) {
          nilTried = true;
          env.send(cid, { t: 'act', action: { type: 'bid', bid: 0 }, seq: env.room.data.seq });
          expect(env.errors(cid).at(-1)!.code).toBe('NIL_NOT_ALLOWED');
        }
      }
      if (!playTurn(env, cids)) env.advance(100);
    }
    expect(checked).toBeGreaterThan(0);
    expect(sawThree).toBe(true);
    expect(nilTried).toBe(true);
    const g = env.room.data.game!;
    for (const h of g.history) {
      // A seat already out has no bid. Everyone still in bid a number at or above the minimum.
      for (const b of h.bids) if (b !== null) expect(typeof b === 'number' && b >= 2).toBe(true);
      for (const sd of h.sides) expect(sd.bagsAdded).toBe(0);
    }
  });
});

describe('action ordering (real-network latency)', () => {
  const acks = (env: FakeEnv, cid: string) => env.msgs(cid).filter((m) => m.t === 'ack') as Extract<ReturnType<FakeEnv['msgs']>[number], { t: 'ack' }>[];
  function onTurn(env: FakeEnv) {
    const g = env.room.data.game!;
    const cid = ['a', 'b', 'c', 'd'][g.turn!]!;
    const st = env.last(cid, 'state')!;
    const a = chooseBotAction(st.view!, 'normal')!;
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', card: a.card } : a.type === 'runIt' ? { type: 'runIt' } : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
    return { cid, seq: st.room.seq, action };
  }

  it('state carries a game seq that bumps only when the game changes', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'start' });
    const s0 = env.last('a', 'state')!.room.seq;
    env.send('b', { t: 'media', media: { cam: true, mic: false } });
    expect(env.last('a', 'state')!.room.seq).toBe(s0);
    const t = onTurn(env);
    env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id: 'x1' });
    expect(env.last('a', 'state')!.room.seq).toBe(s0 + 1);
    expect(acks(env, t.cid).at(-1)).toEqual({ t: 'ack', id: 'x1', ok: true });
  });

  it('a duplicate (retried) action id is acknowledged but never applied twice', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'start' });
    const t = onTurn(env);
    env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id: 'dup-1' });
    const seq = env.room.data.seq;
    const bids = env.room.data.game!.bids.filter((b) => b !== null).length;
    // same id again (a retry). Idempotent even without seq; a new move still has to carry seq.
    env.send(t.cid, { t: 'act', action: t.action, id: 'dup-1' });
    expect(env.room.data.seq).toBe(seq);
    expect(env.room.data.game!.bids.filter((b) => b !== null).length).toBe(bids);
    expect(acks(env, t.cid).at(-1)).toEqual({ t: 'ack', id: 'dup-1', ok: true, dup: true });
    expect(env.errors(t.cid)).toEqual([]);
    // the id survives a restart (it's part of the saved row)
    env.restart([['a', env.room.data.seats[0]!.kind === 'human' ? (env.room.data.seats[0] as { playerId: string }).playerId : null], [t.cid, (env.room.data.seats[['a', 'b', 'c', 'd'].indexOf(t.cid)] as { playerId: string }).playerId]]);
    env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id: 'dup-1' });
    expect(acks(env, t.cid).at(-1)).toMatchObject({ id: 'dup-1', ok: true, dup: true });
  });

  it('an action chosen from an old state is dropped as stale with a resync, not an error', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'start' });
    const t = onTurn(env);
    env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id: 'p1' });
    const n = env.msgs(t.cid).length;
    // a double-click / second send of the same move under a new id, still from the old state
    env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id: 'p2' });
    expect(acks(env, t.cid).at(-1)).toEqual({ t: 'ack', id: 'p2', ok: false, stale: true });
    expect(env.msgs(t.cid).slice(n).map((m) => m.t)).toEqual(['state', 'ack']);
    expect(env.errors(t.cid)).toEqual([]);
  });

  it('a late human move after the turn timer auto-played is stale, not a second move', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Slow');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: 5, play: 5 }, firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    env.advance(500);
    expect(env.room.data.game!.turn).toBe(0);
    const st = env.last('a', 'state')!;
    const a = chooseBotAction(st.view!, 'normal')!;
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : { type: 'bid', bid: (a as { bid: number }).bid };
    env.advance(4800); // the deadline passes on the server: auto-play happens first
    const after = env.room.data.seq;
    env.send('a', { t: 'act', action, seq: st.room.seq, id: 'late' });
    expect(acks(env, 'a').at(-1)).toMatchObject({ id: 'late', ok: false, stale: true });
    expect(env.room.data.seq).toBe(after);
    expect(env.errors('a')).toEqual([]);
  });

  it('a move that arrives before the alarm fires wins, and the timer then has nothing to do', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Quick');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: 5, play: 5 }, firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    env.advance(500);
    const st = env.last('a', 'state')!;
    const a = chooseBotAction(st.view!, 'normal')!;
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : { type: 'bid', bid: (a as { bid: number }).bid };
    env.send('a', { t: 'act', action, seq: st.room.seq, id: 'ok' });
    expect(acks(env, 'a').at(-1)).toEqual({ t: 'ack', id: 'ok', ok: true });
    env.advance(6000);
    expect(env.room.data.chat.some((l) => l.text.includes('ran out of time') && l.at <= env.t - 5000)).toBe(false);
  });

  it('real rule violations still come back as a failed ack with the reason', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    const g = env.room.data.game!;
    const notTurn = ['a', 'b', 'c', 'd'][(g.turn! + 1) % 4]!;
    env.send(notTurn, { t: 'act', action: { type: 'bid', bid: 3 }, seq: env.room.data.seq, id: 'nt' });
    expect(acks(env, notTurn).at(-1)).toMatchObject({ id: 'nt', ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('a full 4-human game with duplicated and stale sends never errors or double-applies', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 200 }) });
    env.send('a', { t: 'start' });
    let n = 0;
    for (let i = 0; i < 5000 && env.room.data.phase === 'playing'; i++) {
      const g = env.room.data.game!;
      if (g.phase === 'handOver') { ['a', 'b', 'c', 'd'].forEach((c) => env.send(c, { t: 'next' })); continue; }
      if (g.turn === null) { env.advance(100); continue; }
      const t = onTurn(env);
      const id = `m${n++}`;
      env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id });
      env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id }); // retry
      env.send(t.cid, { t: 'act', action: t.action, seq: t.seq, id: id + 'b' }); // double click
    }
    expect(env.room.data.phase).toBe('over');
    for (const c of ['a', 'b', 'c', 'd']) {
      expect(env.errors(c)).toEqual([]);
      expect(acks(env, c).filter((x) => !x.ok && !x.stale)).toEqual([]);
    }
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

describe('random bot names', () => {
  it('bots filling seats get distinct pool names that never match a human; names stay put for the game', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 12; k++) {
      const env = new FakeEnv();
      env.join('a', 'Keisha');
      env.send('a', { t: 'sit', seat: 0 });
      env.send('a', { t: 'start' });
      const seats = env.last('a', 'state')!.room.seats;
      const bots = seats.filter((x) => x.kind === 'bot').map((x) => (x as { name: string }).name);
      expect(bots).toHaveLength(3);
      expect(new Set(bots).size).toBe(3);
      bots.forEach((b) => { expect(BOT_NAMES).toContain(b); expect(b.toLowerCase()).not.toBe('keisha'); seen.add(b); });
      env.advance(5000);
      expect(env.last('a', 'state')!.room.seats.map((x) => (x as { name?: string }).name)).toEqual(seats.map((x) => (x as { name?: string }).name));
    }
    expect(seen.size).toBeGreaterThan(10); // random per game, not a fixed trio
  });
});

describe('partner mic mute (host option)', () => {
  it('is off by default; only the host can turn it on, in the lobby; non-booleans are ignored', () => {
    const env = new FakeEnv();
    env.join('a', 'Host'); env.join('b', 'Guest');
    env.send('a', { t: 'sit', seat: 0 }); env.send('b', { t: 'sit', seat: 2 });
    expect(env.last('b', 'state')!.room.partnerMicMute).toBe(false);
    env.send('b', { t: 'config', rules: makeRules('joker'), partnerMicMute: true });
    expect(env.errors('b').at(-1)!.code).toBe('NOT_HOST');
    expect(env.last('b', 'state')!.room.partnerMicMute).toBe(false);
    env.send('a', { t: 'config', rules: makeRules('joker'), partnerMicMute: true });
    expect(env.last('b', 'state')!.room.partnerMicMute).toBe(true);
    env.send('a', { t: 'config', rules: makeRules('joker'), partnerMicMute: 'yes' } as never);
    expect(env.last('b', 'state')!.room.partnerMicMute).toBe(true); // ignored, unchanged
    env.send('a', { t: 'config', rules: makeRules('joker') });
    expect(env.last('b', 'state')!.room.partnerMicMute).toBe(true); // omitted = unchanged
    env.send('a', { t: 'start' });
    env.send('a', { t: 'config', rules: makeRules('joker'), partnerMicMute: false });
    expect(env.errors('a').at(-1)!.code).toBe('RULES_LOCKED');
    expect(env.last('b', 'state')!.room.partnerMicMute).toBe(true);
  });
});

describe('nuke intensity (table setting)', () => {
  it('defaults to full; host-only; validated; synced to everyone', () => {
    const env = new FakeEnv();
    env.join('a', 'Host'); env.join('b', 'Guest');
    env.send('a', { t: 'sit', seat: 0 }); env.send('b', { t: 'sit', seat: 2 });
    expect(env.last('b', 'state')!.room.nukeIntensity).toBe('full');
    env.send('b', { t: 'config', rules: makeRules('joker'), nukeIntensity: 'off' });
    expect(env.errors('b').at(-1)!.code).toBe('NOT_HOST');
    env.send('a', { t: 'config', rules: makeRules('joker'), nukeIntensity: 'classic' });
    expect(env.last('b', 'state')!.room.nukeIntensity).toBe('classic');
    env.send('a', { t: 'config', rules: makeRules('joker'), nukeIntensity: 'mega' } as never);
    expect(env.last('b', 'state')!.room.nukeIntensity).toBe('classic');
  });
});

describe('team names, rematch series, bot trash talk', () => {
  it('a seated player names their own team (validated); a system line announces it; Cutthroat has no teams', () => {
    const { env } = fourHumans();
    env.send('b', { t: 'teamName', name: '  Spade Gods 🔥  ' });
    expect(env.last('a', 'state')!.room.teamNames).toEqual([null, 'Spade Gods 🔥']);
    expect(env.room.data.chat.at(-1)!.text).toMatch(/named their team “Spade Gods 🔥”/);
    env.send('a', { t: 'teamName', name: 'x'.repeat(40) });
    expect(env.last('a', 'state')!.room.teamNames![0]).toHaveLength(20);
    env.send('c', { t: 'teamName', name: 'fuck yall' });
    expect(env.errors('c').at(-1)!.code).toBe('BAD_NAME');
    env.send('a', { t: 'teamName', name: '' });
    expect(env.last('a', 'state')!.room.teamNames![0]).toBeNull();
    const env2 = new FakeEnv(undefined, FAST);
    env2.join('a', 'Host'); env2.send('a', { t: 'sit', seat: 0 });
    env2.send('a', { t: 'config', rules: makeRules('cutthroat') });
    env2.send('a', { t: 'teamName', name: 'Solo' });
    expect(env2.errors('a').at(-1)!.code).toBe('NO_TEAMS');
  });

  it('keeps a series across rematches, keyed by who is on each team (not the name); resets with a note when teams change', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 150 }) });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 5000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a', 'b', 'c', 'd'])) env.advance(100);
    let s = env.last('a', 'state')!.room.series!;
    expect(s.games).toHaveLength(1);
    expect(s.wins.reduce((x, y) => x + y, 0)).toBe(1);
    expect(s.games[0]!.totals.length).toBe(s.games[0]!.hands);
    env.send('a', { t: 'teamName', name: 'Renamed' });
    env.send('a', { t: 'rematch' });
    for (let i = 0; i < 5000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a', 'b', 'c', 'd'])) env.advance(100);
    s = env.last('a', 'state')!.room.series!;
    expect(s.games).toHaveLength(2);
    expect(s.sides[0]!.name).toBe('Renamed');
    // swap partners: b and c trade seats → a new series
    env.send('b', { t: 'stand' }); env.send('c', { t: 'stand' });
    env.send('b', { t: 'sit', seat: 2 }); env.send('c', { t: 'sit', seat: 1 });
    env.send('a', { t: 'rematch' });
    s = env.last('a', 'state')!.room.series!;
    expect(s.games).toHaveLength(0);
    expect(s.note).toMatch(/teams changed/);
  });

  it('bots talk trash from the server (on by default, host can turn it off)', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host'); env.send('a', { t: 'sit', seat: 0 });
    expect(env.last('a', 'state')!.room.botTalk).toBe(true);
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 150 }) });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 8000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a'])) env.advance(200);
    const lines = env.room.data.chat.filter((l) => l.bot);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.from).toBe(`bot:${l.bot!.seat}`);
    // every bot line carries its line id (clients play the recorded clip for it)
    for (const l of lines) if (l.text !== "…") expect(l.bot!.line, l.text).toMatch(/^[a-z]+\.[a-zA-Z]+\.\d+$/);
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 150 }), botTalk: false });
    expect(env.last('a', 'state')!.room.botTalk).toBe(false);
  });
});

describe('table talk + host music', () => {
  it('host sets the Table Talk countdown; the hand-over deadline uses it', () => {
    const env = new FakeEnv(undefined, { ...FAST, handOverMs: 3000 });
    env.join('a', 'Host');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { shotOut: false }), talkSec: 45 });
    expect(env.last('a', 'state')!.room.talkSec).toBe(45);
    env.send('a', { t: 'config', rules: makeRules('joker', { shotOut: false }), talkSec: 7 } as never);
    expect(env.last('a', 'state')!.room.talkSec).toBe(45); // only 15/20/30/45 accepted
    env.send('a', { t: 'start' });
    // play the first hand out with the bot brain for the human seat
    for (let i = 0; i < 3000 && env.room.data.game!.phase !== 'handOver'; i++) if (!playTurn(env, ['a'])) env.advance(50);
    expect(env.room.data.game!.phase).toBe('handOver');
    env.advance(10);
    const st = env.last('a', 'state')!;
    expect(st.room.deadline! - st.room.now).toBeGreaterThan(40_000);
    expect(st.room.deadline! - st.room.now).toBeGreaterThan(45_000 + HAND_END_HOLD_MS - 100); // + the score-screen lead-in
    env.advance(46_000 + HAND_END_HOLD_MS + 6_000); // (+ the Run it! show when the hand ended on one)
    expect(env.room.data.game!.phase).not.toBe('handOver');
  });
  it('host music: beats are synced by server start time; links are validated; only the host can change it', () => {
    const env = new FakeEnv();
    env.join('a', 'Host'); env.join('b', 'Guest');
    env.send('b', { t: 'music', music: { mode: 'beat', track: 1, startAt: 0 } });
    expect(env.errors('b').at(-1)!.code).toBe('NOT_HOST');
    env.send('a', { t: 'music', music: { mode: 'beat', track: 2, startAt: 0 } });
    const m = env.last('b', 'state')!.room.music!;
    expect(m).toMatchObject({ mode: 'beat', track: 2 });
    expect((m as { startAt: number }).startAt).toBeGreaterThan(env.t);
    env.send('a', { t: 'music', music: { mode: 'link', url: 'https://evil.example.com/x', title: 'x' } });
    expect(env.errors('a').at(-1)!.code).toBe('BAD_MESSAGE');
    env.send('a', { t: 'music', music: { mode: 'link', url: 'https://open.spotify.com/track/abc', title: 'Song' } });
    expect(env.last('b', 'state')!.room.music).toEqual({ mode: 'link', url: 'https://open.spotify.com/track/abc', title: 'Song' });
    env.send('a', { t: 'music', music: { mode: 'stream', by: 'someone-else', title: 'My mix' } });
    expect(env.last('b', 'state')!.room.music).toMatchObject({ mode: 'stream', by: env.last('a', 'welcome')!.you });
    env.send('a', { t: 'leave' });
    expect(env.last('b', 'state')!.room.music).toBeUndefined();
    env.send('b', { t: 'music', music: { mode: 'off' } }); // b is host now
    expect(env.last('b', 'state')!.room.music).toBeUndefined();
  });
});

describe('learning mode', () => {
  it('a player with tips on gets a 50% longer turn timer (only for their own turns)', () => {
    const run = (learning: boolean) => {
      const env = new FakeEnv(undefined, FAST);
      env.join('a', 'Solo');
      env.send('a', { t: 'sit', seat: 0 });
      env.send('a', { t: 'config', rules: { ...makeRules('joker'), firstHandBidsItself: false } });
      if (learning) env.send('a', { t: 'learning', on: true });
      env.send('a', { t: 'start' });
      for (let i = 0; i < 40 && env.room.data.game!.turn !== 0; i++) env.advance(50);
      env.advance(10);
      const d = env.room.data;
      return d.deadline! - d.turnStartedAt!;
    };
    const bidMs = makeRules('joker').turnTimerSec.bid * 1000;
    const plain = run(false), slow = run(true);
    expect(plain).toBeLessThan(bidMs * 1.5);
    expect(slow).toBeGreaterThanOrEqual(bidMs * 1.5);
  });
});

describe('AFK + kicking', () => {
  const soloGame = (afkLimit?: number) => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Slow');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: 5, play: 5 }, firstHandBidsItself: false }), ...(afkLimit !== undefined ? { afkLimit } : {}) });
    env.send('a', { t: 'start' });
    return { env, a };
  };
  const waitMyTurn = (env: FakeEnv) => { for (let i = 0; i < 200 && !(env.room.data.seats[0]!.kind === 'human' && env.room.data.game!.turn === 0 && env.room.data.game!.phase !== 'handOver'); i++) env.advance(50); };

  it('counts consecutive timeouts; any own move resets the counter', () => {
    const { env, a } = soloGame(5);
    waitMyTurn(env);
    env.advance(5200);
    expect(env.room.data.members[a.pid]!.timeouts).toBe(1);
    waitMyTurn(env);
    env.advance(5200);
    expect(env.room.data.members[a.pid]!.timeouts).toBe(2);
    waitMyTurn(env);
    expect(playTurn(env, ['a'])).toBe(true);
    expect(env.room.data.members[a.pid]!.timeouts).toBe(0);
  });

  it('after N timeouts in a row (default 3) a bot replaces the player; they can sit back down', () => {
    const { env, a } = soloGame();
    expect(env.last('a', 'state')!.room.afkLimit).toBe(3);
    for (let k = 0; k < 3; k++) { waitMyTurn(env); env.advance(5200); }
    const d = env.room.data;
    expect(d.seats[0]).toMatchObject({ kind: 'bot', was: 'Slow' });
    const botName = (d.seats[0] as { name: string }).name;
    expect(env.last('a', 'state')!.room.seats[0]).toMatchObject({ kind: 'bot', name: botName, was: 'Slow' });
    expectPoolBot(d.seats, 0);
    expect(d.members[a.pid]!.seat).toBeNull();
    expect(d.chat.some((l) => l.text === `Slow was AFK and replaced by a bot (${botName})`)).toBe(true);
    // still at the table: the seat (now a bot) can be taken back
    env.send('a', { t: 'sit', seat: 0 });
    expect(env.errors('a')).toHaveLength(0);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
  });

  it('the host can set the AFK limit (2) or turn it off', () => {
    const two = soloGame(2);
    for (let k = 0; k < 2; k++) { waitMyTurn(two.env); two.env.advance(5200); }
    expect(two.env.room.data.seats[0]!.kind).toBe('bot');
    const off = soloGame(0);
    // 5s play/bid timer plus a nuked-trick lead-in (4000ms). advance(5200) stops short of that
    // deadline, so the next loop finishes the same timeout and the count comes up one short.
    for (let k = 0; k < 6; k++) { waitMyTurn(off.env); off.env.advance(10_000); }
    expect(off.env.room.data.seats[0]!.kind).toBe('human');
    expect(off.env.room.data.members[off.a.pid]!.timeouts).toBeGreaterThanOrEqual(6);
  });

  it('host kick: a bot takes the seat, the player is disconnected and cannot rejoin this game', () => {
    const { env, ps } = fourHumans();
    env.send('a', { t: 'start' });
    env.send('a', { t: 'kick', seat: 1 });
    const d = env.room.data;
    expect(d.seats[1]).toMatchObject({ kind: 'bot' });
    expectPoolBot(d.seats, 1);
    expect(d.members[ps[1]!.pid]).toBeUndefined();
    expect(env.closed).toContain('b');
    expect(env.errors('b').some((e) => e.code === 'KICKED')).toBe(true);
    env.room.open('b2');
    env.send('b2', { t: 'hello', name: 'Ray', token: ps[1]!.token });
    expect(env.last('b2', 'welcome')).toBeUndefined();
    expect(env.errors('b2')[0]!.code).toBe('KICKED');
    // a non-host "kick" is only a vote; nobody can kick themselves
    env.send('c', { t: 'kick', seat: 2 });
    expect(env.errors('c').at(-1)!.code).toBe('BAD_SEAT');
  });

  it('vote kick needs a majority of the other humans; a second press takes the vote back', () => {
    const { env, ps } = fourHumans();
    env.send('a', { t: 'start' });
    env.send('b', { t: 'kick', seat: 3 }); // 1 of 3 others → need 2
    expect(env.last('b', 'state')!.room.votes).toEqual([{ target: ps[3]!.pid, by: [ps[1]!.pid], need: 2 }]);
    env.send('b', { t: 'kick', seat: 3 }); // retract
    expect(env.last('b', 'state')!.room.votes).toBeUndefined();
    env.send('b', { t: 'kick', seat: 3 });
    expect(env.room.data.seats[3]!.kind).toBe('human');
    env.send('c', { t: 'kick', seat: 3 });
    expect(env.room.data.seats[3]).toMatchObject({ kind: 'bot' });
    expectPoolBot(env.room.data.seats, 3);
    expect(env.closed).toContain('d');
    expect(env.room.data.chat.some((l) => l.text.startsWith('Jo was voted off the table'))).toBe(true);
    // the next game lets them back
    expect(env.room.data.kicked).toHaveLength(1);
  });
});

describe("'Run it!' over the protocol", () => {
  it('a guaranteed claim is applied server-side, credits every remaining book, and a repeat is refused (idempotent)', () => {
    const cids = ['a', 'b', 'c', 'd'];
    let ran: { cid: string; handNo: number } | null = null;
    let env!: FakeEnv;
    // (deals vary run to run, and a whole game can pass without anyone being guaranteed the rest: try a few games)
    for (let game = 0; game < 6 && !ran; game++) {
      env = fourHumans().env;
      env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
      env.send('a', { t: 'start' });
      const runSeat = () => env.room.data.game?.tricks.filter((t) => t.plays.some((p) => p.run)).at(-1)?.winner ?? undefined; // the claimer wins every run trick
      // bots' logic (65% when guaranteed) or this loop claims as soon as a seat may run it
      for (let i = 0; i < 20000 && env.room.data.phase === 'playing' && runSeat() === undefined; i++) {
        for (const cid of cids) {
          const v = env.last(cid, 'state')?.view;
          if (v?.canRunIt) { env.send(cid, { t: 'act', action: { type: 'runIt' }, seq: env.room.data.seq }); break; }
        }
        if (runSeat() === undefined && !playTurn(env, cids)) env.advance(100);
      }
      if (runSeat() !== undefined) ran = { cid: cids[runSeat()!]!, handNo: env.room.data.game!.handNo };
    }
    expect(ran).not.toBeNull();
    const g = env.room.data.game!;
    const runTricks = g.tricks.filter((t) => t.plays.some((p) => p.run));
    expect(runTricks.length).toBeGreaterThanOrEqual(2);
    const claimer = runTricks.at(-1)!.winner;
    expect(runTricks.every((t) => t.winner === claimer)).toBe(true);
    expect(g.hands.every((h) => h.length === 0)).toBe(true);
    const errs = env.errors(ran!.cid).length;
    env.send(ran!.cid, { t: 'act', action: { type: 'runIt' }, seq: env.room.data.seq });
    expect(env.errors(ran!.cid).length).toBe(errs + 1);
    expect(env.room.data.game!.tricks.length).toBe(g.tricks.length);
  });
});

describe("'Run it!' any time (Release 10)", () => {
  /** a started 4-seat Joker game rewritten to a late spot: 2 cards each, seat `turn` to lead, every card out but these */
  const late = (env: FakeEnv, hands: string[][], turn: number) => {
    const d = env.room.data;
    const g = d.game!;
    const filler = Array.from({ length: 11 }, () => ({ leader: 0, plays: [], winner: 1 }));
    d.game = { ...g, phase: 'playing', hands: hands as never, bids: [2, 2, 2, 2], tricks: filler, tricksWon: [0, 0, 0, 0], turn, trick: { leader: turn, plays: [], winner: null }, spadesBroken: true } as never;
    d.seq = (d.seq ?? 0) + 1;
  };
  const start = (humans: number) => {
    const env = new FakeEnv(undefined, FAST);
    const cids = ['a', 'b', 'c', 'd'].slice(0, humans);
    cids.forEach((cid, i) => { env.join(cid, ['Dee', 'Ray', 'Kim', 'Jo'][i]!); env.send(cid, { t: 'sit', seat: i }); });
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
    env.send('a', { t: 'start' });
    return env;
  };

  it('a human claims off-turn; others auto-play; books go to the claimer\'s team; a second (simultaneous) claim is refused', () => {
    const env = fourHumans().env;
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
    env.send('a', { t: 'start' });
    late(env, [['3H', '4H'], ['5C', '6C'], ['BJ', 'LJ'], ['3D', '7D']], 0);
    const g0 = env.room.data.game!;
    // the claimer (seat 2) is not on turn; another player (seat 1) races a stale claim
    env.send('c', { t: 'act', id: 'r1', action: { type: 'runIt' }, seq: env.room.data.seq });
    const g = env.room.data.game!;
    const fresh = g.tricks.slice(g0.tricks.length);
    expect(fresh.map((t) => t.winner)).toEqual([2, 2]);
    expect(g.hands.every((h) => h.length === 0)).toBe(true);
    env.send('b', { t: 'act', id: 'r2', action: { type: 'runIt' }, seq: env.room.data.seq });
    expect(env.msgs('b').some((m) => m.t === 'ack' && m.id === 'r2' && !m.ok)).toBe(true);
    expect(env.room.data.game!.tricks.length).toBe(g.tricks.length);
  });

  it('an invalid off-turn claim is rejected and changes nothing', () => {
    const env = fourHumans().env;
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
    env.send('a', { t: 'start' });
    late(env, [['BJ', '4H'], ['5C', '6C'], ['LJ', '2D'], ['3D', '7D']], 0);
    const before = env.room.data.game!;
    expect(env.last('c', 'state')?.view.canRunIt ?? false).toBe(false);
    env.send('c', { t: 'act', action: { type: 'runIt' }, seq: env.room.data.seq });
    expect(env.room.data.game).toBe(before);
  });

  it('a bot claims as soon as it is guaranteed, even when it is a human\'s turn', () => {
    const env = start(1); // seat 0 human, seats 1..3 bots
    late(env, [['3H', '4H'], ['5C', '6C'], ['BJ', 'LJ'], ['3D', '7D']], 0);
    // late() rewrites the hand without going through Room.after(), so the clock is not rescheduled.
    // A human already on the clock may have no wake within 50ms (their play timer is seconds away),
    // so advance(50) sometimes never enters drive(). A tick is what that alarm does.
    env.room.tick();
    const g = env.room.data.game!;
    expect(g.tricks.slice(11).map((t) => t.winner)).toEqual([2, 2]);
    expect(env.room.data.chat.some((c) => /ran the board/.test(c.text))).toBe(true);
  });
});

describe('Run it! cleared hands are sent only after the claim resolves', () => {
  const sorted = (hands: readonly (readonly (string | { card: string })[])[]) => hands.map((h) => h.map((c) => (typeof c === 'string' ? c : c.card)).sort());

  function table(mode: 'joker' | 'cutthroat', playerCount: 3 | 4) {
    const env = new FakeEnv(undefined, FAST);
    const cids = ['a', 'b', 'c', 'd'].slice(0, playerCount);
    ['Dee', 'Ray', 'Kim', 'Jo'].slice(0, playerCount).forEach((name, i) => {
      env.join(cids[i]!, name);
      env.send(cids[i]!, { t: 'sit', seat: i });
    });
    env.send('a', { t: 'config', rules: makeRules(mode, { playerCount, targetScore: 5000 }) });
    env.send('a', { t: 'start' });
    env.join('s', 'Watcher');
    return { env, cids };
  }

  /** Rewrite the live hand to a late spot and broadcast that state, before anyone claims. */
  function plant(env: FakeEnv, hands: string[][], trick?: { leader: number; plays: { seat: number; card: string }[] }) {
    const d = env.room.data;
    const g = d.game!;
    const n = hands.length;
    const plays = trick?.plays ?? [];
    const leader = trick?.leader ?? 0;
    // Cards still in the longest hand are the tricks left, including the one in progress.
    const left = Math.max(...hands.map((h) => h.length));
    d.game = {
      ...g, phase: 'playing', hands: hands as never, bids: Array(n).fill(2),
      tricks: Array.from({ length: handSize(g.rules) - left }, () => ({ leader: 0, plays: [], winner: 1 })),
      tricksWon: Array(n).fill(0), turn: (leader + plays.length) % n,
      trick: { leader, plays, winner: null }, spadesBroken: true,
    } as never;
    d.seq = (d.seq ?? 0) + 1;
    env.send('a', { t: 'media', media: { cam: false, mic: false } });
  }

  function wire(msg: unknown): string {
    const copy = JSON.parse(JSON.stringify(msg)) as { room?: { rules?: unknown }; view?: { rules?: unknown } };
    if (copy.room) delete copy.room.rules;
    if (copy.view) delete copy.view.rules;
    return JSON.stringify(copy);
  }

  /** Cards still in other seats' hands must not appear anywhere in this client's latest state. */
  function assertHidden(env: FakeEnv, cid: string, hands: string[][], seat: number | null) {
    const msg = env.last(cid, 'state')!;
    const text = wire(msg);
    expect(msg.view?.runHands, cid).toBeUndefined();
    expect(text.includes('"runHands"'), cid).toBe(false);
    const mine = new Set(seat === null ? [] : hands[seat]);
    for (let s = 0; s < hands.length; s++) {
      if (s === seat) continue;
      for (const c of hands[s]!) {
        if (mine.has(c)) continue;
        expect(text.includes(`"${c}"`), `${cid} was sent unseen ${c} before the claim resolved`).toBe(false);
      }
    }
  }

  const cases: { label: string; mode: 'joker' | 'cutthroat'; n: 3 | 4; hands: string[][]; claimer: number }[] = [
    { label: '2v2', mode: 'joker', n: 4, hands: [['3H', '4H'], ['5C', '6C'], ['BJ', 'LJ'], ['3D', '7D']], claimer: 2 },
    { label: 'Cutthroat 4', mode: 'cutthroat', n: 4, hands: [['3H', '4H'], ['5C', '6C'], ['BJ', 'LJ'], ['3D', '7D']], claimer: 2 },
    { label: 'Cutthroat 3', mode: 'cutthroat', n: 3, hands: [['5C', '6C'], ['3D', '7D'], ['BJ', 'LJ']], claimer: 2 },
  ];

  for (const c of cases) {
    it(`${c.label}: no unseen cards before resolution; every cleared hand, claimer included, after — players and a spectator`, () => {
      const { env, cids } = table(c.mode, c.n);
      plant(env, c.hands);
      expect(env.last(cids[c.claimer]!, 'state')!.view!.canRunIt).toBe(true);
      for (const [i, cid] of cids.entries()) assertHidden(env, cid, c.hands, i);
      assertHidden(env, 's', c.hands, null);
      expect(env.last('s', 'state')!.spectator).toBe(true);

      const held = c.hands.map((h) => [...h]);
      env.send(cids[c.claimer]!, { t: 'act', action: { type: 'runIt' }, seq: env.room.data.seq });
      expect(env.room.data.game!.hands.every((h) => h.length === 0)).toBe(true);
      for (const cid of [...cids, 's']) {
        const view = env.last(cid, 'state')!.view!;
        expect(sorted(view.runHands!), cid).toEqual(sorted(held));
      }
    });
  }

  it('Cutthroat mid-trick: table cards are marked played after the claim, and unseen cards stay hidden before it', () => {
    const { env, cids } = table('cutthroat', 4);
    const hands = [['BJ', 'LJ', '2D'], ['5C', '6C'], ['7C', '8C'], ['9C', 'TC', 'JC']];
    plant(env, hands, { leader: 1, plays: [{ seat: 1, card: '3H' }, { seat: 2, card: '4D' }] });
    expect(env.last('a', 'state')!.view!.canRunIt).toBe(true);
    for (const [i, cid] of cids.entries()) assertHidden(env, cid, hands, i);
    assertHidden(env, 's', hands, null);
    const before = wire(env.last('b', 'state'));
    expect(before.includes('"runHands"')).toBe(false);
    expect(before.includes('"3H"')).toBe(true);
    expect(before.includes('"BJ"')).toBe(false);

    env.send('a', { t: 'act', action: { type: 'runIt' }, seq: env.room.data.seq });
    expect(env.room.data.game!.phase === 'handOver' || env.room.data.game!.phase === 'gameOver').toBe(true);
    for (const cid of [...cids, 's']) {
      const rows = env.last(cid, 'state')!.view!.runHands!;
      expect(rows.map((h) => h.length), cid).toEqual([3, 3, 3, 3]);
      const marked = rows.flatMap((h, seat) => h.filter((c) => c.played).map((c) => `${seat}:${c.card}`));
      expect(marked, cid).toEqual(['1:3H', '2:4D']);
      expect(sorted([rows[0]!]), cid).toEqual([['2D', 'BJ', 'LJ']]);
      expect(rows[0]!.every((c) => !c.played), cid).toBe(true);
    }
  });
});

describe('Run it! play-out is broadcast with the resolving state', () => {
  const hands = [['3H', '4H'], ['5C', '6C'], ['BJ', 'LJ'], ['3D', '7D']];

  /** Rewrite the live hand to a late spot. Does not broadcast — call `ping` or `tick` for that. */
  function late(env: FakeEnv, turn = 0) {
    const d = env.room.data;
    const g = d.game!;
    d.game = {
      ...g, phase: 'playing', hands: hands as never, bids: [2, 2, 2, 2],
      tricks: Array.from({ length: handSize(g.rules) - 2 }, () => ({ leader: 0, plays: [], winner: 1 })),
      tricksWon: [0, 0, 0, 0], turn, trick: { leader: turn, plays: [], winner: null }, spadesBroken: true,
    } as never;
    d.seq = (d.seq ?? 0) + 1;
  }

  function cardsOf(tricks: { plays: { card: string }[] }[]) {
    return tricks.flatMap((t) => t.plays.map((p) => p.card)).sort();
  }

  it('a non-actor and a spectator both receive every remaining trick, then the finished hand', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
    env.send('a', { t: 'start' });
    env.join('s', 'Watcher');
    late(env, 0);
    env.send('a', { t: 'media', media: { cam: false, mic: false } });
    for (const cid of ['a', 'b', 's']) expect(env.last(cid, 'state')!.run, cid).toBeUndefined();

    env.send('c', { t: 'act', action: { type: 'runIt' }, seq: env.room.data.seq });
    expect(env.room.data.game!.hands.every((h) => h.length === 0)).toBe(true);
    const held = [...hands.flat()].sort();
    for (const cid of ['a', 'b', 's']) {
      const msg = env.last(cid, 'state')!;
      expect(msg.run, cid).toBeTruthy();
      expect(msg.run!.claimer, cid).toBe(2);
      expect(msg.run!.books, cid).toBeGreaterThanOrEqual(2);
      expect(msg.run!.tricks, cid).toHaveLength(msg.run!.books);
      expect(cardsOf(msg.run!.tricks), cid).toEqual(held);
      expect(msg.run!.seq, cid).toBe(env.room.data.seq);
      expect(msg.view!.handCounts.every((n) => n === 0), cid).toBe(true);
      expect(msg.view!.phase === 'handOver' || msg.view!.phase === 'gameOver', cid).toBe(true);
    }
    expect(env.last('s', 'state')!.spectator).toBe(true);
    expect(env.last('a', 'state')!.run).toEqual(env.last('s', 'state')!.run);
  });

  it('a bot claim in the same tick is on the human and the spectator broadcasts', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Dee');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
    env.send('a', { t: 'start' });
    env.join('s', 'Watcher');
    late(env, 0);
    expect(env.last('a', 'state')!.run).toBeUndefined();
    expect(env.last('s', 'state')!.run).toBeUndefined();
    // late() does not reschedule the clock; tick() is what the alarm does, and it claims before the one broadcast.
    env.room.tick();
    for (const cid of ['a', 's']) {
      const msg = env.last(cid, 'state')!;
      expect(msg.run?.claimer, cid).toBe(2);
      expect(msg.run!.books, cid).toBeGreaterThanOrEqual(2);
      expect(cardsOf(msg.run!.tricks), cid).toEqual([...hands.flat()].sort());
      expect(msg.view!.phase === 'handOver' || msg.view!.phase === 'gameOver', cid).toBe(true);
    }
    expect(env.last('s', 'state')!.spectator).toBe(true);
  });

  /** The claimer's own cards in the play-out, in seat order, with their real identities. */
  function claimed(run: { claimer: number; tricks: { plays: { seat: number; card: string; played?: boolean }[] }[] }) {
    return run.tricks.flatMap((t) => t.plays.filter((p) => p.seat === run.claimer && !p.played).map((p) => p.card)).sort();
  }

  it('a bot Run it! play-out reveals the claimer\'s cards to every seat and to spectators', () => {
    const env = new FakeEnv(undefined, FAST);
    for (const [cid, name, seat] of [['a', 'Dee', 0], ['b', 'Ray', 1], ['d', 'Jo', 3]] as const) {
      env.join(cid, name);
      env.send(cid, { t: 'sit', seat });
    }
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
    env.send('a', { t: 'start' });
    expect(env.room.data.seats[2]!.kind).toBe('bot');
    env.join('s', 'Watcher');
    late(env, 0);
    env.room.tick();
    expect(env.room.data.game!.tricks.slice(-2).every((t) => t.winner === 2)).toBe(true);
    const sample = env.last('a', 'state')!.run!;
    expect(claimed(sample)).toEqual(['BJ', 'LJ']);
    for (const cid of ['a', 'b', 'd', 's']) {
      const msg = env.last(cid, 'state')!;
      expect(msg.run, cid).toBeTruthy();
      expect(msg.run!.claimer, cid).toBe(2);
      expect(claimed(msg.run!), cid).toEqual(['BJ', 'LJ']);
      expect(cardsOf(msg.run!.tricks), cid).toEqual([...hands.flat()].sort());
      expect(msg.run, cid).toEqual(sample);
    }
    expect(env.last('s', 'state')!.spectator).toBe(true);
  });

  it('a human claimer\'s play-out reveals those same cards to every seat and to spectators', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 1000 }) });
    env.send('a', { t: 'start' });
    env.join('s', 'Watcher');
    late(env, 0);
    env.send('a', { t: 'media', media: { cam: false, mic: false } });
    env.send('c', { t: 'act', action: { type: 'runIt' }, seq: env.room.data.seq });
    const sample = env.last('c', 'state')!.run!;
    expect(claimed(sample)).toEqual(['BJ', 'LJ']);
    for (const cid of ['a', 'b', 'c', 'd', 's']) {
      const msg = env.last(cid, 'state')!;
      expect(claimed(msg.run!), cid).toEqual(['BJ', 'LJ']);
      expect(cardsOf(msg.run!.tricks), cid).toEqual([...hands.flat()].sort());
      expect(msg.run, cid).toEqual(sample);
    }
    expect(env.last('s', 'state')!.spectator).toBe(true);
  });
});

describe('rule lock (house rules locked for the game)', () => {
  it('rejects outcome rules mid-game; social / pace settings stay adjustable; game over unlocks', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host'); env.send('a', { t: 'sit', seat: 0 });
    const base = makeRules('joker', { targetScore: 250 });
    env.send('a', { t: 'config', rules: base });
    env.send('a', { t: 'start' });
    const locked: Record<string, unknown>[] = [
      { rules: { ...base, targetScore: 500 } },
      { rules: { ...base, shotOut: false } },
      { rules: { ...base, firstHandMin: 5 } },
      { rules: { ...base, firstHandBidsItself: false } },
      { rules: { ...base, bagPenalty: 50 } },
      { rules: { ...base, nil: { ...base.nil, allowed: false } } },
      { rules: base, nukeIntensity: 'off' },
      { rules: base, botLevel: 'shark' },
      { rules: base, talkIntensity: 'nomercy' },
      { rules: makeRules('cutthroat') },
    ];
    for (const m of locked) {
      const before = env.errors('a').length;
      env.send('a', { t: 'config', ...m } as never);
      expect(env.errors('a').length).toBe(before + 1);
      expect(env.errors('a').at(-1)!.code).toBe('RULES_LOCKED');
    }
    expect(env.room.data.rules.targetScore).toBe(250);
    expect(env.room.data.game!.rules.shotOut).toBe(true);
    // pace + social: allowed
    const before = env.errors('a').length;
    env.send('a', { t: 'config', rules: { ...base, turnTimerSec: { bid: 45, play: 30 } }, talkSec: 45, afkLimit: 5, botTalk: false });
    expect(env.errors('a').length).toBe(before);
    const room = env.last('a', 'state')!.room;
    expect(room.talkSec).toBe(45); expect(room.afkLimit).toBe(5); expect(room.botTalk).toBe(false);
    expect(env.room.data.rules.turnTimerSec).toEqual({ bid: 45, play: 30 });
    // finish the game → unlocked
    for (let i = 0; i < 20000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a'])) env.advance(100);
    expect(env.room.data.phase).toBe('over');
    env.send('a', { t: 'config', rules: { ...base, targetScore: 500 } });
    expect(env.room.data.rules.targetScore).toBe(500);
  });
});

describe('dealer rotation + Shot = out online', () => {
  it('the deal moves one seat clockwise per hand; a rematch continues it', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host'); env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 150, shotOut: false }) });
    env.send('a', { t: 'start' });
    const dealers: number[] = [];
    for (let i = 0; i < 20000 && env.room.data.phase === 'playing'; i++) {
      const g = env.room.data.game!;
      if (dealers[g.handNo - 1] === undefined) dealers[g.handNo - 1] = g.dealer;
      if (!playTurn(env, ['a'])) env.advance(100);
    }
    for (let h = 1; h < dealers.length; h++) expect(dealers[h]).toBe((dealers[h - 1]! + 1) % 4);
    const last = env.room.data.game!.dealer;
    env.send('a', { t: 'rematch' });
    expect(env.room.data.game!.dealer).toBe((last + 1) % 4);
  });
  it('the server ends the game on a shot-out and records it in the series', () => {
    for (let k = 0; k < 40; k++) {
      const env = new FakeEnv(undefined, FAST);
      env.join('a', 'Host'); env.send('a', { t: 'sit', seat: 0 });
      env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 500 }) });
      env.send('a', { t: 'start' });
      for (let i = 0; i < 20000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, ['a'])) env.advance(100);
      const g = env.room.data.game!;
      if (g.result?.endReason !== 'shotOut') continue;
      expect(g.result.shotOut!.length).toBeGreaterThan(0);
      const s = env.last('a', 'state')!.room.series!;
      expect(s.games.at(-1)!.endReason).toBe('shotOut');
      return;
    }
    throw new Error('no shot-out game in 40 tries');
  });
});

describe('partner talk during bidding (all chat is public)', () => {
  const chats = (env: FakeEnv, cid: string) => env.msgs(cid).filter((m) => m.t === 'chat').map((m) => (m as { line: { text: string; hint?: true; from: string | null } }).line);
  it('there is no partner-only channel: a bidding hint goes to the whole table, history included, and is remembered for a bot partner', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'config', rules: makeRules('joker', { firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    expect(env.last('a', 'state')!.view!.phase).toBe('bidding');
    // an old client asking for partner-only delivery is just public chat now (the parser drops `to`)
    env.send('a', { t: 'chat', text: '3-ish', to: 'partner' } as never);
    for (const cid of ['a', 'b', 'c', 'd']) expect(chats(env, cid).map((l) => l.text), cid).toContain('3-ish');
    const line = chats(env, 'b').find((l) => l.text === '3-ish')! as Record<string, unknown>;
    expect(line.partner).toBeUndefined();
    // a reconnecting opponent sees it in the history too
    const tok = (env.msgs('b').find((m) => m.t === 'welcome') as { token: string }).token;
    env.join('b2', 'Ray', tok);
    const w = env.msgs('b2').find((m) => m.t === 'welcome') as { chat: { text: string }[] };
    expect(w.chat.map((l) => l.text)).toContain('3-ish');
    // the hint is stored for seat 0 (so a bot partner bidding later can use it)
    expect(env.room.data.hints?.[0]?.text).toBe('3-ish');
    // during play it's still ordinary public chat (no error)
    for (let i = 0; i < 40 && env.last('a', 'state')!.view!.phase === 'bidding'; i++) playTurn(env, ['a', 'b2', 'c', 'd']);
    expect(env.last('a', 'state')!.view!.phase).toBe('playing');
    const errs = env.errors('a').length;
    env.send('a', { t: 'chat', text: 'I got about 2' });
    expect(env.errors('a').length).toBe(errs);
    expect(chats(env, 'd').map((l) => l.text)).toContain('I got about 2');
  });
  it('bot partners no longer post typed bidding hints (Release 9: partners talk out loud over open mics)', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Dee'); env.join('b', 'Ray');
    env.send('a', { t: 'sit', seat: 0 }); env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'addBot', seat: 2 }); env.send('a', { t: 'addBot', seat: 3 });
    env.send('a', { t: 'config', rules: makeRules('joker', { firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 200 && env.last('a', 'state')!.view!.phase === 'bidding'; i++) if (!playTurn(env, ['a', 'b'])) env.advance(50);
    expect(env.last('a', 'state')!.view!.phase).toBe('playing');
    expect(chats(env, 'a').some((l) => !!l.hint)).toBe(false);
  });
});

describe('venues (Release 7)', () => {
  const room = (env: FakeEnv, cid: string) => env.last(cid, 'state')!.room;
  it('the host picks the venue in the lobby; everyone sees the same one; locked during a game', () => {
    const { env } = fourHumans();
    expect(room(env, 'b').venue).toBe('classic');
    env.send('b', { t: 'venue', venue: 'beach' });
    expect(env.errors('b').at(-1)!.code).toBe('NOT_HOST');
    env.send('a', { t: 'venue', venue: 'speakeasy' });
    for (const cid of ['a', 'b', 'c', 'd']) { expect(room(env, cid).venue).toBe('speakeasy'); expect(room(env, cid).venueNow).toBe('speakeasy'); }
    // garbage is dropped by the parser
    env.send('a', { t: 'venue', venue: 'moon' } as never);
    expect(room(env, 'a').venue).toBe('speakeasy');
    env.send('a', { t: 'start' });
    expect(room(env, 'c').venueNow).toBe('speakeasy');
    env.send('a', { t: 'venue', venue: 'yacht' });
    expect(env.errors('a').at(-1)!.code).toBe('IN_GAME');
    expect(room(env, 'd').venue).toBe('speakeasy');
  });
  it('Random is rolled once per game on the server, the same for every player, never classic', () => {
    const { env } = fourHumans();
    env.send('a', { t: 'venue', venue: 'random' });
    expect(room(env, 'a').venue).toBe('random');
    expect(room(env, 'a').venueNow).toBeUndefined();
    env.send('a', { t: 'start' });
    const v = room(env, 'a').venueNow;
    expect(v).toBeDefined();
    expect(v).not.toBe('classic');
    for (const cid of ['b', 'c', 'd']) expect(room(env, cid).venueNow).toBe(v);
  });
});

/* ------------------------------------------------------------ Release 10: spectators */
describe('spectators', () => {
  function liveGame() {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Dee');
    env.send('a', { t: 'sit', seat: 0 });
    for (const s of [1, 2, 3]) env.send('a', { t: 'addBot', seat: s });
    env.send('a', { t: 'start' });
    return { env, a };
  }
  const handCards = (v: unknown) => JSON.stringify(v);

  it('a spectator gets a redacted view: no hand, no legal moves, no bid options, at every step of a game', () => {
    const { env } = liveGame();
    env.join('s', 'Watcher');
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const st = env.last('s', 'state')!;
      expect(st.seat).toBeNull();
      expect(st.spectator).toBe(true);
      const v = st.view!;
      expect(v).toBeTruthy();
      expect(v.hand).toBeNull();
      expect(v.legal).toEqual([]);
      expect(v.bidOptions).toBeNull();
      expect(v.canRunIt).toBe(false);
      // none of the cards still in anyone's hand appears anywhere in the spectator's message
      const g = env.room.data.game!;
      const raw = env.raw.filter((m) => m.t === 'state' && (m as { spectator?: boolean }).spectator).at(-1)!;
      const r0 = JSON.parse(JSON.stringify(raw)) as { room: { rules?: unknown }; view: { rules?: unknown } };
      delete r0.room.rules; delete r0.view.rules; // the rules name the trump cards (LJ, BJ, …): not a hand
      const text = handCards(r0);
      for (const hand of g.hands) for (const c of hand) expect(text.includes(`"${c}"`), `${c} leaked`).toBe(false);
      checked++;
      if (!playTurn(env, ['a'])) env.advance(200);
      if (env.room.data.game!.handNo > 1) break;
    }
    // Run-it can finish a books hand once four cards remain, so a full watch of hand 1
    // is sometimes only the mid-teens. The floor stays under that.
    expect(checked).toBeGreaterThan(12);
  });

  it('a spectator still gets a redacted view when nil rules are missing during bidding', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Dee');
    env.send('a', { t: 'sit', seat: 0 });
    for (const s of [1, 2, 3]) env.send('a', { t: 'addBot', seat: s });
    env.send('a', { t: 'config', rules: makeRules('joker', { firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    expect(env.room.data.game!.phase).toBe('bidding');
    delete (env.room.data.game!.rules as { nil?: unknown }).nil;
    delete (env.room.data.game!.rules as { blindNil?: unknown }).blindNil;
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    try {
      env.join('s', 'Watcher');
      for (let i = 0; i < 40; i++) {
        const st = env.last('s', 'state')!;
        expect(st.spectator).toBe(true);
        expect(st.seat).toBeNull();
        const v = st.view!;
        expect(v.hand).toBeNull();
        expect(v.legal).toEqual([]);
        expect(v.bidOptions).toBeNull();
        expect(v.rules.nil.allowed).toBe(true);
        expect(v.rules.blindNil.allowed).toBe(true);
        if (!playTurn(env, ['a'])) env.advance(200);
        if (env.room.data.game!.bids.every((b) => b !== null)) break;
      }
    } finally {
      console.error = orig;
    }
    expect(logged.some((l) => l.includes('allowed'))).toBe(false);
    expect(env.room.data.game!.bids.every((b) => b !== null)).toBe(true);
    expect(env.room.data.game!.rules.nil).toEqual({ allowed: true, value: 100 });
    expect(env.room.data.game!.rules.blindNil.allowed).toBe(true);
  });

  it('spectators cannot act, bid, ready up or transmit media', () => {
    const { env } = liveGame();
    env.join('s', 'Watcher');
    env.send('s', { t: 'act', action: { type: 'reveal' }, seq: env.room.data.seq });
    expect(env.errors('s').map((e) => e.code)).toContain('NOT_SEATED');
    env.send('s', { t: 'media', media: { cam: true, mic: true } });
    expect(env.room.data.members[Object.keys(env.room.data.members).find((k) => env.room.data.members[k]!.name === 'Watcher')!]!.media).toEqual({ cam: false, mic: false });
  });

  it('room info lists spectators and the takeable seats; tableOpts (host) can lock bots and make the table private', () => {
    const { env, a } = liveGame();
    env.join('s', 'Watcher');
    const room = env.last('a', 'state')!.room;
    expect(room.spectators!.map((x) => x.name)).toEqual(['Watcher']);
    expect(room.takeable).toEqual([1, 2, 3]);
    env.send('s', { t: 'tableOpts', replaceBots: false });
    expect(env.errors('s').map((e) => e.code)).toContain('NOT_HOST');
    env.send('a', { t: 'tableOpts', replaceBots: false, private: true });
    expect(env.last('s', 'state')!.room.takeable).toEqual([]);
    env.send('s', { t: 'sit', seat: 1 });
    expect(env.errors('s').map((e) => e.code)).toContain('SEAT_LOCKED');
    expect(env.room.listing()).toBeNull();
    void a;
  });

  it('take seat: a spectator takes over a vacated seat (hand + score) first come first served; it works even with bots locked', () => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Dee'); env.send('a', { t: 'sit', seat: 0 });
    env.join('b', 'Ray'); env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'addBot', seat: 2 }); env.send('a', { t: 'addBot', seat: 3 });
    env.send('a', { t: 'tableOpts', replaceBots: false });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 30; i++) if (!playTurn(env, ['a', 'b'])) env.advance(100);
    env.join('s', 'Sam'); env.join('t', 'Tia');
    expect(env.last('s', 'state')!.room.takeable).toEqual([]);
    const handBefore = [...env.room.data.game!.hands[1]!];
    env.send('b', { t: 'leave' });
    expect(env.last('s', 'state')!.room.takeable).toEqual([1]);
    env.send('s', { t: 'sit', seat: 1 });
    env.send('t', { t: 'sit', seat: 1 });
    expect(env.errors('t').map((e) => e.code)).toContain('SEAT_TAKEN');
    const st = env.last('s', 'state')!;
    expect(st.seat).toBe(1);
    expect(st.spectator).toBeUndefined();
    expect(st.view!.hand!.sort()).toEqual(env.room.data.game!.hands[1]!.slice().sort());
    expect(handBefore.length).toBeGreaterThanOrEqual(st.view!.hand!.length);
    void a;
    // the game goes on with the new player
    for (let i = 0; i < 400 && env.room.data.phase === 'playing' && env.room.data.game!.handNo === 1; i++) if (!playTurn(env, ['a', 's'])) env.advance(100);
    expect(env.room.data.game!.handNo).toBeGreaterThanOrEqual(1);
  });

  it('taking a seat on its turn restarts the clock for the new player', () => {
    const { env } = liveGame();
    env.join('s', 'Sam');
    // wait until it's a bot's turn, then take that seat before the bot moves
    for (let i = 0; i < 200; i++) {
      const g = env.room.data.game!;
      if (g.turn !== null && g.turn !== 0 && g.phase === 'playing') break;
      if (!playTurn(env, ['a'])) env.advance(5);
    }
    const seat = env.room.data.game!.turn!;
    env.send('s', { t: 'sit', seat });
    const st = env.last('s', 'state')!;
    expect(st.seat).toBe(seat);
    expect(st.view!.turn).toBe(seat);
    expect(st.room.deadline).toBeGreaterThan(env.t + 5000);
    env.send('s', { t: 'act', action: { type: 'play', card: st.view!.legal[0]! }, seq: st.room.seq });
    expect(env.errors('s')).toEqual([]);
  });

  it('tournament tables: watch only', () => {
    const env = new FakeEnv(undefined, FAST);
    env.room.setupTournament({ id: 't1', match: 'm1', reserved: [null, null, null, null], autostartAt: env.t + 10, bots: true }, makeRules('joker'));
    env.join('s', 'Sam');
    env.advance(50);
    expect(env.room.data.phase).not.toBe('lobby');
    const st = env.last('s', 'state')!;
    expect(st.spectator).toBe(true);
    expect(st.room.takeable).toEqual([]);
    env.send('s', { t: 'sit', seat: 1 });
    expect(env.errors('s').map((e) => e.code)).toContain('RESERVED');
    expect(env.room.listing()!.open).toBe(0);
  });

  it('spectator chat is tagged, rate limited harder, and profanity-filtered', () => {
    const { env } = liveGame();
    env.join('s', 'Sam');
    env.send('s', { t: 'chat', text: 'nice shit play' });
    const line = env.last('a', 'chat')!.line;
    expect(line.spectator).toBe(true);
    expect(line.text).not.toContain('shit');
    env.send('a', { t: 'chat', text: 'thanks' });
    expect(env.last('s', 'chat')!.line.spectator).toBeUndefined();
    env.send('s', { t: 'chat', text: '2' }); env.send('s', { t: 'chat', text: '3' }); env.send('s', { t: 'chat', text: '4' });
    expect(env.errors('s').map((e) => e.code)).toContain('RATE_LIMITED');
  });

  it('max 20 spectators per table while a game is on', () => {
    const { env } = liveGame();
    for (let i = 0; i < 20; i++) env.join(`s${i}`, `W${i}`);
    env.room.open('s20');
    env.room.message('s20', JSON.stringify({ t: 'hello', name: 'TooMany' }));
    expect(env.errors('s20').map((e) => e.code)).toContain('TABLE_FULL');
  });

  it('WebRTC: a spectator may signal with a seated player mid-game, never with another spectator', () => {
    const { env, a } = liveGame();
    const s = env.join('s', 'Sam'); const t = env.join('t', 'Tia');
    env.send('s', { t: 'rtc', to: a.pid, data: { x: 1 } });
    expect(env.last('a', 'rtc')).toEqual({ t: 'rtc', from: s.pid, data: { x: 1 } });
    env.send('s', { t: 'rtc', to: t.pid, data: { x: 2 } });
    expect(env.msgs('t').some((m) => m.t === 'rtc')).toBe(false);
  });

  it('listing: public tables report host, mode, seats, status, hand, spectators; private ones are unlisted', () => {
    const { env } = liveGame();
    env.join('s', 'Sam');
    const l = env.room.listing()!;
    expect(l).toMatchObject({ code: 'ABCDE', host: 'Dee', mode: 'joker', playerCount: 4, humans: 1, bots: 3, open: 3, status: 'playing', hand: 1, spectators: 1, seat: 1 });
  });
});

describe('room lifecycle', () => {
  const tok = (s: string) => (s + '0123456789abcdef0123456789abcdef').slice(0, 32);
  const acks = (env: FakeEnv, cid: string) => env.msgs(cid).filter((m) => m.t === 'ack') as Extract<ReturnType<FakeEnv['msgs']>[number], { t: 'ack' }>[];

  it('the same seat token is one member, so a second tab cannot take a second seat', () => {
    const env = new FakeEnv();
    const t = tok('tab');
    const a = env.join('a', 'Dee', t);
    const b = env.join('b', 'Dee', t);
    expect(b.pid).toBe(a.pid);
    expect(b.token).toBe(t);
    expect(Object.keys(env.room.data.members)).toHaveLength(1);
    expect(env.closed).toContain('a');
    env.send('b', { t: 'sit', seat: 0 });
    env.send('a', { t: 'sit', seat: 2 });
    expect(env.errors('a').at(-1)!.code).toBe('NOT_JOINED');
    expect(env.room.data.seats.flatMap((s) => (s.kind === 'human' ? [s.playerId] : []))).toEqual([a.pid]);
  });

  it('the same account is one seat, even with a new token, including mid-game', () => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Dee', tok('old'), 'user-dee');
    env.send('a', { t: 'sit', seat: 0 });
    for (const s of [1, 2, 3]) env.send('a', { t: 'addBot', seat: s });
    env.send('a', { t: 'start' });
    const b = env.join('b', 'Dee', tok('new'), 'user-dee');
    expect(b.pid).toBe(a.pid);
    expect(env.room.data.seats.flatMap((s) => (s.kind === 'human' ? [s] : []))).toHaveLength(1);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    env.send('b', { t: 'sit', seat: 2 });
    expect(env.errors('b').at(-1)!.code).toBe('IN_GAME');
    expect(env.room.data.seats[2]!.kind).toBe('bot');
  });

  it('linking one account onto two seated members keeps a single seat', () => {
    const env = new FakeEnv();
    const a = env.join('a', 'Dee');
    const b = env.join('b', 'Dee');
    env.room.linkUser('a', 'user-dee');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 2 });
    env.room.linkUser('b', 'user-dee');
    expect(Object.keys(env.room.data.members)).toEqual([a.pid]);
    expect(env.room.data.members[a.pid]!.uid).toBe('user-dee');
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.room.data.seats[2]).toEqual({ kind: 'empty' });
    expect(env.last('b', 'welcome')!.you).toBe(a.pid);
  });

  it('a kick sticks to the account, so a fresh token cannot rejoin this game', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Host');
    const b = env.join('b', 'Ray', tok('ray'), 'user-ray');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'addBot', seat: 2 });
    env.send('a', { t: 'addBot', seat: 3 });
    env.send('a', { t: 'start' });
    env.send('a', { t: 'kick', seat: 1 });
    expect(env.room.data.kicked).toEqual(expect.arrayContaining([b.token, 'user-ray']));
    env.room.open('b2');
    env.room.message('b2', JSON.stringify({ t: 'hello', name: 'Ray', token: tok('fresh') }), 'user-ray');
    expect(env.last('b2', 'welcome')).toBeUndefined();
    expect(env.errors('b2')[0]!.code).toBe('KICKED');
    expect(env.closed).toContain('b2');
    expect(Object.values(env.room.data.members).some((m) => m.uid === 'user-ray')).toBe(false);
  });

  it('a guest on the other side does not make the table rated', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Dee', undefined, 'ua');
    env.join('b', 'Ray');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'addBot', seat: 2 });
    env.send('a', { t: 'addBot', seat: 3 });
    env.send('a', { t: 'start' });
    expect(env.room.data.rated).toBe(false);
  });

  it('rated tables default to locked bots and require an account to take a seat mid-game', () => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Dee', undefined, 'ua');
    const b = env.join('b', 'Ray', undefined, 'ub');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'addBot', seat: 2 });
    env.send('a', { t: 'addBot', seat: 3 });
    expect(env.last('a', 'state')!.room.replaceBots).toBe(false);
    env.send('a', { t: 'start' });
    expect(env.room.data.rated).toBe(true);
    expect(env.last('b', 'state')!.room.takeable).toEqual([]);
    const g = env.join('g', 'Guest');
    env.send('g', { t: 'sit', seat: 2 });
    expect(env.errors('g').map((e) => e.code)).toContain('SEAT_LOCKED');
    // the host can opt in; a guest still cannot take a seat in a rated game
    env.send('a', { t: 'tableOpts', replaceBots: true });
    expect(env.last('g', 'state')!.room.takeable).toEqual([2, 3]);
    env.send('g', { t: 'sit', seat: 2 });
    expect(env.errors('g').map((e) => e.code)).toContain('ACCOUNT_REQUIRED');
    expect(env.room.data.seats[2]!.kind).toBe('bot');
    env.send('a', { t: 'tableOpts', replaceBots: false });
    env.send('b', { t: 'leave' });
    expect(env.room.data.rated).toBe(true);
    expect(env.last('g', 'state')!.room.takeable).toEqual([1]);
    env.send('g', { t: 'sit', seat: 1 });
    expect(env.errors('g').map((e) => e.code)).toContain('ACCOUNT_REQUIRED');
    const c = env.join('c', 'Kim', undefined, 'uc');
    env.send('c', { t: 'sit', seat: 1 });
    expect(env.errors('c')).toEqual([]);
    expect(env.room.data.seats[1]).toMatchObject({ kind: 'human', playerId: c.pid });
    void g;
  });

  it('a seated host who disconnects passes host after a grace period, so the table can start', () => {
    const env = new FakeEnv();
    const a = env.join('a', 'Dee');
    const b = env.join('b', 'Ray');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 1 });
    env.room.close('a');
    env.advance(HOST_DISCONNECT_GRACE_MS - 1000);
    expect(env.last('b', 'state')!.room.hostId).toBe(a.pid);
    env.send('b', { t: 'start' });
    expect(env.errors('b').at(-1)!.code).toBe('NOT_HOST');
    env.advance(2000);
    expect(env.last('b', 'state')!.room.hostId).toBe(b.pid);
    expect(env.room.data.chat.some((l) => l.text === 'Ray is now the host')).toBe(true);
    env.send('b', { t: 'start' });
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
  });

  it('reconnecting within the grace keeps the host', () => {
    const env = new FakeEnv();
    const a = env.join('a', 'Dee');
    env.join('b', 'Ray');
    env.send('a', { t: 'sit', seat: 0 });
    env.room.close('a');
    env.advance(10_000);
    const again = env.join('z', 'Dee', a.token);
    expect(again.pid).toBe(a.pid);
    expect(env.last('b', 'state')!.room.hostId).toBe(a.pid);
  });

  it('a disconnected host no longer blocks rematch once the grace has passed', () => {
    const env = new FakeEnv();
    const a = env.join('a', 'Dee');
    const b = env.join('b', 'Ray');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 1 });
    env.room.data.phase = 'over';
    env.room.close('a');
    env.advance(HOST_DISCONNECT_GRACE_MS - 1000);
    env.send('b', { t: 'rematch' });
    expect(env.errors('b').at(-1)!.code).toBe('NOT_HOST');
    env.advance(2000);
    env.send('b', { t: 'rematch' });
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.hostId).toBe(b.pid);
  });

  it('disconnected unseated members do not count toward the table caps', () => {
    const env = new FakeEnv(undefined, FAST);
    const a = env.join('a', 'Dee');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'start' });
    for (let i = 0; i < 20; i++) env.join(`s${i}`, `W${i}`);
    env.room.open('full');
    env.room.message('full', JSON.stringify({ t: 'hello', name: 'Full' }));
    expect(env.errors('full').map((e) => e.code)).toContain('TABLE_FULL');
    for (let i = 0; i < 20; i++) env.room.close(`s${i}`);
    expect(Object.keys(env.room.data.members)).toEqual([a.pid]);
    const late = env.join('late', 'Late');
    expect(late.pid).toBeTruthy();
    expect(env.errors('late')).toEqual([]);
    expect(env.last('a', 'state')!.room.spectators).toEqual([{ playerId: late.pid, name: 'Late' }]);
    // a spectator whose socket vanished without close (hibernation) is dropped on the next hello
    env.join('ghost', 'Ghost');
    env.restart([['a', a.pid]]);
    expect(Object.values(env.room.data.members).some((m) => m.name === 'Ghost')).toBe(true);
    env.join('back', 'Back');
    expect(Object.values(env.room.data.members).map((m) => m.name).sort()).toEqual(['Back', 'Dee']);
  });

  it('an act without seq is stale, so a late play cannot become the next lead', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Slow');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: 5, play: 5 } }) });
    env.send('a', { t: 'start' });
    // pin the lead (the deal's leader is random) so the missing-seq check is what the test measures
    const lead = () => {
      const d = env.room.data;
      const g = d.game!;
      d.game = { ...g, phase: 'playing', hands: [['AS', 'KS'], ['3C', '4C'], ['5D', '6D'], ['7H', '8H']] as never, bids: [1, 1, 1, 1], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, plays: [], winner: null }, spadesBroken: true } as never;
      d.seq = (d.seq ?? 0) + 1;
      d.turnKey = null;
      d.deadline = null;
      env.room.tick();
    };
    lead();
    const card = 'AS';
    const seq = env.room.data.seq!;
    env.send('a', { t: 'act', id: 'noseq', action: { type: 'play', card } });
    expect(acks(env, 'a').at(-1)).toMatchObject({ id: 'noseq', ok: false, stale: true });
    expect(env.room.data.seq).toBe(seq);
    expect(env.room.data.game!.hands[0]).toContain(card);
    expect(env.room.data.game!.trick.plays).toEqual([]);
    expect(env.errors('a')).toEqual([]);
    env.advance(8000); // the turn timer auto-plays the lead; seq moves on
    expect(env.room.data.seq).not.toBe(seq);
    expect(env.room.data.game!.hands[0]).not.toContain(card);
    // that same player is on lead again; the late packet still has no seq and must not play
    lead();
    const seq2 = env.room.data.seq!;
    env.send('a', { t: 'act', action: { type: 'play', card: 'KS' } });
    expect(env.room.data.seq).toBe(seq2);
    expect(env.room.data.game!.trick.plays).toEqual([]);
    expect(env.room.data.game!.hands[0]).toContain('KS');
  });
});
