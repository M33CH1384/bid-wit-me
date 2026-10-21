/**
 * Story house decks — wiring pins (node environment, source-level like
 * story-css.test.ts / card-backs.test.ts). Behavior is pinned in
 * story-house-decks.test.ts; these pins guard the two mechanisms the
 * behavior hangs off, so neither can drift silently:
 *
 *  1. Table has exactly one deck decision: it activates the deck its
 *     settings snapshot carries (backs + faces for every seat follow the
 *     active deck). Story hands it the house snapshot; a normal game hands
 *     it the player's own settings — so normal games keep dealing the
 *     player's selected deck because nothing but storySettingsFor ever
 *     overrides `deck`.
 *  2. StoryHome builds the table's settings ONLY through storySettingsFor,
 *     for fresh starts and resumes alike (the resume save feeds the `resume`
 *     prop, never a second settings construction).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const storyHome = readFileSync(new URL('../src/story/StoryHome.tsx', import.meta.url), 'utf8');

describe('house deck wiring', () => {
  it("Table activates the settings snapshot's deck — the one and only deck decision", () => {
    expect(table).toContain('setActiveDeck(settings.deck)');
  });

  it("the offline app hands Table the player's own settings untouched", () => {
    expect(app).toMatch(/<Table[\s\S]*?settings=\{settings\}/);
  });

  it('StoryHome constructs table settings only via storySettingsFor (fresh + resume share it)', () => {
    expect(storyHome).toContain('const gameSettings = storySettingsFor(stop, settings);');
    expect(storyHome).toContain('settings={gameSettings}');
    expect(storyHome).toContain('resume={screen.resumeSave}');
  });
});
