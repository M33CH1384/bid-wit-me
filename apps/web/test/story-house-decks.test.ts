/**
 * @vitest-environment happy-dom
 *
 * Story house decks (owner, 2026-10-21): a story table deals the stop's OWN
 * matched deck — the house's cards on their turf — not the player's selected
 * deck, and not only once they've unlocked it. Clearing the stop is what
 * lets the player take the deck home in the picker (story-decks.test.ts);
 * playing AT the stop never required owning it. The override rides the
 * scoped story settings snapshot, so the player's saved Settings.deck is
 * never mutated and normal games keep dealing the player's own deck.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { STORY_STOPS, storyStopById } from '@spades/bots';
import { makeRules, newGame } from '@spades/rules';
import { deckForStop } from '../src/decks';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { storySettingsFor } from '../src/story/storySettings';
import { loadStoryGame, saveStoryGame, type StorySavedGame } from '../src/story/storySave';

/** The decided stop → house deck map, pinned literally so drift fails loud. */
const HOUSE_DECK: Record<string, string> = {
  porch: 'porchlight',
  barbershop: 'revolutionaries',
  'rec-center': 'blacktop',
  cookout: 'cookout',
  corner: 'corner',
  'church-basement': 'stainedglass',
  rooftop: 'rooftopdusk',
  'high-rise': 'penthouse',
  'the-pjs': 'pjs',
  legends: 'legends',
  king: 'madeitout',
};

const playerWith = (deck: string): Settings => ({ ...DEFAULT_SETTINGS, deck });

afterEach(() => { localStorage.clear(); });

describe('story house decks', () => {
  it('every stop deals its own matched deck, whatever the player selected', () => {
    expect(STORY_STOPS).toHaveLength(11);
    for (const stop of STORY_STOPS) {
      const want = HOUSE_DECK[stop.id];
      expect(want, `no house deck pinned for stop ${stop.id}`).toBeTruthy();
      // the literal pin and the shipped stop→deck map agree
      expect(deckForStop(stop.id)?.id, stop.id).toBe(want);
      expect(storySettingsFor(stop, playerWith('harlem')).deck, stop.id).toBe(want);
    }
  });

  it("the house deck beats even another stop's deck in the player's selection", () => {
    // Player has Made It Out selected (King cleared) but sits down at the Porch:
    // Ray's table, Ray's cards.
    expect(storySettingsFor(storyStopById('porch')!, playerWith('madeitout')).deck).toBe('porchlight');
    expect(storySettingsFor(storyStopById('king')!, playerWith('porchlight')).deck).toBe('madeitout');
  });

  it('applies at stops the player has not unlocked the deck for yet', () => {
    // A first-run player (selected Classic, no clears) at the Pj's still plays
    // Pj's Iron — the derivation reads the stop, never the player's progress.
    expect(storySettingsFor(storyStopById('the-pjs')!, playerWith('classic')).deck).toBe('pjs');
    expect(storySettingsFor(storyStopById('barbershop')!, playerWith('classic')).deck).toBe('revolutionaries');
  });

  it("the player's saved settings are never mutated by a story construction", () => {
    const mine = playerWith('harlem');
    const snapshot = { ...mine };
    for (const stop of STORY_STOPS) {
      const s = storySettingsFor(stop, mine);
      expect(s).not.toBe(mine);
      expect(mine).toEqual(snapshot);
      expect(mine.deck).toBe('harlem');
    }
  });

  it('resume restores the house deck from the saved stop', () => {
    const st = newGame(makeRules('joker'), 'house-deck-seed');
    const save: StorySavedGame = {
      v: 1, savedAt: 1, seed: 'house-deck-seed', settings: DEFAULT_SETTINGS, state: st, chat: [],
      names: ['You', 'Captain Block', 'Dee', 'Brick'],
      story: { stopId: 'the-pjs', track: 'solo', attemptsAtStart: 0, clearsAtStart: 0, session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 } },
    };
    saveStoryGame(save, save.story);
    const back = loadStoryGame()!;
    expect(back).toBeTruthy();
    // Exactly StoryHome's resume construction: the stop comes from the save,
    // the settings snapshot is rebuilt from the player's own settings.
    const stop = storyStopById(back.story.stopId)!;
    const resumed = storySettingsFor(stop, playerWith('egypt'));
    expect(resumed.deck).toBe('pjs');
    // …and it is the same deck a fresh start at that stop would deal.
    expect(resumed.deck).toBe(storySettingsFor(stop, playerWith('egypt')).deck);
  });

  // The normal-game half of this contract (Table activates the snapshot it
  // is handed; the offline app hands it the player's own settings untouched)
  // is pinned in story-house-deck-wiring.test.ts — source pins run in the
  // node environment, this file needs happy-dom's localStorage.
});
