/**
 * Story co-op Phase 3 — Dee's guide layer in the room (spec §5.3):
 * hand-end evaluation wired into the authoritative game, her lines in
 * chat under the "Dee · guide" byline with NO bot/persona payload (the
 * voice fence: text-only until her cast recordings exist), the
 * once-per-match awareness callback when the room carries case (b)
 * facts, and her guide voice going quiet while she covers a seat.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '@spades/rules';
import { GUIDE_AWARE, allGuideLines, chooseBotAction, type AwarenessCase } from '@spades/bots';
import type { ChatLine, GameAction } from '@spades/protocol';
import { FakeEnv } from './harness';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };
const GUIDE_TEXTS = new Set(allGuideLines().map((g) => g.line));
const AWARE_TEXTS = new Set<string>(GUIDE_AWARE);

function storyRoom(aware?: Record<string, AwarenessCase>) {
  const env = new FakeEnv(undefined, FAST);
  env.room.setupStory('porch', 'ua', 'uc', aware);
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
const guideLines = (env: FakeEnv, cid = 'a'): ChatLine[] =>
  env.msgs(cid).filter((m) => m.t === 'chat').map((m) => (m as { line: ChatLine }).line).filter((l) => l.from === 'guide:dee');

describe('Dee the guide in the room (§5.3)', () => {
  it('speaks at hand ends, under her guide byline, text-only, never twice the same line', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // every density roll passes: she reads every hand the spacing allows
    try {
      const { env } = storyRoom();
      toGame(env);
      playOut(env);
      expect(env.room.data.phase).toBe('over');
      const lines = guideLines(env);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l.name).toBe('Dee · guide');
        expect(l.bot).toBeUndefined(); // THE FENCE: no persona payload → no client ever voices her from a substitute
        expect(l.system).toBeUndefined();
        expect(GUIDE_TEXTS.has(l.text)).toBe(true);
      }
      expect(new Set(lines.map((l) => l.text)).size).toBe(lines.length); // never repeats within a match
      // both partners receive the same guide lines (one room, one Dee)
      expect(guideLines(env, 'c').map((l) => l.text)).toEqual(lines.map((l) => l.text));
      // the evaluator saw every hand the match played
      const hands = env.room.data.game!.history.length;
      expect(env.room.data.story!.guide!.handsSeen).toBe(hands);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a fresh match gets a fresh guide memory', () => {
    const { env } = storyRoom();
    toGame(env);
    playOut(env);
    const first = env.room.data.story!.guide!;
    expect(first.handsSeen).toBeGreaterThan(0);
    readyBoth(env); // outro → tape
    readyBoth(env); // tape → scene
    readyBoth(env); // scene → game (rematch)
    const second = env.room.data.story!.guide!;
    expect(second).not.toBe(first);
    expect(second.handsSeen).toBe(0);
    expect(second.said).toEqual([]);
  });

  it('the awareness callback fires when the room carries case (b) facts for the stop', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { env } = storyRoom({ porch: 'b' });
      toGame(env);
      playOut(env);
      const lines = guideLines(env);
      expect(lines.some((l) => AWARE_TEXTS.has(l.text))).toBe(true);
      expect(env.room.data.story!.guide!.awareSpent).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('no awareness facts in the room → no awareness callback, ever', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { env } = storyRoom({ porch: 'a' });
      toGame(env);
      playOut(env);
      expect(guideLines(env).some((l) => AWARE_TEXTS.has(l.text))).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('goes quiet while Dee covers a dropped partner’s seat', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { env } = storyRoom();
      toGame(env);
      // play until at least one hand has closed (her state proves wiring)
      for (let i = 0; i < 8000 && (env.room.data.game?.history.length ?? 0) < 1; i++) {
        if (!playTurn(env, ['a', 'c'])) env.advance(100);
      }
      expect(env.room.data.story!.guide!.handsSeen).toBeGreaterThanOrEqual(1);
      env.room.close('c');
      env.advance(6000); // past grace: Dee sits down
      expect(env.room.data.seats[2]).toMatchObject({ kind: 'bot', name: 'Dee' });
      const atCover = guideLines(env).length;
      const seenAtCover = env.room.data.story!.guide!.handsSeen;
      // the match plays on under her cover — hands close, she says nothing
      for (let i = 0; i < 12000 && env.room.data.phase === 'playing' && (env.room.data.game?.history.length ?? 0) < 3; i++) {
        if (!playTurn(env, ['a'])) env.advance(100);
      }
      expect(env.room.data.game!.history.length).toBeGreaterThanOrEqual(3);
      expect(guideLines(env).length).toBe(atCover);
      expect(env.room.data.story!.guide!.handsSeen).toBe(seenAtCover);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
