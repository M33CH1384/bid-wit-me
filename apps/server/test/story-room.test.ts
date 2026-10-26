/**
 * Story co-op rooms (spec §2): reserved pair seats, story bots at tier skill,
 * the both-ready phase machine, Dee covering a vacated seat, concede, and the
 * witnessed game-over — with NO regular game record ever written.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Card, GameState } from '@spades/rules';
import { GUIDE_FINALE, chooseBotAction } from '@spades/bots';
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

describe('the King finale (Phase 4, spec §6)', () => {
  /** A King room whose pair already holds the double mark (leg 1 won in an earlier room). */
  function finaleRoom() {
    const env = new FakeEnv(undefined, FAST);
    env.room.setupStory('king', 'ua', 'uc', { king: 'finale' });
    const host = env.join('a', 'Host', undefined, 'ua');
    const partner = env.join('c', 'Partner', undefined, 'uc');
    return { env, host, partner };
  }
  const guideLines = (env: FakeEnv) => env.msgs('a')
    .filter((m) => m.t === 'chat')
    .map((m) => (m as { line: { from?: string; text: string } }).line)
    .filter((l) => l.from === 'guide:dee')
    .map((l) => l.text);
  /** Play one turn; humans always bid the minimum (a contract they are
   *  near-certain to make), everything else is bot-chosen. */
  function playMinBid(env: FakeEnv, cids: string[]): boolean {
    for (const cid of cids) {
      const st = env.last(cid, 'state');
      const v = st?.view;
      if (!v || st.room.phase !== 'playing') continue;
      if (v.phase === 'handOver') { env.send(cid, { t: 'next' }); continue; }
      if (v.turn !== v.seat) continue;
      const a = chooseBotAction(v, 'normal');
      if (!a) continue;
      const action: GameAction = a.type === 'bid' ? { type: 'bid', bid: 1 }
        : a.type === 'reveal' ? { type: 'reveal' }
        : a.type === 'play' ? { type: 'play', card: a.card }
        : a.type === 'runIt' ? { type: 'runIt' }
        : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
      env.send(cid, { t: 'act', action, seq: st.room.seq });
      return true;
    }
    return false;
  }
  function playOut(env: FakeEnv, cap = 40000) {
    for (let i = 0; i < cap && env.room.data.phase === 'playing'; i++) {
      if (!playMinBid(env, ['a', 'c'])) env.advance(100);
    }
  }
  const toFinale = (env: FakeEnv) => { readyBoth(env); }; // lobby → finale (mark standing)
  const agree = (env: FakeEnv, choice: 'cutthroat' | 'bank') => {
    env.send('a', { t: 'storyFinale', choice });
    env.send('c', { t: 'storyFinale', choice });
  };

  it('routes a mark-holding pair to the proposal (short form), not the tape', () => {
    const { env } = finaleRoom();
    toFinale(env);
    const s = env.room.data.story!;
    expect(s.phase).toBe('finale');
    expect(s.finale).toMatchObject({ short: true, choices: {} });
    const view = env.last('a', 'state')!.room.story!;
    expect(view.phase).toBe('finale');
    expect(view.finale).toMatchObject({ short: true, choices: [] });
  });

  it('a King room without the mark plays the tape as usual', () => {
    const { env } = storyRoom('king');
    readyBoth(env);
    expect(env.room.data.story!.phase).toBe('tape');
  });

  it('both must agree: a lone answer — and a disagreement — park the proposal with nothing lost', () => {
    const { env } = finaleRoom();
    toFinale(env);
    env.send('a', { t: 'storyFinale', choice: 'cutthroat' });
    expect(env.room.data.story!.phase).toBe('finale'); // one answer is not an answer
    expect(env.last('c', 'state')!.room.story!.finale!.choices).toEqual([{ uid: 'ua', choice: 'cutthroat' }]); // visible to both
    env.send('c', { t: 'storyFinale', choice: 'bank' });
    expect(env.room.data.story!.phase).toBe('finale'); // disagreement: parked
    expect(env.room.data.game).toBeNull();
    expect(env.storyResults.length).toBe(0);
    // minds can change: the partner comes around and the room converts
    env.send('c', { t: 'storyFinale', choice: 'cutthroat' });
    expect(env.room.data.story!.phase).toBe('finale-game');
  });

  it('accepting converts in place: cutthroat rules, same seats, Dee guiding from the rail', () => {
    const { env } = finaleRoom();
    toFinale(env);
    const namesBefore = env.room.data.seats.map((s) => (s.kind === 'bot' ? s.name : s.kind));
    agree(env, 'cutthroat');
    const d = env.room.data;
    const s = d.story!;
    expect(s.phase).toBe('finale-game');
    expect(d.phase).toBe('playing');
    expect(d.game).not.toBeNull();
    expect(d.rules.partnerships).toBe(false); // the shipped 4P cutthroat preset
    expect(d.rules.targetScore).toBe(300);
    expect(d.seats[0]).toMatchObject({ kind: 'human' });
    expect(d.seats[2]).toMatchObject({ kind: 'human' });
    expect(d.seats.map((x) => (x.kind === 'bot' ? x.name : x.kind))).toEqual(namesBefore); // the King and the Ringer stay across
    expect(guideLines(env)).toContain(GUIDE_FINALE[0]); // Dee opens the cutthroat — from the rail, never a seat
    expect(d.seats.some((x) => x.kind === 'bot' && x.name === 'Dee')).toBe(false);
  });

  it('declining banks leg 1: the room witnesses the decline under its own gameId', () => {
    const { env } = finaleRoom();
    toFinale(env);
    agree(env, 'bank');
    const s = env.room.data.story!;
    expect(s.phase).toBe('outro');
    expect(s.finale).toMatchObject({ outcome: 'declined' });
    expect(env.storyResults.length).toBe(1);
    const w = env.storyResults[0]!;
    expect(w).toMatchObject({ track: 'pair:ua:uc', stopId: 'king', won: true });
    expect(w.finale).toEqual({ outcome: 'declined' });
    expect(w.gameId.endsWith('-decline')).toBe(true);
    // the outro posts against the decline's id, never leg 1's family id
    expect(env.last('a', 'state')!.room.story!.gameId).toBe(w.gameId);
    expect(env.room.data.game).toBeNull(); // no game was played
  });

  it('a human winning the cutthroat pays the double (played out)', () => {
    // Pin the room's randomness so the played-out game is reproducible: the
    // deal seed comes from secureSeed() (crypto.getRandomValues) and bot bid
    // leans / talk from Math.random. Unpinned, about 1 run in 40 the deal + leans
    // set the host on hand 1 (Shot = out) and the double is (correctly) lost.
    let x = 0x2f6b1d;
    const next = () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0);
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => next() / 2 ** 32);
    const cspy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => { const u = a as unknown as Uint32Array; for (let i = 0; i < u.length; i++) u[i] = next(); return a; });
    try {
    const { env } = finaleRoom();
    toFinale(env);
    agree(env, 'cutthroat');
    const g = env.room.data.game!;
    g.scores = [299, 0, 0, 0]; // the host sits one made minimum contract from the crown
    env.room.testLoadGame(g);
    playOut(env);
    const s = env.room.data.story!;
    expect(env.room.data.phase).toBe('over');
    expect(s.phase).toBe('outro');
    expect(s.finale).toMatchObject({ outcome: 'double' });
    expect(env.storyResults.length).toBe(1);
    expect(env.storyResults[0]).toMatchObject({ won: true, stopId: 'king' });
    expect(env.storyResults[0]!.finale).toEqual({ outcome: 'double' });
    const lines = guideLines(env);
    expect(lines.some((t) => t === GUIDE_FINALE[10] || t === GUIDE_FINALE[11])).toBe(true); // her resolution read
    expect(lines.length).toBeLessThanOrEqual(4); // the finale budget, start to resolution
    } finally { spy.mockRestore(); cspy.mockRestore(); }
  });

  it('placements map to outcomes: a human 2nd banks the clear; both humans 3rd/4th loses it', () => {
    const finishWith = (placements: number[], scores: number[]) => {
      const { env } = finaleRoom();
      toFinale(env);
      agree(env, 'cutthroat');
      const d = env.room.data;
      d.game = { scores, history: [], result: { placements, winners: [placements.indexOf(1)], finalScores: scores } } as unknown as GameState;
      (env.room as unknown as { storyFinaleGameOver(): void }).storyFinaleGameOver();
      return env;
    };
    const clear = finishWith([3, 1, 2, 4], [200, 320, 280, 100]); // King 1st, the partner 2nd
    expect(clear.storyResults[0]).toMatchObject({ won: true });
    expect(clear.storyResults[0]!.finale).toEqual({ outcome: 'clear' });
    const lost = finishWith([3, 1, 4, 2], [150, 320, 90, 280]); // both humans off the podium
    expect(lost.storyResults[0]).toMatchObject({ won: false });
    expect(lost.storyResults[0]!.finale).toEqual({ outcome: 'lost' });
    // partner-last double: the host wins it, the partner finishes last — still 'double'
    const dbl = finishWith([1, 2, 4, 3], [330, 300, 40, 210]);
    expect(dbl.storyResults[0]!.finale).toEqual({ outcome: 'double' });
  });

  it('a finale concede settles as a lost gamble', () => {
    const { env } = finaleRoom();
    toFinale(env);
    agree(env, 'cutthroat');
    env.send('c', { t: 'concede' });
    const s = env.room.data.story!;
    expect(s.phase).toBe('outro');
    expect(s.concededBy).toBe('Partner');
    expect(env.storyResults.length).toBe(1);
    expect(env.storyResults[0]).toMatchObject({ won: false, stopId: 'king' });
    expect(env.storyResults[0]!.finale).toEqual({ outcome: 'lost' });
  });

  it('Dee never covers inside the cutthroat — a dropped seat gets a standard pro bot', () => {
    const { env, partner } = finaleRoom();
    toFinale(env);
    agree(env, 'cutthroat');
    env.room.close('c');
    env.advance(6000); // past the 5s test grace
    const seat = env.room.data.seats[2]!;
    expect(seat.kind).toBe('bot');
    if (seat.kind === 'bot') {
      expect(seat.name).not.toBe('Dee');
      expect(seat.level).toBe('pro');
      expect(seat.was).toBe('Partner');
      expect(seat.replacedPid).toBe(partner.pid);
    }
    // and she is still only guiding: her lines keep coming from the rail
    expect(env.room.data.story!.guide).toBeDefined();
  });

  it('Dee’s finale lines stay in the finale pool, unrepeated, within budget', () => {
    const { env } = finaleRoom();
    toFinale(env);
    agree(env, 'cutthroat');
    // play until six hands are on the books or the game ends
    for (let i = 0; i < 40000 && env.room.data.phase === 'playing' && (env.room.data.game?.history.length ?? 0) < 6; i++) {
      if (!playMinBid(env, ['a', 'c'])) env.advance(100);
    }
    expect((env.room.data.game?.history.length ?? 0)).toBeGreaterThan(0);
    const lines = guideLines(env);
    expect(lines.length).toBeGreaterThanOrEqual(1); // at least the start line
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(new Set(lines).size).toBe(lines.length); // never twice the same line
    for (const t of lines) expect(GUIDE_FINALE).toContain(t); // the finale pool only
  });

  it('an in-room leg-1 win routes the outro to the proposal — full scene', () => {
    const { env } = storyRoom('king'); // no mark yet: this room plays leg 1 itself
    toGame(env);
    const g = env.room.data.game!;
    g.scores = [740, 100]; // one made minimum contract from the win
    env.room.testLoadGame(g);
    playOut(env);
    const s = env.room.data.story!;
    expect(env.room.data.phase).toBe('over');
    expect(s.phase).toBe('outro');
    expect(env.storyResults.length).toBe(1);
    expect(env.storyResults[0]).toMatchObject({ won: true, stopId: 'king' });
    expect(env.storyResults[0]!.finale).toBeUndefined(); // leg 1 is an ordinary witness
    readyBoth(env); // the outro pair readies → the proposal, full form
    expect(s.phase).toBe('finale');
    expect(s.finale).toMatchObject({ short: false });
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
