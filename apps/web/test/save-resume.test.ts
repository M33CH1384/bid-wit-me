import { describe, expect, it } from 'vitest';
import { makeRules, newGame } from '@spades/rules';
import { confirmReplaceSave, resumeOnLoad, type SavedGame } from '../src/save';
import { DEFAULT_SETTINGS } from '../src/settings';

const saved: SavedGame = { v: 1, savedAt: 0, seed: 's', settings: DEFAULT_SETTINGS, state: newGame(makeRules('joker'), 's'), chat: [] };

describe('reload with a saved bot game', () => {
  it('a refresh at the table resumes it; a fresh open (no in-game marker) does not', () => {
    expect(resumeOnLoad({ wiz: 'home' }, saved, false, true)).toBe(saved);
    expect(resumeOnLoad(null, saved, false, false)).toBeNull();
    expect(resumeOnLoad(null, null, false, true)).toBeNull();
    expect(resumeOnLoad(null, saved, true, true)).toBeNull();
  });
  it('Deal me in asks before replacing a game in progress', () => {
    expect(confirmReplaceSave(null, () => false)).toBe(true);
    expect(confirmReplaceSave(saved, () => false)).toBe(false);
    expect(confirmReplaceSave(saved, () => true)).toBe(true);
  });
});
