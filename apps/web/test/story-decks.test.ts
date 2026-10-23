import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { existsSync, statSync } from 'node:fs';
import { DECKS, STORY_DECKS, deckById } from '../src/decks';
import { clearedStopIds, deckUnlockLine, deckUnlockNotice, deckUnlocked } from '../src/storyDecks';
import { DeckGallery } from '../src/DeckGallery';
import type { StoryProgress } from '../src/story/storyApi';

const stop = (stopId: string, clears: number) => ({ stopId, n: 1, state: (clears > 0 ? 'cleared' : 'available') as StoryProgress['stops'][number]['state'], attempts: clears + 1, clears, firstClearedAt: clears ? 1 : null });
const progress = (rows: ReturnType<typeof stop>[]): StoryProgress => ({ track: 'solo', stops: rows, currentStop: null, completed: false, completedAt: null, completionMark: null });

describe('story deck unlock derivation (progress is the ledger)', () => {
  it('a cleared stop unlocks its deck; an uncleared one stays locked', () => {
    const cleared = clearedStopIds(progress([stop('porch', 1), stop('the-pjs', 0)]));
    expect(cleared).toEqual(new Set(['porch']));
    expect(deckUnlocked(deckById('porchlight')!, cleared)).toBe(true);
    expect(deckUnlocked(deckById('pjs')!, cleared)).toBe(false);
    expect(deckUnlocked(deckById('pjs')!, clearedStopIds(progress([stop('the-pjs', 2)])))).toBe(true);
  });
  it('signed-out / no progress → free decks only; progress still loading → story decks locked', () => {
    const none = clearedStopIds(null);
    expect(none.size).toBe(0);
    for (const d of DECKS) expect(deckUnlocked(d, none)).toBe(!d.storyStopId);
    for (const d of STORY_DECKS) expect(deckUnlocked(d, null)).toBe(false);
    expect(deckUnlocked(deckById('classic')!, null)).toBe(true);
  });
  it('replays count once: clears > 0 is the whole rule', () => {
    expect(clearedStopIds(progress([stop('king', 5)]))).toEqual(new Set(['king']));
    expect(deckUnlocked(deckById('madeitout')!, clearedStopIds(progress([stop('king', 5)])))).toBe(true);
  });
});

describe('unlock lines + notice (picker + outro hook)', () => {
  it('locked story decks name their stop; the King deck is the made-it-out reward', () => {
    expect(deckUnlockLine(deckById('pjs')!)).toBe("Clear The Pj's in Story Mode");
    expect(deckUnlockLine(deckById('revolutionaries')!)).toBe('Clear The Barbershop in Story Mode');
    expect(deckUnlockLine(deckById('madeitout')!)).toContain('Finish the route');
    expect(deckUnlockLine(deckById('classic')!)).toBeNull();
  });
  it('deckUnlockNotice names the deck a stop clear earns (story outro integration point)', () => {
    expect(deckUnlockNotice('the-pjs')).toBe("New deck unlocked: Pj's Iron");
    expect(deckUnlockNotice('king')).toBe('New deck unlocked: Made It Out');
    expect(deckUnlockNotice('porch')).toBe('New deck unlocked: Porch Light');
    expect(deckUnlockNotice('nowhere')).toBeNull();
  });
});

describe('story deck gallery rendering (locked state)', () => {
  it('story decks render locked with 🔒 + unlock line before progress loads; free decks stay plain', () => {
    const html = renderToString(createElement(DeckGallery, { value: 'classic', onChange: () => {} }));
    expect(html).toContain('data-testid="deck-pjs"');
    expect(html).toContain('🔒');
    expect(html).toContain("Clear The Pj&#x27;s in Story Mode");
    expect(html).toContain('Made It Out');
    expect(html).toContain('Finish the route — clear The King of the Block in Story Mode');
    // Setup rework: a locked cover is NOT disabled — tapping it opens the deck
    // browser (looking is free). Selection stays locked inside the browser
    // (its Use action is disabled; see deck-gallery.test.ts). The cover still
    // carries the locked styling.
    const pjsBtn = html.match(/<button[^>]*data-testid="deck-pjs"[^>]*>/)?.[0] ?? '';
    expect(pjsBtn).not.toContain('disabled');
    expect(pjsBtn).toContain('locked');
    const classicBtn = html.match(/<button[^>]*data-testid="deck-classic"[^>]*>/)?.[0] ?? '';
    expect(classicBtn).not.toContain('disabled');
    expect(classicBtn).not.toContain('locked');
  });
});

describe('story deck art assets', () => {
  const pub = (rel: string) => new URL(`../public/${rel}`, import.meta.url);
  it('every story deck ships courts + jokers as WebP within the size budget; Pj\'s also ships aces', () => {
    for (const d of STORY_DECKS) {
      for (const f of ['KS', 'QS', 'JS', 'KH', 'QD', 'JC', 'JOKER-BIG', 'JOKER-LIL']) {
        const u = pub(`assets/decks/${d.id}/${f}.webp`);
        expect(existsSync(u), `${d.id}/${f}`).toBe(true);
        expect(statSync(u).size, `${d.id}/${f} size`).toBeLessThanOrEqual(96 * 1024);
      }
    }
    for (const s of ['S', 'H', 'D', 'C']) {
      const u = pub(`assets/decks/pjs/A${s}.webp`);
      expect(existsSync(u)).toBe(true);
      expect(statSync(u).size).toBeLessThanOrEqual(96 * 1024);
    }
  });
  it('the Revolutionaries courts carry their 12 figures (one distinct base per court card)', () => {
    // KS/QS/JS/KH/QH/JH/KD/QD/JD/KC/QC/JC — 12 files, all present (roster pinned in decks data order)
    const files = ['KS', 'QS', 'JS', 'KH', 'QH', 'JH', 'KD', 'QD', 'JD', 'KC', 'QC', 'JC'];
    for (const f of files) expect(existsSync(pub(`assets/decks/revolutionaries/${f}.webp`))).toBe(true);
  });
});
