import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { SAVE_VERSION, parseSave, resumeOnLoad } from '../src/save';
import { DEFAULT_SETTINGS, type Settings, settingsToRules } from '../src/settings';

function step(st: GameState): GameState {
  const t = pendingTurn(st);
  if (!t) return applyAction(st, { type: 'nextHand' });
  return applyAction(st, chooseBotAction(viewFor(st, t.seat))!);
}
function advance(st: GameState, n: number) { for (let i = 0; i < n && st.phase !== 'gameOver'; i++) st = step(st); return st; }
const norm = <T,>(x: T): T => JSON.parse(JSON.stringify(x)); // JSON drops -0 → 0
const blob = (settings: Settings, state: GameState, extra: object = {}) =>
  JSON.stringify({ v: SAVE_VERSION, savedAt: 1, seed: state.seed, settings, state, chat: [{ id: 3, user: 'Dre', color: '#0f0', text: 'gg' }], ...extra });

const SETUPS: [string, Partial<Settings>][] = [
  ['joker', { mode: 'joker' }],
  ['cutthroat4 joker deck', { mode: 'cutthroat4', cutthroatDeck: 'joker54' }],
  ['cutthroat4 standard52', { mode: 'cutthroat4', cutthroatDeck: 'standard52' }],
  ['cutthroat3', { mode: 'cutthroat3' }],
  ['aceDown', { mode: 'aceDown' }],
];

describe('save / restore', () => {
  it('keeps the random bot names (only when they match the seat count)', () => {
    const settings = { ...DEFAULT_SETTINGS, mode: 'joker' as const };
    const st = advance(newGame(settingsToRules(settings), 'names'), 10);
    expect(parseSave(blob(settings, st, { names: ['You', 'Zuri', 'Kenji', 'Peaches'] }))!.names).toEqual(['You', 'Zuri', 'Kenji', 'Peaches']);
    expect(parseSave(blob(settings, st, { names: ['You', 'Zuri'] }))!.names).toBeUndefined();
    expect(parseSave(blob(settings, st))!.names).toBeUndefined(); // older saves: names are re-derived from the seed
  });
  for (const [label, patch] of SETUPS) {
    it(`${label}: round-trips mid-hand state exactly and play continues identically`, () => {
      const settings = { ...DEFAULT_SETTINGS, ...patch };
      for (const steps of [0, 3, 9, 23, 61, 140]) {
        const st = advance(newGame(settingsToRules(settings), `save-${label}`), steps);
        if (st.phase === 'gameOver') continue;
        const g = parseSave(blob(settings, st))!;
        expect(g).not.toBeNull();
        expect(g.state).toEqual(norm(st));
        expect(g.settings).toEqual(settings);
        expect(g.chat[0]!.text).toBe('gg');
        // bots are stateless → the restored game plays out exactly like the original
        expect(norm(advance(g.state, 40))).toEqual(norm(advance(st, 40)));
      }
    });
  }
  it('discards corrupted, old-version and finished saves', () => {
    const settings = DEFAULT_SETTINGS;
    const st = advance(newGame(settingsToRules(settings), 'x'), 10);
    expect(parseSave(null)).toBeNull();
    expect(parseSave('{not json')).toBeNull();
    expect(parseSave(blob(settings, st, { v: 0 }))).toBeNull();
    expect(parseSave(blob(settings, st, { v: 99 }))).toBeNull();
    expect(parseSave(blob(settings, { ...st, hands: [[]] } as GameState))).toBeNull();
    expect(parseSave(blob(settings, { ...st, phase: 'gameOver' } as GameState))).toBeNull();
    expect(parseSave(JSON.stringify({ v: SAVE_VERSION, seed: 'x', settings, state: { rules: { playerCount: 4 } } }))).toBeNull();
  });
});

describe('returning home does not reopen a saved bot game', () => {
  const saved = { v: SAVE_VERSION, savedAt: 1, seed: 's', settings: DEFAULT_SETTINGS, state: {} as GameState, chat: [] };

  it('drops back in on a refresh, and stays on the menu after Leave', () => {
    expect(resumeOnLoad(null, saved, false)).toBe(saved);
    expect(resumeOnLoad({ wiz: 'setup' }, saved, false)).toBe(saved);
    expect(resumeOnLoad({ wiz: 'home', d: 0 }, saved, false)).toBeNull();
    expect(resumeOnLoad({ wiz: 'home' }, saved, true)).toBeNull();
    expect(resumeOnLoad(null, null, false)).toBeNull();
  });
});
