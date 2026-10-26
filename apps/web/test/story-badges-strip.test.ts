/**
 * @vitest-environment happy-dom
 *
 * Story badges redesign (S2, boards/story-badges.md): the map strip, the
 * full collection sheet (NEW, "N to go", ✕), and the outro reveal.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import StoryBadges, { StoryBadgeReveal, badgeFactsOf, newestEarned } from '../src/story/StoryBadges';
import { storyBadgesFor } from '@spades/bots';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let roots: Root[] = [];
async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  roots.push(root);
  await act(async () => { root.render(el); });
  return c;
}
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
});

const facts = badgeFactsOf({
  stops: [{ stopId: 'porch', attempts: 1, clears: 1 }, { stopId: 'corner', attempts: 1, clears: 1 }],
  finds: { eggs: [], feats: [] },
  completed: false,
});

describe('story badges strip + sheet', () => {
  it('newest-first falls back to the defs reversed (no earned-at stamp)', () => {
    const b = storyBadgesFor(facts);
    const earned = b.filter((x) => x.earned);
    expect(newestEarned(b).map((x) => x.id)).toEqual(earned.map((x) => x.id).reverse());
  });

  it('the strip shows count, at most 3 medals, and See all opens the sheet', async () => {
    const c = await renderEl(createElement(StoryBadges, { facts, variant: 'strip' }));
    const total = storyBadgesFor(facts).length;
    const n = storyBadgesFor(facts).filter((x) => x.earned).length;
    expect(c.querySelector('.story-badges.strip')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-badges-count"]')!.textContent).toBe(`${n} of ${total}`);
    expect(c.querySelectorAll('.story-badges-recent .story-medal').length).toBe(Math.min(3, n));
    expect(c.querySelector('.story-badge')).toBeNull();
    await click(c.querySelector('[data-testid="story-badges-all"]')!);
    const sheet = c.querySelector('[data-testid="story-badges-sheet"]')!;
    expect(sheet.querySelectorAll('button.story-badge').length).toBe(total);
    expect(sheet.querySelectorAll('.story-badge.new').length).toBe(1);
    expect(sheet.querySelector('[data-testid="story-badges-remainder"]')!.textContent).toContain(`${total - n} to go`);
    await click(sheet.querySelector('[data-testid="story-badge-porch-graduate"]')!);
    expect(c.querySelector('[data-testid="story-badge-detail"]')).toBeTruthy();
    await click(sheet.querySelector('[data-testid="story-badges-sheet-close"]')!);
    expect(c.querySelector('[data-testid="story-badges-sheet"]')).toBeNull();
  });

  it('the reveal shows each new badge in turn, then steps aside', async () => {
    const fresh = new Set(['porch-graduate']);
    const c = await renderEl(createElement(StoryBadgeReveal, { facts, fresh }));
    expect(c.querySelector('.sbr-name')!.textContent).toBe('Porch Graduate');
    await click(c.querySelector('[data-testid="story-badge-reveal-all"]')!);
    expect(c.querySelector('[data-testid="story-badges-sheet"] .story-badge-porch-graduate, [data-testid="story-badges-sheet"] [data-testid="story-badge-porch-graduate"].new')).toBeTruthy();
    await click(c.querySelector('[data-testid="story-badges-sheet-close"]')!);
    await click(c.querySelector('[data-testid="story-badge-reveal-nice"]')!);
    expect(c.querySelector('[data-testid="story-badge-reveal"]')).toBeNull();
  });
});
