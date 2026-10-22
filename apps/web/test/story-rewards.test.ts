/**
 * @vitest-environment happy-dom
 *
 * Story rewards presentation (owner, 2026-10-21, over the Rec Center
 * win outro screenshot: "these achievements should have a badge or
 * something visible and visually stimulating — this is dry").
 *
 * Before: the outro's whole reward moment was a column of near-
 * identical outlined text pills ("First clear! +75 XP · +60", "New
 * deck unlocked: …", "🏆 Unlocked: …") and the badge strip a pile of
 * flat dim text chips separated only by a hairline's color.
 *
 * The pins guard the replacement's structure (happy-dom paints
 * nothing; the owner's screens are the pixel verdict):
 *  - the reward line is a HERO card with the amounts as stats;
 *  - a deck unlock carries the deck's real back art (deckBackUrl of
 *    the stop's own deck — the founder art set, not a placeholder);
 *  - set-animation + King-double cards wear an emblem medallion, and
 *    a find wears a trophy medallion with the find's own glyph;
 *  - badges are MEDALLIONS in one shared component: gold-ring medal +
 *    glyph + name, earned lit, unearned the same medal ghosted;
 *  - the outro reveals on a stagger (--i) that HOLDS at the settled
 *    state, the map's case never animates, and reduced motion
 *    collapses the whole reveal to settled;
 *  - amounts/copy/testids are the pre-overhaul ones — presentation
 *    only; the result-posting flow was not touched.
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import StoryBadges, { badgeFactsOf } from '../src/story/StoryBadges';
import { deckForStop } from '../src/decks';
import { deckBackUrl } from '../src/three/cardTextures';

// repo-root-relative reads (the render suites' pattern — under
// happy-dom, import.meta.url is not a file URL)
const css = readFileSync('apps/web/src/story/story.css', 'utf8');
const home = readFileSync('apps/web/src/story/StoryHome.tsx', 'utf8');
const badgesSrc = readFileSync('apps/web/src/story/StoryBadges.tsx', 'utf8');
const rewards = css.slice(css.indexOf('rewards presentation'));

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
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
});

describe('the medallion system (story.css)', () => {
  it('one medal design: gold ring gradient, dark inner disc, glyph lit on it', () => {
    const medal = rewards.match(/\.story-medal \{[^}]*\}/)![0];
    expect(medal).toContain('border-radius: 50%');
    expect(medal).toContain('radial-gradient');
    expect(medal).toContain('#c9a227'); // the gold of the ring
    const disc = rewards.match(/\.story-medal::before \{[^}]*\}/)![0];
    expect(disc).toContain('border-radius: 50%');
    expect(rewards).toContain('.story-medal-glyph');
  });

  it('unearned is the SAME medal ghosted — a silhouette to hunt, not a different object', () => {
    expect(rewards).toContain('.story-badge.locked .story-medal');
    const ghost = rewards.match(/\.story-badge\.locked \.story-medal \{[^}]*\}/)![0];
    expect(ghost).toContain('grayscale(1)');
  });

  it('just-earned medals shine: a sweep keyframe on NEW badges and find cards', () => {
    expect(rewards).toContain('.story-badge.new .story-medal::after');
    expect(rewards).toContain('.story-reward-card.find .story-medal::after');
    expect(rewards).toContain('@keyframes story-medal-shine');
  });

  it('badge tiles are medallion-over-name, and the case grids wide', () => {
    const tile = rewards.match(/\.story-badge \{[^}]*\}/)![0];
    expect(tile).toContain('flex-direction: column');
    expect(tile).toContain('border-radius: 14px'); // a tile, not the old 999px pill
    expect(rewards).toContain('grid-template-columns: repeat(auto-fill, minmax(98px, 1fr))');
  });

  it('the whole presentation is theme-agnostic (parity law)', () => {
    expect(rewards).not.toContain('data-theme');
  });
});

describe('the reveal: staggered, holds, collapsible', () => {
  it('cards pop in on their --i stagger and the keyframe ENDS at the settled state', () => {
    const rev = rewards.match(/\.story-reveal \{[^}]*\}/)![0];
    expect(rev).toContain('animation: story-reward-in');
    expect(rev).toContain('both'); // fill both ways: the end state holds
    expect(rev).toContain('var(--i, 0)');
    const kf = rewards.match(/@keyframes story-reward-in \{[\s\S]*?\n\}/)![0];
    expect(kf).toContain('opacity: 1');
    expect(kf).toContain('transform: none');
  });

  it('the badge cascade belongs to celebrate (outro) only', () => {
    expect(rewards).toContain('.story-badges.celebrate .story-badge');
    expect(badgesSrc).toContain("celebrate ? ' celebrate' : ''");
    // the map renders the component WITHOUT celebrate (StoryHome map branch)
    const mapBadges = home.slice(home.indexOf('<StoryBadges facts={badgeFactsOf(progress)}'));
    expect(mapBadges.slice(0, 90)).not.toContain('celebrate');
    // the outro renders it WITH celebrate
    expect(home).toContain('highlight={fresh} title="Badges" celebrate');
  });

  it('reduced motion collapses the reveal and the shine to the settled state', () => {
    const rm = rewards.slice(rewards.indexOf('prefers-reduced-motion'));
    expect(rm).toContain('.story-reveal');
    expect(rm).toContain('animation: none');
    expect(rm).toContain('.story-medal::after');
  });
});

describe('outro stack markup (StoryHome)', () => {
  it('the reward line is a hero card with the amounts as stats', () => {
    expect(home).toContain('story-reward-hero story-reward-line story-reveal');
    expect(home).toContain('story-reward-kicker');
    expect(home).toContain('<b>+{r.rewards.xp} XP</b>');
    expect(home).toContain('<b>+{r.rewards.coins}</b>');
    const hero = rewards.match(/\.story-reward-hero \{[^}]*\}/)![0];
    expect(hero).toContain('radial-gradient'); // the gold wash, not the flat pill outline
  });

  it('the deck unlock card carries the deck’s real back art', () => {
    expect(home).toContain('story-reward-deckart');
    expect(home).toContain('deckBackUrl(deckForStop(r.stopId)!.id)');
    // and the helper it calls is the founder art set's canonical URL
    expect(deckBackUrl(deckForStop('rec-center')!.id)).toBe('/assets/card-backs/Blacktop-back.webp');
    expect(rewards).toContain('.story-reward-deckart');
  });

  it('set-animation + double cards wear the emblem medallion; finds wear their glyph medallion', () => {
    expect(home).toContain('story-medal emblem');
    expect(home).toContain('story-reward-card find story-reveal');
    expect(home).toContain("f.kind === 'feat' ? '🏆' : '🥚'");
  });

  it('the stack is one staggered column (the finds included), testids and copy untouched', () => {
    expect(home).toContain('className="story-rewards"');
    for (const id of ['story-reward-line', 'story-double-line', 'story-deck-notice', 'story-setanim-notice', 'story-double-lost-line', 'story-new-finds']) {
      expect(home).toContain(`data-testid="${id}"`);
    }
    expect(home).toContain("['--i' as string]: 3 + j"); // finds stagger after hero + unlocks
  });
});

describe('badge medallions render (shared component: outro + map)', () => {
  it('every badge is a medal + name; earned lit, unearned ghosted by state class', async () => {
    const facts = badgeFactsOf({
      stops: [{ stopId: 'porch', attempts: 1, clears: 1 }],
      finds: { eggs: [], feats: [] },
      completed: false,
    });
    const c = await renderEl(createElement(StoryBadges, { facts }));
    const earned = c.querySelector('[data-testid="story-badge-porch-graduate"]')!;
    expect(earned.querySelector('.story-medal')).toBeTruthy();
    expect(earned.querySelector('.story-medal-glyph')!.textContent).toBe('🎓');
    expect(earned.querySelector('.story-badge-name')!.textContent).toBe('Porch Graduate');
    expect(earned.classList.contains('earned')).toBe(true);
    const locked = c.querySelector('[data-testid="story-badge-king-of-the-block"]')!;
    expect(locked.querySelector('.story-medal')).toBeTruthy(); // the ghost is present, not an empty slot
    expect(locked.classList.contains('locked')).toBe(true);
    // without celebrate the case carries no reveal class (map = at rest)
    expect(c.querySelector('.story-badges')!.classList.contains('celebrate')).toBe(false);
  });

  it('celebrate marks the case and staggers tiles by index', async () => {
    const facts = badgeFactsOf(null);
    const c = await renderEl(createElement(StoryBadges, { facts, celebrate: true, highlight: new Set(['porch-graduate']) }));
    expect(c.querySelector('.story-badges')!.classList.contains('celebrate')).toBe(true);
    const tiles = [...c.querySelectorAll<HTMLElement>('.story-badge')];
    expect(tiles.length).toBe(13);
    expect(tiles[3]!.style.getPropertyValue('--i')).toBe('3');
    expect(c.querySelector('[data-testid="story-badge-porch-graduate"]')!.classList.contains('new')).toBe(true);
  });
});
