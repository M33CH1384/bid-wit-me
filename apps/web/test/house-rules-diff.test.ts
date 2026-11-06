/**
 * W3 Finding E (responsive audit 2026-11-05): the setup "HOUSE RULES" chip
 * was a hardcoded "Standard" literal at both render sites (bots setup +
 * online create), even after the user customised rules in the sheet or
 * in-form. The fix is a pure derivation: houseRulesDiff(s) compares the
 * EFFECTIVE rules (settingsToRules) of the current settings against the
 * same mode's baseline built through settingsToRules itself, facet by
 * facet, with inert facets masked:
 *  - cutthroat forces Nil/Blind Nil off, firstHandMin null, minTeamBid
 *    from cutMinBid — stored values for those facets cannot count;
 *  - deuceOfSpadesHigh only applies under the classic joker order;
 *  - firstLead 'twoOfClubs' falls back where 2C is removed;
 *  - bag penalty is inert while Bags are off (scoring: bagsAdded is
 *    forced to 0 and carried bags start at 0, so no penalty can accrue);
 *  - blind-nil exchange / failed-nil tricks are masked when their parent
 *    rules are off;
 *  - target score compares the RESOLVED number: picking the preset
 *    (stored as 'default', or as the same number) is Standard.
 * Empty diff = "Standard"; any facet = "Custom".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, houseRulesDiff, loadSettings, type Settings } from '../src/settings';

const s = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe('houseRulesDiff: defaults are Standard in every mode', () => {
  it('joker defaults', () => { expect(houseRulesDiff(s({}))).toEqual([]); });
  it('aceDown defaults', () => { expect(houseRulesDiff(s({ mode: 'aceDown' }))).toEqual([]); });
  it('cutthroat4 defaults', () => { expect(houseRulesDiff(s({ mode: 'cutthroat4' }))).toEqual([]); });
  it('cutthroat3 defaults', () => { expect(houseRulesDiff(s({ mode: 'cutthroat3' }))).toEqual([]); });
  it('non-rule fields never count (venue, bot skill, deck art, speed, quality, view, talk)', () => {
    expect(houseRulesDiff(s({ venue: 'vegas', botLevel: 'shark', deck: 'neon', speed: 'fast', quality: 'low', view: 'standing', talkIntensity: 'nomercy' }))).toEqual([]);
  });
  it('cutthroat deck choice itself is not a house-rule facet', () => {
    expect(houseRulesDiff(s({ mode: 'cutthroat4', cutthroatDeck: 'standard52' }))).toEqual([]);
  });
});

describe('houseRulesDiff: each facet flips the label on its own (team modes)', () => {
  it('target score: a non-preset number is Custom; the preset number stored raw is Standard', () => {
    expect(houseRulesDiff(s({ targetScore: 250 }))).toEqual(['Play to 250']);
    expect(houseRulesDiff(s({ targetScore: 500 }))).toEqual([]); // == joker preset, resolved equal
    expect(houseRulesDiff(s({ mode: 'cutthroat4', targetScore: 500 }))).toEqual(['Play to 500']);
    expect(houseRulesDiff(s({ mode: 'cutthroat4', targetScore: 300 }))).toEqual([]);
  });
  it('first hand bids itself off', () => {
    expect(houseRulesDiff(s({ firstHandBidsItself: false }))).toEqual(['First hand bids itself off']);
  });
  it('shot = out off', () => {
    expect(houseRulesDiff(s({ shotOut: false }))).toEqual(['Shot = out off']);
  });
  it('minimum books/bid (firstHandMin): 3 / 5 / off count; explicit 4 is the default', () => {
    expect(houseRulesDiff(s({ firstHandMin: 3 }))).toEqual(['Minimum books/bid 3']);
    expect(houseRulesDiff(s({ firstHandMin: 5 }))).toEqual(['Minimum books/bid 5']);
    expect(houseRulesDiff(s({ firstHandMin: 'off' }))).toEqual(['Minimum books/bid off']);
    expect(houseRulesDiff(s({ firstHandMin: 4 }))).toEqual([]);
  });
  it('losing floor off', () => {
    expect(houseRulesDiff(s({ losingFloor: 'off' }))).toEqual(['Losing floor off']);
  });
  it('joker trump order classic', () => {
    expect(houseRulesDiff(s({ jokerOrder: 'classic' }))).toEqual(['Joker trump order classic']);
  });
  it('2♠ under jokers counts only under classic; stored under house it is inert', () => {
    expect(houseRulesDiff(s({ jokerOrder: 'classic', deuceOfSpadesHigh: true })))
      .toEqual(['Joker trump order classic', '2♠ under jokers']);
    expect(houseRulesDiff(s({ deuceOfSpadesHigh: true }))).toEqual([]);
  });
  it('spades must be broken off', () => {
    expect(houseRulesDiff(s({ spadesMustBeBroken: false }))).toEqual(['Spades must be broken off']);
  });
  it('2♣ leads: effective on Ace Down, inert on the joker deck (2♣ removed)', () => {
    expect(houseRulesDiff(s({ mode: 'aceDown', firstLead: 'twoOfClubs' }))).toEqual(['2♣ leads first trick']);
    expect(houseRulesDiff(s({ firstLead: 'twoOfClubs' }))).toEqual([]);
  });
  it('minimum team bid', () => {
    expect(houseRulesDiff(s({ minTeamBid: 4 }))).toEqual(['Minimum team bid 4']);
  });
  it('nil allowed off', () => {
    expect(houseRulesDiff(s({ nilAllowed: false }))).toEqual(['Nil off']);
  });
  it('blind nil mode', () => {
    expect(houseRulesDiff(s({ blindNil: 'always' }))).toEqual(['Blind Nil always']);
    expect(houseRulesDiff(s({ blindNil: 'off' }))).toEqual(['Blind Nil off']);
  });
  it('blind nil exchange counts while Blind Nil is on, masked while it is off', () => {
    expect(houseRulesDiff(s({ blindNilExchange: 2 }))).toEqual(['Blind Nil exchange']);
    expect(houseRulesDiff(s({ blindNil: 'off', blindNilExchange: 2 }))).toEqual(['Blind Nil off']);
  });
  it('failed-nil tricks help partner: counts while a Nil route is open, masked when both are off', () => {
    expect(houseRulesDiff(s({ nilTricksCountForPartner: true }))).toEqual(['Failed-nil tricks help partner']);
    expect(houseRulesDiff(s({ nilAllowed: false, blindNil: 'off', nilTricksCountForPartner: true })))
      .toEqual(['Nil off', 'Blind Nil off']);
  });
  it('bags off; bag penalty counts only while Bags are on', () => {
    expect(houseRulesDiff(s({ bagsOn: false }))).toEqual(['Bags off']);
    expect(houseRulesDiff(s({ bags: '5/50' }))).toEqual(['Bags 5/50']);
    expect(houseRulesDiff(s({ bags: '10/50' }))).toEqual(['Bags 10/50']);
    expect(houseRulesDiff(s({ bagsOn: false, bags: '5/50' }))).toEqual(['Bags off']);
  });
  it('10 for 200 on', () => {
    expect(houseRulesDiff(s({ tenForTwoHundred: true }))).toEqual(['10 for 200 on']);
  });
  it('multiple facets accumulate in sheet order', () => {
    expect(houseRulesDiff(s({ shotOut: false, bags: '5/50', blindNil: 'always' })))
      .toEqual(['Shot = out off', 'Blind Nil always', 'Bags 5/50']);
  });
  it('flipping a rule back restores Standard (no sticky custom state)', () => {
    expect(houseRulesDiff(s({ shotOut: false }))).not.toEqual([]);
    expect(houseRulesDiff(s({ shotOut: true }))).toEqual([]);
  });
});

describe('houseRulesDiff: inert masking in cutthroat / aceDown', () => {
  it('cutthroat: stored Nil / Blind Nil / firstHandMin values are forced, never facets', () => {
    expect(houseRulesDiff(s({ mode: 'cutthroat4', nilAllowed: false }))).toEqual([]);
    expect(houseRulesDiff(s({ mode: 'cutthroat4', blindNil: 'always' }))).toEqual([]);
    expect(houseRulesDiff(s({ mode: 'cutthroat4', firstHandMin: 5 }))).toEqual([]);
    expect(houseRulesDiff(s({ mode: 'cutthroat4', cutBlindNil: true }))).toEqual([]);
  });
  it('cutthroat: its own minimum books/bid (cutMinBid) is the facet', () => {
    expect(houseRulesDiff(s({ mode: 'cutthroat4', cutMinBid: 3 }))).toEqual(['Minimum books/bid 3']);
    expect(houseRulesDiff(s({ mode: 'cutthroat3', cutMinBid: 2 }))).toEqual(['Minimum books/bid 2']);
  });
  it('cutthroat: joker order counts on the joker deck, inert on standard 52', () => {
    expect(houseRulesDiff(s({ mode: 'cutthroat4', jokerOrder: 'classic' }))).toEqual(['Joker trump order classic']);
    expect(houseRulesDiff(s({ mode: 'cutthroat4', cutthroatDeck: 'standard52', jokerOrder: 'classic' }))).toEqual([]);
  });
  it('cutthroat: 2♣ lead counts on standard 52, inert on the joker deck', () => {
    expect(houseRulesDiff(s({ mode: 'cutthroat4', cutthroatDeck: 'standard52', firstLead: 'twoOfClubs' }))).toEqual(['2♣ leads first trick']);
    expect(houseRulesDiff(s({ mode: 'cutthroat4', firstLead: 'twoOfClubs' }))).toEqual([]);
  });
  it('aceDown: joker-order settings are inert (standard deck)', () => {
    expect(houseRulesDiff(s({ mode: 'aceDown', jokerOrder: 'classic', deuceOfSpadesHigh: true }))).toEqual([]);
  });
});

describe('houseRulesDiff: saved-settings restore (loadSettings path)', () => {
  // Node env has no localStorage; a minimal stub exercises the real
  // loadSettings -> normalizeSettings path the app restores through.
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    };
  });
  it('a saved custom rule reads Custom on first render after restore', () => {
    localStorage.setItem('spades.settings.v2', JSON.stringify({ ...DEFAULT_SETTINGS, shotOut: false }));
    expect(houseRulesDiff(loadSettings())).toEqual(['Shot = out off']);
  });
  it('a save differing only in non-rule fields restores as Standard', () => {
    localStorage.setItem('spades.settings.v2', JSON.stringify({ ...DEFAULT_SETTINGS, venue: 'vegas', botLevel: 'pro' }));
    expect(houseRulesDiff(loadSettings())).toEqual([]);
  });
  it('a cutthroat save carrying inert stored values restores as Standard', () => {
    localStorage.setItem('spades.settings.v2', JSON.stringify({ ...DEFAULT_SETTINGS, mode: 'cutthroat4', nilAllowed: false, firstHandMin: 5 }));
    expect(houseRulesDiff(loadSettings())).toEqual([]);
  });
});

describe('houseRulesDiff: both Setup render sites share the one row (no literal left)', () => {
  it('Setup.tsx has no hardcoded Standard chip and renders the shared row twice', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/Setup.tsx', import.meta.url), 'utf8');
    expect(src).not.toContain('<span className="value-chip">Standard</span>');
    expect(src.match(/<HouseRulesRow /g)?.length).toBe(2);
    expect(src).toContain('houseRulesDiff');
  });
});
