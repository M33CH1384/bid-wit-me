/**
 * @vitest-environment happy-dom
 *
 * Talk LIVENESS tripwire (owner report 2026-10-23: "no one is talking
 * anymore on any screen"). The package suites prove line SELECTION
 * (bots) and the density suite proves offlineTalk's gates with mocked
 * prefs — but nothing proved the assembled production path end to end:
 * real talkPrefs + real engine + offlineTalk.step/prePlay driven by a
 * full game, the way useGame/Table drive them. A total-silence
 * regression (a gate inverted, a sink unwired, an exception swallowed
 * by useGame's try/catch) would pass every other suite. This file is
 * the loud failure for that class: over full simulated games at a
 * regular table AND a story-cast table, the production path must keep
 * delivering lines — in both halves of the game, across several kinds.
 *
 * Deterministic: Math.random is a seeded PRNG and performance.now a
 * virtual clock advancing 1.1 s per action (real pacing, so the
 * engine's time-based cooldowns behave as they do at a live table).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_NAMES, personaForName, simulateGame, type TalkLine } from '@spades/bots';
import { applyAction, makeRules, type GameState, type TableRules } from '@spades/rules';
import { offlineTalk } from '../src/offlineTalk';

/** mulberry32 — small seeded PRNG so the counts below are stable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let clock = 1_000_000;
let delivered: TalkLine[] = [];
let deliveredAtAction: number[] = [];

function runGame(rules: TableRules, seed: string, names: string[]): { total: number; firstHalf: number; secondHalf: number; kinds: Set<string> } {
  delivered = [];
  deliveredAtAction = [];
  let actionIx = 0;
  offlineTalk.newGame();
  // Mirror Table.tsx's wiring: the talk table (offline regular + story
  // tables both run the 'lively' party profile at the web layer) and
  // the sink Table assigns for the mount.
  offlineTalk.table = {
    seats: names.map((nm, i) => ({ name: nm, bot: i !== 0 })),
    partnerships: rules.partnerships,
    teamNames: ['Us', 'Them'],
    profile: 'lively',
  };
  offlineTalk.sink = (l) => { delivered.push(l); deliveredAtAction.push(actionIx); };
  let totalActions = 0;
  simulateGame(rules, seed, {
    onAction: (before, action) => {
      clock += 1100;
      totalActions++;
      const after: GameState = applyAction(before, action);
      // useGame's real call pattern: prePlay before a bot's play, then
      // step for every action (its try/catch there means a throw here
      // would silence the table in production — here it fails loudly).
      if (action.type === 'play' && action.seat !== 0) offlineTalk.prePlay(action.seat);
      offlineTalk.step(before, action, after);
      actionIx++;
    },
  });
  offlineTalk.sink = null;
  offlineTalk.table = null;
  const mid = Math.floor(totalActions / 2);
  return {
    total: delivered.length,
    firstHalf: deliveredAtAction.filter((i) => i < mid).length,
    secondHalf: deliveredAtAction.filter((i) => i >= mid).length,
    kinds: new Set(delivered.map((l) => l.line?.split('.')[1] ?? '(text)')),
  };
}

const nameFor = (p: string) => BOT_NAMES.find((n) => personaForName(n) === p)!;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(0x7a1c));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('talk liveness: the production path delivers, all game long', () => {
  it('regular offline table (persona bots, joker partnership)', () => {
    const names = ['You', nameFor('hype'), nameFor('mama'), nameFor('og')];
    const r = runGame(makeRules('joker'), 'liveness-regular-1', names);
    // Observed ~130/game unseeded; the floor sits far below any healthy
    // run and far above the total-silence failure this file exists for.
    expect(r.total).toBeGreaterThan(40);
    expect(r.firstHalf).toBeGreaterThan(10);
    expect(r.secondHalf).toBeGreaterThan(10); // talk must not die mid-game
    expect(r.kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('story-cast table (Dee partnering, Porch opponents)', () => {
    const names = ['You', 'Uncle Ray', 'Dee', 'Pat'];
    const r = runGame(makeRules('joker'), 'liveness-story-1', names);
    expect(r.total).toBeGreaterThan(40);
    expect(r.firstHalf).toBeGreaterThan(10);
    expect(r.secondHalf).toBeGreaterThan(10);
    expect(r.kinds.size).toBeGreaterThanOrEqual(4);
  });
});
