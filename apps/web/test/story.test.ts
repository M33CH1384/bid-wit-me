/**
 * @vitest-environment happy-dom
 *
 * Story Mode Phase 1 (web): stop twists become real rules through the
 * existing settings machinery, every stop's venue exists, and the map screen
 * renders identically under both themes (parity law).
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { STORY_STOPS, storyStopById } from '@spades/bots';
import { VENUES } from '@spades/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { storyRulesFor, storySettingsFor } from '../src/story/storySettings';
import { themeStore } from '../src/theme';
import StoryHome from '../src/story/StoryHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: Settings = { ...DEFAULT_SETTINGS };

describe('story rules', () => {
  it('every stop venue is a real venue', () => {
    for (const s of STORY_STOPS) expect(VENUES, s.id).toContain(s.venueId);
  });

  it('twists land in the rules: targets, timers, nil and blind-nil values, modes', () => {
    const porch = storyRulesFor(storyStopById('porch')!, base);
    expect(porch.targetScore).toBe(250);
    expect(porch.turnTimerSec).toEqual({ bid: 45, play: 45 });

    const shop = storyRulesFor(storyStopById('barbershop')!, base);
    expect(shop.mode).toBe('aceDown');
    expect(shop.deck).toBe('standard52');

    const rec = storyRulesFor(storyStopById('rec-center')!, base);
    expect(rec.turnTimerSec).toEqual({ bid: 20, play: 20 });

    const church = storyRulesFor(storyStopById('church-basement')!, base);
    expect(church.nil.value).toBe(200);

    const roof = storyRulesFor(storyStopById('rooftop')!, base);
    expect(roof.blindNil.allowed).toBe(true);
    expect(roof.blindNil.onlyWhenBehindBy).toBeNull();
    expect(roof.blindNil.value).toBe(300);

    const king = storyRulesFor(storyStopById('king')!, base);
    expect(king.targetScore).toBe(750);
    expect(king.partnerships).toBe(true);
    expect(king.playerCount).toBe(4);
  });

  it('story settings never mutate the player\u2019s own settings', () => {
    const mine: Settings = { ...DEFAULT_SETTINGS, targetScore: 'default', venue: 'classic' };
    const s = storySettingsFor(storyStopById('the-pjs')!, mine);
    expect(s.venue).toBe('blockAfterDark');
    expect(s.targetScore).toBe(500);
    expect(mine.venue).toBe('classic');
    expect(mine.targetScore).toBe('default');
  });
});

/* ---- map screen, both themes ---- */

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}
afterEach(unmount);

async function renderThemed(theme: 'classic' | 'neon', node: ReactNode) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    themeStore.set(theme);
    root!.render(node);
  });
  // let the progress fetch settle into its error/signed-out state
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return el;
}

const inventory = (c: HTMLElement) =>
  [...c.querySelectorAll('button, a[href], input, select, textarea')]
    .map((n) => {
      const e = n as HTMLElement & { value?: string };
      return [e.tagName, e.getAttribute('data-testid') ?? '', (e.textContent ?? '').trim().replace(/\s+/g, ' '), e.getAttribute('href') ?? '', e.value ?? ''].join('|');
    })
    .sort();

describe('story map screen', () => {
  it('renders all 11 stops with pair, twist and a Play button on the current stop', async () => {
    const c = await renderThemed('classic', createElement(StoryHome));
    for (const s of STORY_STOPS) expect(c.querySelector(`[data-testid="story-stop-${s.id}"]`), s.id).toBeTruthy();
    expect(c.querySelector('[data-testid="story-play-porch"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-play-barbershop"]')).toBeNull(); // locked in the preview state
    expect(c.textContent).toContain('Uncle Ray');
    expect(c.textContent).toContain('The King of the Block');
    expect(c.textContent).toContain('Running with Dee');
  });

  it('is identical under Classic and Neon (theme parity)', async () => {
    const a = await renderThemed('classic', createElement(StoryHome));
    const invA = inventory(a);
    const textA = a.textContent;
    const b = await renderThemed('neon', createElement(StoryHome));
    expect(inventory(b)).toEqual(invA);
    expect(b.textContent).toEqual(textA);
  });
});
