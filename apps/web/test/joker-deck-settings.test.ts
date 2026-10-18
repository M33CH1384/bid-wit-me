import { describe, expect, it } from 'vitest';
import { buildDeck } from '@spades/rules';
import { DEFAULT_SETTINGS, settingsToRules } from '../src/settings';

/** The live app's settings -> rules paths must all deal the exact house joker deck. */
describe('settings paths deal the exact joker deck (2♥/2♣ out, 2♠/2♦ in)', () => {
  const cases = {
    'offline team Joker (default settings)': settingsToRules(DEFAULT_SETTINGS),
    'Cutthroat 4, joker deck': settingsToRules({ ...DEFAULT_SETTINGS, mode: 'cutthroat4' }),
    'Cutthroat 3, joker deck': settingsToRules({ ...DEFAULT_SETTINGS, mode: 'cutthroat3' }),
  };
  for (const [name, r] of Object.entries(cases)) {
    it(name, () => {
      const deck = buildDeck(r);
      expect(deck).toContain('BJ'); expect(deck).toContain('LJ');
      expect(deck).toContain('2S'); expect(deck).toContain('2D');
      expect(deck).not.toContain('2H'); expect(deck).not.toContain('2C');
      expect(deck.filter((c) => c[0] === '2')).toEqual(['2S', '2D']);
    });
  }
  it('the Classic trump-order setting is the one exception (2♣ in, 2♦ out) — check this setting if 2♣ appears', () => {
    const deck = buildDeck(settingsToRules({ ...DEFAULT_SETTINGS, jokerOrder: 'classic' }));
    expect(deck).toContain('2C');
    expect(deck).not.toContain('2D');
    expect(deck).not.toContain('2H');
  });
});
