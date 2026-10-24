/**
 * WORD TRAVELS FAST at the co-op table (owner, 2026-10-24; the solo
 * build 06965314 left this parity gap): the forward buzz — the seated
 * pair gossiping about how the pair handled the PREVIOUS stop — was
 * driven only by the solo table (Table.tsx, state in the device save).
 * In co-op the ROOM drives it: same selector and pools
 * (@spades/bots buzzMomentFor, unchanged), same moments (the sit-down,
 * hand ends no scripted beat took), same discipline (seeded
 * per-attempt roll, cap one a match, said-set no-repeat) — with the
 * per-match cursor and the PAIR track's facts held in the room, so
 * both partners render the ONE line the room chose and a reconnect
 * replays it instead of rolling again.
 *
 * Fixtures mirror story-guide.test.ts: pinned deal entropy, fast
 * timings, bot-driven hands. The buzz stream is a pure hash, so the
 * firing attempts values are found by scanning the selector itself —
 * the same expectations the room is then held to, verbatim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRng, type Card } from '@spades/rules';
import {
  STORY_BUZZ, buzzMomentFor, chooseBotAction, mannerBandOf, storyFactsOf, storyPairTrackKey, storyStopById, targetForStop,
  type BuzzFacts, type StoryBuzzInput,
} from '@spades/bots';
import type { ChatLine, GameAction } from '@spades/protocol';
import { FakeEnv } from './harness';
import { makeD1 } from './d1';
import { buzzInputsFor } from '../src/story/routes';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

function pinEntropy() {
  const stream = createRng('story-buzz-deals');
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: ArrayBufferView) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = stream.int(256);
    return array;
  }) as typeof crypto.getRandomValues);
}

const SHOP = storyStopById('barbershop')!;
const PORCH_FACTS = { prevStopName: 'The Porch', prevPairNames: 'Uncle Ray and Pat' };
const BASEMENT_FACTS = { prevStopName: 'The Church Basement', prevPairNames: 'Deacon Ford and Sister Mae' };

/** The first attempts count whose seeded stream fires the given moment
 *  at the given check cursor under the given facts (the stream is a
 *  pure hash — this is a fixture lookup, and the room must agree). */
function firingAttempts(stopId: string, moment: 'sitDown' | 'handEnd', checks: number, over: Partial<BuzzFacts>, sitDownMustPass = false): { attempts: number; beats: { speaker: string; line: string }[] } {
  const stop = storyStopById(stopId)!;
  for (let a = 0; a < 500; a++) {
    if (sitDownMustPass && buzzMomentFor(stop, 'sitDown', { attempts: a, checks: 0, fired: 0, said: [], ...over })) continue;
    const beats = buzzMomentFor(stop, moment, { attempts: a, checks, fired: 0, said: [], ...over });
    if (beats) return { attempts: a, beats };
  }
  throw new Error(`no firing attempts for ${stopId} ${moment}@${checks}`);
}

const BUZZ_TEXTS = new Set(Object.values(STORY_BUZZ).flatMap((set) => [...set.smoke, ...set.war, ...set.word, ...set.grind].flatMap((beats) => beats.map((b) => b.line))));

