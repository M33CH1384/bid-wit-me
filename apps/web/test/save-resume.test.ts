import { describe, expect, it } from 'vitest';
import { makeRules, newGame } from '@spades/rules';
import { confirmReplaceSave, landOnHome, type SavedGame } from '../src/save';
import { DEFAULT_SETTINGS } from '../src/settings';

const saved: SavedGame = { v: 1, savedAt: 0, seed: 's', settings: DEFAULT_SETTINGS, state: newGame(makeRules('joker'), 's'), chat: [] };

describe('reload with a saved bot game', () => {
  it('opens Home, not the bot setup step left in history.state', () => {
    expect(landOnHome({ wiz: 'setup', d: 2 }, true)).toBe(true);
    expect(landOnHome({ wiz: 'mode' }, true)).toBe(true);
    expect(landOnHome({ wiz: 'home' }, true)).toBe(false);
    expect(landOnHome({ wiz: 'setup' }, false)).toBe(false);
  });
  it('Deal me in asks before replacing a game in progress', () => {
    expect(confirmReplaceSave(null, () => false)).toBe(true);
    expect(confirmReplaceSave(saved, () => false)).toBe(false);
    expect(confirmReplaceSave(saved, () => true)).toBe(true);
  });
});
