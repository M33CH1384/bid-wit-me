import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, rulesSummary, settingsToRules } from '../src/settings';
import { glossary } from '../src/glossary';

describe('Cutthroat setup', () => {
  it('summary line for 4 players with the defaults', () => {
    const r = settingsToRules({ ...DEFAULT_SETTINGS, mode: 'cutthroat4', cutthroatDeck: 'standard52' });
    expect(r.targetScore).toBe(300);
    expect(rulesSummary(r)).toBe('4 players • 13 cards each • 13 books • Minimum 1 • Nil off • Blind Nil off • Bags on');
  });
  it('3 players: the removed card is named; options flow into the rules', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'cutthroat3' as const, cutthroatDeck: 'standard52' as const, cutMinBid: 3 as const, nilAllowed: false, cutBlindNil: true, bagsOn: false, targetScore: 500 };
    const r = settingsToRules(s);
    expect(r).toMatchObject({ playerCount: 3, minTeamBid: 3, targetScore: 500, bagsOn: false, removedCards: ['2C'] });
    expect(r.nil.allowed).toBe(false);
    expect(r.blindNil.allowed).toBe(false);
    expect(rulesSummary(r)).toBe('3 players • 17 cards each • 17 books • 2♣ removed • Minimum 3 • Nil off • Blind Nil off • Bags off');
    expect(glossary(r).bid.def).toContain('2♣ is removed');
    expect(glossary(r).bags.def).toContain('off at this table');
    const jr = settingsToRules({ ...s, cutthroatDeck: 'joker54' });
    expect(rulesSummary(jr)).toContain('2♣ 2♥ 3♣ removed');
  });
  it('team modes keep their own min / Blind Nil settings', () => {
    const r = settingsToRules({ ...DEFAULT_SETTINGS, mode: 'joker', cutMinBid: 4, cutBlindNil: false });
    expect(r.minTeamBid).toBe(0);
    expect(r.blindNil.allowed).toBe(true);
  });
});