function storyRoom(stopId: string, buzz?: Record<string, StoryBuzzInput>) {
  const env = new FakeEnv(undefined, FAST);
  env.room.setupStory(stopId, 'ua', 'uc', undefined, buzz);
  const host = env.join('a', 'Host', undefined, 'ua');
  const partner = env.join('c', 'Partner', undefined, 'uc');
  return { env, host, partner };
}
function readyBoth(env: FakeEnv) {
  env.send('a', { t: 'storyReady' });
  env.send('c', { t: 'storyReady' });
}
function toGame(env: FakeEnv) {
  readyBoth(env); readyBoth(env); readyBoth(env);
  env.advance(50);
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
function playOut(env: FakeEnv, cids = ['a', 'c'], cap = 20000) {
  for (let i = 0; i < cap && env.room.data.phase === 'playing'; i++) {
    if (!playTurn(env, cids)) env.advance(100);
  }
}
function playToHistory(env: FakeEnv, hands: number, cids = ['a', 'c'], cap = 20000) {
  for (let i = 0; i < cap && env.room.data.phase === 'playing' && (env.room.data.game?.history.length ?? 0) < hands; i++) {
    if (!playTurn(env, cids)) env.advance(100);
  }
}
const chatLines = (env: FakeEnv, cid: string): ChatLine[] =>
  env.msgs(cid).filter((m) => m.t === 'chat').map((m) => (m as { line: ChatLine }).line);
const buzzLines = (env: FakeEnv, cid: string): ChatLine[] => chatLines(env, cid).filter((l) => BUZZ_TEXTS.has(l.text));
/** Everything buzz-shaped a client has ever received: live chat pushes
 *  PLUS the history its latest welcome carried. A rejoining client gets
 *  the line from history — counting only pushes would mistake the
 *  replay for a re-fire (or miss one). */
const allBuzzReceived = (env: FakeEnv, cid: string): ChatLine[] => [
  ...(env.last(cid, 'welcome')?.chat ?? []).filter((l) => BUZZ_TEXTS.has(l.text)),
  ...buzzLines(env, cid),
];

describe('forward buzz in the story room (word travels fast, co-op)', () => {
  beforeEach(() => { pinEntropy(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('fires at the sit-down from the pair track’s facts — ONE line, identical on both clients, text-only', () => {
    const { attempts, beats } = firingAttempts('barbershop', 'sitDown', 0, { prevWon: true, prevBand: 'rout', ...PORCH_FACTS });
    const { env } = storyRoom('barbershop', { barbershop: { attempts, prevWon: true, prevBand: 'rout', ...PORCH_FACTS } });
    toGame(env);
    const st = env.room.data.story!;
    expect(st.buzzState).toEqual({ checks: 1, fired: 1, said: beats.map((b) => b.line) });
    for (const cid of ['a', 'c']) {
      const mine = buzzLines(env, cid);
      expect(mine.map((l) => l.text)).toEqual(beats.map((b) => b.line));
      for (const l of mine) {
        expect(l.bot).toBeUndefined(); // THE FENCE: no persona payload → never voiced from a substitute
        expect(l.system).toBeUndefined();
      }
    }
    // the two clients hold the identical line — same chat id, same text
    expect(buzzLines(env, 'a').map((l) => l.id)).toEqual(buzzLines(env, 'c').map((l) => l.id));
    // the speaker is the seated character, from her seat, under her name
    const line = buzzLines(env, 'a')[0]!;
    const seat = SHOP.pair[0] === beats[0]!.speaker ? 1 : 3;
    expect(line.from).toBe(`bot:${seat}`);
    expect(line.name).toBe(beats[0]!.speaker === 'june' ? 'June' : 'Mr. Coleman');
  });

  it('band gates ride through the driver: a close win draws the war family, never smoke', () => {
    const { attempts, beats } = firingAttempts('barbershop', 'sitDown', 0, { prevWon: true, prevBand: 'close', ...PORCH_FACTS });
    const warTexts = new Set(STORY_BUZZ['barbershop']!.war.flatMap((bs) => bs.map((b) => b.line)));
    const smokeTexts = new Set(STORY_BUZZ['barbershop']!.smoke.flatMap((bs) => bs.map((b) => b.line)));
    const { env } = storyRoom('barbershop', { barbershop: { attempts, prevWon: true, prevBand: 'close', ...PORCH_FACTS } });
    toGame(env);
    const mine = buzzLines(env, 'a');
    expect(mine.map((l) => l.text)).toEqual(beats.map((b) => b.line));
    for (const l of mine) { expect(warTexts.has(l.text)).toBe(true); expect(smokeTexts.has(l.text)).toBe(false); }
  });

  it('band gates ride through the driver: the pair’s latest there was a LOSS — the grind family, honestly', () => {
    const { attempts, beats } = firingAttempts('barbershop', 'sitDown', 0, { prevWon: false, prevBand: null, ...PORCH_FACTS });
    const grindTexts = new Set(STORY_BUZZ['barbershop']!.grind.flatMap((bs) => bs.map((b) => b.line)));
    const { env } = storyRoom('barbershop', { barbershop: { attempts, prevWon: false, ...PORCH_FACTS } });
    toGame(env);
    const mine = buzzLines(env, 'a');
    expect(mine.map((l) => l.text)).toEqual(beats.map((b) => b.line));
    for (const l of mine) expect(grindTexts.has(l.text)).toBe(true);
  });

  it('the cap holds across a whole match: evaluated at hand ends, fired exactly once, never repeated', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // Dee's chance-gated chatter stays home; her ungated reads still take some hand ends
    try {
      const { attempts, beats } = firingAttempts('barbershop', 'sitDown', 0, { prevWon: true, prevBand: 'rout', ...PORCH_FACTS });
      const { env } = storyRoom('barbershop', { barbershop: { attempts, prevWon: true, prevBand: 'rout', ...PORCH_FACTS } });
      toGame(env);
      playOut(env);
      expect(env.room.data.phase).toBe('over');
      const st = env.room.data.story!;
      expect(st.buzzState!.fired).toBe(1);
      expect(st.buzzState!.checks).toBeGreaterThan(1); // hand ends were evaluated too
      expect(st.buzzState!.said).toEqual(beats.map((b) => b.line));
      for (const cid of ['a', 'c']) {
        expect(buzzLines(env, cid).map((l) => l.text)).toEqual(beats.map((b) => b.line));
      }
    } finally {
      vi.restoreAllMocks();
      pinEntropy();
    }
  });

  it('a hand end the guide didn’t take can carry it (the Rooftop: her spacing keeps her home on hand 1)', () => {
    // attempts where the sit-down roll passes but hand end #1 fires —
    // the picked line is Dee’s own, so it rides her guide byline.
    const { attempts, beats } = firingAttempts('rooftop', 'handEnd', 1, { prevWon: true, prevBand: 'rout', ...BASEMENT_FACTS }, true);
    const { env } = storyRoom('rooftop', { rooftop: { attempts, prevWon: true, prevBand: 'rout', ...BASEMENT_FACTS } });
    toGame(env);
    // the sit-down was evaluated and passed in silence
    expect(env.room.data.story!.buzzState).toEqual({ checks: 1, fired: 0, said: [] });
    expect(buzzLines(env, 'a')).toEqual([]);
    playToHistory(env, 1);
    expect(env.room.data.game!.history.length).toBe(1);
    expect(env.room.data.phase).toBe('playing'); // the hand closed the hand, not the match
    const st = env.room.data.story!;
    expect(st.buzzState).toEqual({ checks: 2, fired: 1, said: beats.map((b) => b.line) });
    for (const cid of ['a', 'c']) {
      const mine = buzzLines(env, cid);
      expect(mine.map((l) => l.text)).toEqual(beats.map((b) => b.line));
      expect(mine[0]!.from).toBe('guide:dee'); // Dee's line, her byline — the rail seam
      expect(mine[0]!.bot).toBeUndefined();
    }
    expect(buzzLines(env, 'a').map((l) => l.id)).toEqual(buzzLines(env, 'c').map((l) => l.id));
  });

  it('a reconnect can never re-fire it: the line is replayed from the shared chat, the cursor never re-rolls', () => {
    const { attempts, beats } = firingAttempts('barbershop', 'sitDown', 0, { prevWon: true, prevBand: 'rout', ...PORCH_FACTS });
    const { env, host, partner } = storyRoom('barbershop', { barbershop: { attempts, prevWon: true, prevBand: 'rout', ...PORCH_FACTS } });
    toGame(env);
    expect(env.room.data.story!.buzzState!.fired).toBe(1);

    // the partner drops and returns on a fresh socket (member token):
    env.room.close('c');
    const back = env.join('c2', 'Partner', partner.token, 'uc');
    expect(back.pid).toBe(partner.pid);
    const inHistory = (env.last('c2', 'welcome')?.chat ?? []).filter((l) => BUZZ_TEXTS.has(l.text));
    expect(inHistory.map((l) => l.text)).toEqual(beats.map((b) => b.line)); // present once — replayed, not re-decided
    playToHistory(env, 2, ['a', 'c2']);
    expect(allBuzzReceived(env, 'c2').map((l) => l.text)).toEqual(beats.map((b) => b.line)); // and never pushed again

    // a full DO rebuild from the persisted data (hibernation wake) keeps the spent cap
    env.restart([['a', host.pid], ['c2', partner.pid]]);
    expect(env.room.data.story!.buzzState).toEqual({ checks: expect.any(Number), fired: 1, said: beats.map((b) => b.line) });
    playToHistory(env, 3, ['a', 'c2']);
    for (const cid of ['a', 'c2']) {
      expect(allBuzzReceived(env, cid).map((l) => l.text)).toEqual(beats.map((b) => b.line));
    }
    expect(env.room.data.story!.buzzState!.fired).toBe(1);
  });

  it('no pair-track fact at the previous stop → silence, however long the match runs', () => {
    // (a) the room was never seeded with buzz inputs at all
    const a = storyRoom('barbershop');
    toGame(a.env);
    playToHistory(a.env, 3);
    expect(a.env.room.data.story!.buzzState!.fired).toBe(0);
    expect(buzzLines(a.env, 'a')).toEqual([]);
    expect(buzzLines(a.env, 'c')).toEqual([]);
    // (b) seeded, but the previous stop has no recorded result (prevWon undefined)
    const b = storyRoom('barbershop', { barbershop: { attempts: 3 } });
    toGame(b.env);
    playToHistory(b.env, 3);
    expect(b.env.room.data.story!.buzzState!.fired).toBe(0);
    expect(buzzLines(b.env, 'a')).toEqual([]);
  });

  it('share-code rooms get their buzz at bind — the same sit-down fire, both clients', () => {
    const { attempts, beats } = firingAttempts('barbershop', 'sitDown', 0, { prevWon: true, prevBand: 'rout', ...PORCH_FACTS });
    const env = new FakeEnv(undefined, FAST);
    env.room.setupStory('barbershop', 'ua', null); // no pair yet: no facts exist to seed
    env.join('a', 'Host', undefined, 'ua');
    expect(env.room.bindStoryPartner('uc', undefined, { barbershop: { attempts, prevWon: true, prevBand: 'rout', ...PORCH_FACTS } })).toBe(true);
    env.join('c', 'Partner', undefined, 'uc');
    toGame(env);
    expect(env.room.data.story!.buzzState!.fired).toBe(1);
    for (const cid of ['a', 'c']) {
      expect(buzzLines(env, cid).map((l) => l.text)).toEqual(beats.map((b) => b.line));
    }
  });

  it('a witnessed game refreshes the map: attempts grow here, the NEXT stop inherits this game’s facts', () => {
    const { env } = storyRoom('barbershop', { barbershop: { attempts: 2, prevWon: true, prevBand: 'rout', ...PORCH_FACTS } });
    toGame(env);
    env.send('a', { t: 'concede' });
    const buzz = env.room.data.story!.buzz!;
    expect(buzz['barbershop']!.attempts).toBe(3);
    expect(buzz['rec-center']).toMatchObject({
      prevWon: false, // a concede is a pair loss — the grind is what the Rec will hear
      prevStopName: 'The Barbershop',
      prevPairNames: 'Mr. Coleman and June',
    });
    expect(buzz['rec-center']!.prevBand).toBeNull(); // a loss carries no manner band
  });

  it('a played-out game refreshes the next stop with the witness’s own manner facts', () => {
    const { env } = storyRoom('barbershop', { barbershop: { attempts: 0, prevWon: true, prevBand: 'rout', ...PORCH_FACTS } });
    toGame(env);
    playOut(env);
    expect(env.room.data.phase).toBe('over');
    const game = env.room.data.game!;
    const won = game.result!.winners.includes(0);
    const facts = storyFactsOf(game);
    const buzz = env.room.data.story!.buzz!;
    expect(buzz['barbershop']!.attempts).toBe(1);
    expect(buzz['rec-center']!.prevWon).toBe(won);
    expect(buzz['rec-center']!.prevBand).toBe(mannerBandOf({ won, margin: facts.margin, endReason: facts.endReason }, targetForStop(SHOP)));
    expect(buzz['rec-center']!.prevStopName).toBe('The Barbershop');
    // and the witness row the room wrote carries those same facts — the two can never disagree
    expect(env.storyResults).toHaveLength(1);
    expect(env.storyResults[0]!.facts.margin).toBe(facts.margin);
    expect(env.storyResults[0]!.won).toBe(won);
  });
});

describe('buzzInputsFor — the pair track’s rows, and only the pair track’s rows', () => {
  it('derives every stop’s input from the pair track (solo history never leaks in)', async () => {
    const db = await makeD1();
    for (const id of ['ua', 'uc']) {
      await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, id.toUpperCase(), id).run();
    }
    const pairTrack = storyPairTrackKey('ua', 'uc');
    const seed = async (userId: string, track: string, stopId: string, attempts: number, clears: number, lastResult: string | null) => {
      await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, last_result) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(userId, track, stopId, attempts, clears, lastResult).run();
    };
    // the pair ran the Porch off the table (400 over a 250 target = a rout) and has visited the Shop 3 times
    await seed('ua', pairTrack, 'porch', 2, 1, JSON.stringify({ won: true, margin: 400, endReason: 'target' }));
    await seed('ua', pairTrack, 'barbershop', 3, 0, null);
    // the host's SOLO porch went the other way — a different track, a different story; it must not surface
    await seed('ua', 'solo', 'porch', 5, 1, JSON.stringify({ won: false, margin: -50, endReason: 'target' }));

    const inputs = await buzzInputsFor(db, 'ua', pairTrack);
    expect(inputs['barbershop']).toEqual({
      attempts: 3, prevWon: true, prevBand: 'rout', prevStopName: 'The Porch', prevPairNames: 'Uncle Ray and Pat',
    });
    expect(inputs['porch']!.attempts).toBe(2);
    expect(inputs['porch']!.prevWon).toBeUndefined(); // stop 1 has no predecessor — nothing to gossip about
    expect(inputs['rec-center']!.attempts).toBe(0);
    expect(inputs['rec-center']!.prevWon).toBeUndefined(); // the Shop's row carries no recorded result → silence, not invention
    expect(inputs['king']!.prevPairNames).toBe('Queenie and Ace');
  });

  it('a win recorded without facts carries no band (the word family, never a manner claim)', async () => {
    const db = await makeD1();
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind('ua', 'UA', 'ua').run();
    const pairTrack = storyPairTrackKey('ua', 'uc');
    await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, last_result) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('ua', pairTrack, 'porch', 1, 1, JSON.stringify({ won: true })).run();
    const inputs = await buzzInputsFor(db, 'ua', pairTrack);
    expect(inputs['barbershop']!.prevWon).toBe(true);
    expect(inputs['barbershop']!.prevBand).toBeNull();
  });
});
