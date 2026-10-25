/**
 * @vitest-environment happy-dom
 *
 * DECK VIEWER (owner, 2026-10-25: "When a new deck is unlocked I should be
 * able to tap it and scroll thru it"). The unlock moment used to be a dead
 * card on the story outro — the deck's back art and a name, nothing to tap.
 * Now the card is a door into the DeckViewer: the browser sheet as a LOOK,
 * not a picker — the whole deck in deck order (the back, the art faces,
 * every card), tap any card for the close-up, and no Use action anywhere,
 * so looking can never change a selection and closing lands back on the
 * exact outro the player came from.
 *
 * Pins: composition (54 cards in DECK_CARD_ORDER + the back = 55 tiles,
 * back first; Pj's Iron's aces ride the faces grid), the close-up and the
 * back close-up, every close path, the scroll container + landscape width
 * in the shipped CSS, and the outro wiring in StoryHome's source (the
 * repo's story-suites pattern — the outro's render path is exercised by
 * the story-home suites).
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckViewer } from '../src/DeckGallery';
import { deckArtUrl, deckById, type DeckDef } from '../src/decks';
import { DECK_CARD_ORDER } from '../src/deckLore';
import { deckBackUrl } from '../src/three/cardTextures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles = readFileSync('apps/web/src/styles.css', 'utf8');
const storyCss = readFileSync('apps/web/src/story/story.css', 'utf8');
const home = readFileSync('apps/web/src/story/StoryHome.tsx', 'utf8');

let root: Root; let el: HTMLDivElement;
let closes = 0;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const qsa = <T extends Element = HTMLElement>(sel: string) => [...el.querySelectorAll(sel)] as T[];
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

async function renderViewer(deck: DeckDef) {
  closes = 0;
  await act(async () => {
    root.render(createElement(DeckViewer, { deck, onClose: () => { closes += 1; } }));
  });
  await flush();
}

beforeEach(() => {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); });

describe('DeckViewer — the whole deck, scrollable', () => {
  it('renders every card in deck order plus the back, back first (Porch Light)', async () => {
    await renderViewer(deckById('porchlight')!);
    expect(qs('[data-testid="deck-viewer"]')).not.toBeNull();
    const tiles = qsa('.db-tile');
    // 54 cards (DECK_CARD_ORDER: 52 + both jokers — every deck pack ships
    // both joker faces) + the back.
    expect(tiles.length).toBe(DECK_CARD_ORDER.length + 1);
    expect(tiles.length).toBe(55);
    expect(tiles[0]!.dataset.testid).toBe('deck-card-BACK');
    for (const c of DECK_CARD_ORDER) {
      expect(qs(`[data-testid="deck-card-${c}"]`), `tile for ${c}`).not.toBeNull();
    }
    // sections in order: the back, the faces, every card
    const body = qs('.db-body')!;
    const text = body.textContent ?? '';
    expect(text.indexOf('The back')).toBeLessThan(text.indexOf('The faces'));
    expect(text.indexOf('The faces')).toBeLessThan(text.indexOf('Every card'));
    // the back tile carries the deck's real back art
    const backImg = tiles[0]!.querySelector('img');
    expect(backImg?.getAttribute('src')).toBe(deckBackUrl('porchlight'));
    expect(deckBackUrl('porchlight')).toBe('/assets/card-backs/PorchLight-back.webp');
    // Porch Light ships art for the 12 courts + 2 jokers; the rest are index faces
    expect(qsa('.db-grid.faces .db-tile').length).toBe(14);
    expect(qsa('.db-grid.rest .db-tile').length).toBe(40);
    // the scroll reaches the last card: the final rest tile is the last
    // art-less card in deck order (Ten of Clubs)
    const rest = qsa('.db-grid.rest .db-tile');
    expect(rest[rest.length - 1]!.dataset.testid).toBe('deck-card-10C');
  });

  it("Pj's Iron: the four aces ride the faces grid, still 55 tiles", async () => {
    await renderViewer(deckById('pjs')!);
    expect(qsa('.db-tile').length).toBe(55);
    expect(qsa('.db-grid.faces .db-tile').length).toBe(18);
    expect(qsa('.db-grid.rest .db-tile').length).toBe(36);
    expect(qs('[data-testid="deck-card-AS"]')!.closest('.db-grid')!.classList.contains('faces')).toBe(true);
  });

  it('is a look, not a picker: no Use action anywhere', async () => {
    await renderViewer(deckById('porchlight')!);
    expect(qs('[data-testid^="deck-use"]')).toBeNull();
    expect(el.textContent).not.toContain('Use this deck');
  });

  it('tap a card for the close-up; prev/next walk deck order; All cards returns', async () => {
    await renderViewer(deckById('porchlight')!);
    await click(qs('[data-testid="deck-card-KS"]'));
    const focus = qs('[data-testid="deck-card-focus"]');
    expect(focus).not.toBeNull();
    expect(focus!.querySelector('img.db-big')?.getAttribute('src')).toBe(deckArtUrl('porchlight', 'KS'));
    expect(qs('.db-focus-name')?.textContent).toBe('King of Spades');
    await click(qs('[data-testid="deck-card-next"]'));
    expect(qs('.db-focus-name')?.textContent).toBe('Ace of Hearts');
    await click(qs('[data-testid="deck-all-cards"]'));
    expect(qs('[data-testid="deck-card-focus"]')).toBeNull();
    expect(qsa('.db-tile').length).toBe(55);
  });

  it('tap the back for its own close-up', async () => {
    await renderViewer(deckById('porchlight')!);
    await click(qs('[data-testid="deck-card-BACK"]'));
    const focus = qs('[data-testid="deck-back-focus"]');
    expect(focus).not.toBeNull();
    expect(focus!.querySelector('img.db-big')?.getAttribute('src')).toBe(deckBackUrl('porchlight'));
    await click(qs('[data-testid="deck-all-cards"]'));
    expect(qs('[data-testid="deck-back-focus"]')).toBeNull();
    expect(qsa('.db-tile').length).toBe(55);
  });

  it('closes by ✕, by Done, and by tapping the backdrop', async () => {
    await renderViewer(deckById('porchlight')!);
    await click(qs('[data-testid="deck-viewer-close"]'));
    expect(closes).toBe(1);
    await click(qs('[data-testid="deck-viewer-done"]'));
    expect(closes).toBe(2);
    await click(qs('.db-backdrop'));
    expect(closes).toBe(3);
  });
});

describe('DeckViewer — shipped CSS carries the scroll and the landscape stage', () => {
  it('the sheet body is the scroll container; the back grid holds one face-size tile', () => {
    const bodyRule = styles.match(/\.db-body \{[^}]*\}/)![0];
    expect(bodyRule).toContain('overflow-y: auto');
    expect(styles).toContain('.db-grid.back { grid-template-columns: 92px; }');
  });

  it('in landscape the viewer sheet takes the stage width', () => {
    const land = styles.slice(styles.indexOf('@media (orientation: landscape) and (max-height: 540px)'));
    expect(land).toContain('.deck-browser.deck-viewer { width: min(1080px, 97vw); }');
  });
});

describe('the outro door (StoryHome source)', () => {
  it('the deck unlock card is a button that opens the viewer for the stop’s deck', () => {
    expect(home).toContain('<button type="button" className="story-reward-card story-deck-line story-reveal story-deck-tap" data-testid="story-deck-notice"');
    expect(home).toContain('onClick={() => setViewDeck(deckForStop(r.stopId)!)}');
    expect(home).toContain('Tap to look through the deck →');
    // the pinned unlock presentation itself is untouched
    expect(home).toContain('deckBackUrl(deckForStop(r.stopId)!.id)');
    expect(home).toContain('Yours for good — find it in the deck picker, at any table.');
  });

  it('the viewer mounts as an overlay at the root, outro state untouched beneath it', () => {
    expect(home).toContain("import { DeckViewer } from '../DeckGallery';");
    expect(home).toContain('{viewDeck && <DeckViewer deck={viewDeck} onClose={() => setViewDeck(null)} />}');
    // the outro's own exits stay put (the return lands on the same screen)
    expect(home).toContain('data-testid="story-outro-map"');
  });

  it('the tap card keeps the settled look (story.css)', () => {
    expect(storyCss).toContain('.story-deck-tap { font: inherit; color: inherit; cursor: pointer; width: 100%; }');
    expect(storyCss).toContain('.story-reward-card-view');
  });
});
