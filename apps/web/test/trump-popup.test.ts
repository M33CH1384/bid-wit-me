import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRules, CLASSIC_JOKER } from '@spades/rules';
import { ackTrumpPopup, trumpPopupSeen, trumpSeenKey } from '../src/TrumpPopup';

// Minimal localStorage stub (unit tests run in node, no DOM).
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
} as Storage);

beforeEach(() => store.clear());

describe('trump popup seen-keys', () => {
  it('returns null for non-Joker decks', () => {
    expect(trumpSeenKey(makeRules('aceDown'))).toBeNull();
    expect(trumpSeenKey(makeRules('cutthroat', { deck: 'standard52' }))).toBeNull();
  });

  it('applies to cutthroat with the joker deck too', () => {
    expect(trumpSeenKey(makeRules('cutthroat'))).toBe('bwm-seen-trumps-joker');
  });

  it('uses distinct keys for standard vs classic Joker', () => {
    const standard = trumpSeenKey(makeRules('joker'));
    const classic = trumpSeenKey(makeRules('joker', { ...CLASSIC_JOKER }));
    expect(standard).toBe('bwm-seen-trumps-joker');
    expect(classic).toBe('bwm-seen-trumps-classic');
    expect(standard).not.toBe(classic);
  });

  it('round-trips seen state through localStorage', () => {
    const key = 'bwm-seen-trumps-joker';
    expect(trumpPopupSeen(key)).toBe(false);
    ackTrumpPopup(key);
    expect(trumpPopupSeen(key)).toBe(true);
  });

  it('treats a null key as already seen (no popup)', () => {
    expect(trumpPopupSeen(null)).toBe(true);
    expect(() => ackTrumpPopup(null)).not.toThrow();
  });
});
