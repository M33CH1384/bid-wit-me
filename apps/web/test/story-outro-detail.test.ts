/**
 * @vitest-environment happy-dom
 *
 * OUTRO DETAIL SHEETS (owner, 2026-10-25: "These should be tap able as
 * well"). The deck card became a door into the DeckViewer; the rest of
 * the outro's unlock stack was still dead presentation. Now the
 * set-animation card, the find cards and every badge tile open a detail
 * sheet over the screen — the DeckViewer's overlay discipline (backdrop,
 * ✕, Done, Escape; closing returns to the exact screen underneath) with
 * content that is ONLY the game's own data: badge about/hint/detail,
 * the egg's tale, the feat's featText, the set animation's name + blurb,
 * and a live preview played by the recap's own SetCover engine.
 *
 * Pins: each kind opens with the correct item's data (verbatim from the
 * definitions), a locked badge shows its criterion, the set-anim preview
 * mounts the real covers per tier with NO finale headline (a headline is
 * keyed to a real game's ending — a preview has none to show), an
 * unresolvable find falls back to the card's own line and nothing else,
 * close paths all land back on the underlying screen, and the outro
 * wiring in StoryHome's / StoryRoom's source.
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORY_SECRETS, STORY_STOPS, storyBadgesFor } from '@spades/bots';
import StoryBadges, { badgeFactsOf } from '../src/story/StoryBadges';
import { FindDetail, SetAnimDetail, splitSetAnimBlurb } from '../src/story/StoryDetailSheet';
import { SET_ANIMS, setAnimForStop } from '../src/setAnims';
import type { StoryNewFind } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storyCss = readFileSync('apps/web/src/story/story.css', 'utf8');
const home = readFileSync('apps/web/src/story/StoryHome.tsx', 'utf8');
const room = readFileSync('apps/web/src/story/StoryRoom.tsx', 'utf8');

let root: Root; let el: HTMLDivElement;
let closes = 0;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};
const onClose = () => { closes += 1; };

beforeEach(() => {
  closes = 0;
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); });

const render = async (node: Parameters<Root['render']>[0]) => {
  await act(async () => { root.render(node); });
  await flush();
};

describe('badge detail sheet — the tile is a door (shared: outro, map, profile)', () => {
  const facts = badgeFactsOf({
    stops: STORY_STOPS.map((s) => ({ stopId: s.id, attempts: s.id === 'porch' ? 1 : 0, clears: s.id === 'porch' ? 1 : 0 })),
    finds: { eggs: [], feats: [] },
    completed: false,
  });
  const defs = storyBadgesFor(facts);

  it('an earned badge opens its sheet with the def’s about + how it was earned', async () => {
    await render(createElement(StoryBadges, { facts }));
    await click(qs('[data-testid="story-badge-porch-graduate"]'));
    const sheet = qs('[data-testid="story-badge-detail"]');
    expect(sheet, 'badge detail sheet').not.toBeNull();
    const def = defs.find((b) => b.id === 'porch-graduate')!;
    expect(def.earned).toBe(true);
    expect(sheet!.textContent).toContain(def.name);
    expect(sheet!.textContent).toContain(def.about);
    expect(sheet!.textContent).toContain(def.detail!); // "Earned: cleared The Porch."
    expect(sheet!.querySelector('.badge3d-front .badge3d-glyph')!.textContent).toBe(def.icon);
  });

  it('a locked badge opens too — and shows its unlock criterion, not a blank', async () => {
    await render(createElement(StoryBadges, { facts }));
    await click(qs('[data-testid="story-badge-egg-hunter"]'));
    const sheet = qs('[data-testid="story-badge-detail"]');
    expect(sheet).not.toBeNull();
    const def = defs.find((b) => b.id === 'egg-hunter')!;
    expect(def.earned).toBe(false);
    expect(sheet!.textContent).toContain(`To unlock: ${def.hint}`);
    expect(sheet!.textContent).toContain(def.about);
    // the locked medallion keeps its ghost in the sheet
    expect(sheet!.classList.contains('ghost')).toBe(true);
  });

  it('every close path dismisses the sheet: ✕, Done, backdrop, Escape', async () => {
    await render(createElement(StoryBadges, { facts }));
    const tile = () => qs('[data-testid="story-badge-porch-graduate"]');
    await click(tile());
    await click(qs('[data-testid="story-detail-close"]'));
    expect(qs('[data-testid="story-badge-detail"]')).toBeNull();
    await click(tile());
    await click(qs('[data-testid="story-detail-done"]'));
    expect(qs('[data-testid="story-badge-detail"]')).toBeNull();
    await click(tile());
    const backdrop = qs('.story-detail-backdrop');
    await click(backdrop);
    expect(qs('[data-testid="story-badge-detail"]')).toBeNull();
    await click(tile());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(qs('[data-testid="story-badge-detail"]')).toBeNull();
  });
});

describe('set-animation detail — name, both tiers’ own words, a live preview', () => {
  it('the Pj’s: Lights Out with the blurb split at its own Finale marker', async () => {
    await render(createElement(SetAnimDetail, { stopId: 'the-pjs', onClose }));
    const sheet = qs('[data-testid="story-setanim-detail"]');
    expect(sheet).not.toBeNull();
    const def = setAnimForStop('the-pjs')!;
    expect(sheet!.textContent).toContain(def.name);
    expect(sheet!.textContent).toContain(def.stopName); // the stop, from the def
    const { regular, finale } = splitSetAnimBlurb(def.blurb);
    expect(sheet!.textContent).toContain(regular);
    expect(sheet!.textContent).toContain(finale!);
  });

  it('the preview mounts the recap’s real SetCover per tier — and no invented finale headline', async () => {
    await render(createElement(SetAnimDetail, { stopId: 'the-pjs', onClose }));
    const reg = qs('[data-testid="story-setanim-stage-regular"] .setcover');
    const fin = qs('[data-testid="story-setanim-stage-finale"] .setcover');
    expect(reg, 'regular cover').not.toBeNull();
    expect(fin, 'finale cover').not.toBeNull();
    expect(reg!.getAttribute('data-anim')).toBe('the-pjs');
    expect(reg!.getAttribute('data-tier')).toBe('regular');
    expect(fin!.getAttribute('data-tier')).toBe('finale');
    expect(reg!.getAttribute('data-mode')).toBe('fresh'); // it PLAYS; it is not a static stand-in
    expect(fin!.getAttribute('data-mode')).toBe('fresh');
    // a finale headline is keyed to a real game's ending fact — the
    // preview has none, so none is fabricated for it
    expect(qs('.finale-verdict')).toBeNull();
    // replay remounts the covers (a fresh play of the same engine)
    const before = qs('[data-testid="story-setanim-stage-regular"] .setcover');
    await click(qs('[data-testid="story-setanim-replay"]'));
    expect(qs('[data-testid="story-setanim-stage-regular"] .setcover')).not.toBeNull();
    expect(qs('[data-testid="story-setanim-stage-regular"] .setcover')).not.toBe(before);
  });

  it('every stop’s blurb split recombines to the authored blurb — nothing reworded', () => {
    for (const def of SET_ANIMS) {
      const { regular, finale } = splitSetAnimBlurb(def.blurb);
      expect(finale, `${def.stopId} carries a finale tier`).not.toBeNull();
      expect(`${regular} Finale: ${finale}`).toBe(def.blurb);
    }
  });
});

describe('find detail — the egg’s tale, the feat’s own text, nothing invented', () => {
  it('an egg shows its authored tale verbatim', async () => {
    const find: StoryNewFind = { kind: 'egg', id: 'pjs-opp-set-twice', name: "Brick's Second Blink" };
    await render(createElement(FindDetail, { find, onClose }));
    const sheet = qs('[data-testid="story-find-detail"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain(find.name);
    expect(sheet!.textContent).toContain(STORY_SECRETS['the-pjs']!.egg.tale);
  });

  it('a feat shows its authored featText verbatim', async () => {
    const find: StoryNewFind = { kind: 'feat', id: 'story-pjs-bulb', name: "Brick's Streetlight Bulb" };
    await render(createElement(FindDetail, { find, onClose }));
    const sheet = qs('[data-testid="story-find-detail"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain(find.name);
    expect(sheet!.textContent).toContain(STORY_SECRETS['the-pjs']!.unlockable.featText);
  });

  it('an unresolvable find shows only the card’s own fallback line — no borrowed tale', async () => {
    const find: StoryNewFind = { kind: 'egg', id: 'no-such-egg', name: 'Mystery Egg' };
    await render(createElement(FindDetail, { find, onClose }));
    const sheet = qs('[data-testid="story-find-detail"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain('Hidden egg — recorded on this stop’s map card.');
    expect(sheet!.textContent).not.toContain(STORY_SECRETS['porch']!.egg.tale);
    expect(sheet!.textContent).not.toContain(STORY_SECRETS['the-pjs']!.egg.tale);
  });

  it('closing a find sheet reports through onClose (the outro underneath is untouched state)', async () => {
    const find: StoryNewFind = { kind: 'feat', id: 'story-porch-cap', name: "Ray's Lucky Bottle Cap" };
    await render(createElement(FindDetail, { find, onClose }));
    await click(qs('[data-testid="story-detail-done"]'));
    expect(closes).toBe(1);
  });
});

describe('outro wiring — the cards are buttons, the sheets mount as overlays', () => {
  it('StoryHome: the set-animation card is a button into SetAnimDetail', () => {
    expect(home).toContain('<button type="button" className="story-reward-card story-deck-line story-reveal story-card-tap" data-testid="story-setanim-notice"');
    expect(home).toContain("setDetail({ kind: 'setanim', stopId: r.stopId })");
    expect(home).toContain('<SetAnimDetail stopId={detail.stopId} onClose={() => setDetail(null)} />');
  });

  it('StoryHome: the find cards are buttons into FindDetail', () => {
    expect(home).toContain('className="story-reward-card find story-reveal story-card-tap"');
    expect(home).toContain("setDetail({ kind: 'find', find: f })");
    expect(home).toContain('<FindDetail find={detail.find} onClose={() => setDetail(null)} />');
  });

  it('StoryHome: the deck card’s door is untouched', () => {
    expect(home).toContain('<button type="button" className="story-reward-card story-deck-line story-reveal story-deck-tap" data-testid="story-deck-notice"');
    expect(home).toContain('<DeckViewer deck={viewDeck} onClose={() => setViewDeck(null)} />');
  });

  it('StoryRoom: the co-op outro’s find cards are the same doors', () => {
    expect(room).toContain('className="story-reward-card find story-card-tap"');
    expect(room).toContain('onClick={() => setFindDetail(f)}');
    expect(room).toContain('<FindDetail find={findDetail} onClose={() => setFindDetail(null)} />');
  });

  it('the sheet + preview styles ship, with the landscape stage width', () => {
    expect(storyCss).toContain('.story-detail-sheet');
    expect(storyCss).toContain('.story-setanim-stage');
    expect(storyCss).toContain('.story-card-tap');
    const landscape = storyCss.slice(storyCss.indexOf('@media (orientation: landscape) and (max-height: 540px)'));
    expect(landscape).toContain('.story-detail-sheet { width: min(1080px, 97vw); }');
  });
});
