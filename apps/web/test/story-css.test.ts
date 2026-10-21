/**
 * /story header regression pins (owner screenshot, 2026-10-21: the map's
 * back arrow, title and subtitle rendered blurred/washed as if under
 * frosted glass, with the speaker dock in a stray purple outline box).
 *
 * Root cause: .story-shell padded a flat 16px at the top — no
 * env(safe-area-inset-top) — so on a notched iPhone in standalone mode
 * the header rendered inside iOS's frosted status-bar zone (everything
 * below the zone was sharp, matching the screenshot exactly), and /story
 * offered the SoundDock no .dock-slot, so it fell back to a fixed corner
 * float over the header. Structural tests can't see blur; these pins
 * guard the two mechanisms so neither can come back silently.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/story/story.css', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/story/StoryHome.tsx', import.meta.url), 'utf8');

describe('/story header: sharp, safe-area clear, dock slotted', () => {
  it('the shell pads the top safe area, so the header never sits in the frosted status-bar zone', () => {
    const shell = css.match(/\.story-shell \{[^}]*\}/)![0];
    expect(shell).toContain('env(safe-area-inset-top)');
  });

  it('no backdrop-filter / blur filters anywhere in story CSS (the rewards-blur pattern)', () => {
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toMatch(/filter:\s*blur/);
  });

  it('deck-unlock integration: a posted result invalidates the picker cache and a first clear names its deck', () => {
    expect(home).toContain("from '../storyDecks'");
    // the postStoryResult handler drops the cached story progress so the
    // Setup deck picker sees the fresh clear without a reload
    const handler = home.match(/postStoryResult\([\s\S]*?\.then\(\(r\) => \{[\s\S]*?\}\)/)![0];
    expect(handler).toContain('invalidateStoryProgress()');
    // the outro renders the deck notice beside the first-clear reward line
    expect(home).toContain('data-testid="story-deck-notice"');
    expect(home).toContain('deckUnlockNotice(r.stopId)');
    expect(css).toContain('.story-deck-line');
  });

  it('every story topbar offers the sound dock a real in-flow slot (no corner float, no stray box)', () => {
    expect((home.match(/className="dock-slot"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const topbar = css.match(/\.story-topbar \{[^}]*\}/)![0];
    expect(topbar).not.toContain('padding-right: 56px'); // the old dodge for the floating dock
    expect(css).toContain('.story-topbar .dock-slot');
  });
});

/**
 * Story design language (owner screenshot, 2026-10-21: the Porch card's
 * action row circled — the Restart ghost button clipped by the card's
 * right edge, two plain-HTML-look ghost buttons beside a big chamfered
 * ESPN-gold RESUME block, and a broadcast-gold MATCH IN PROGRESS chip).
 *
 * Root causes, all structural: the story buttons had no family of their
 * own — `.btn`/`.ghost` are unstyled globally, so the secondaries fell
 * back to UA buttons while `.primary` pulled the global broadcast look
 * (clip-path chamfer, condensed all-caps) — and the row sized buttons by
 * content at the right edge, so three of them overflowed the card.
 * These pins guard the fix: one warm rounded family inside .story-shell,
 * hierarchy by fill only, and an action row laid out on flex fractions
 * of the card (with one designed wrap), so overflow is not possible.
 * happy-dom paints nothing, so these pin the structure, not pixels.
 */
describe('story design language: one warm button family, no broadcast chrome', () => {
  const design = css.slice(css.indexOf('story design language'));

  it('the ESPN chamfer never enters story CSS', () => {
    expect(css).not.toContain('clip-path: polygon');
  });

  it('story buttons are one rounded family in the reading font, sentence case, 44px targets', () => {
    const base = design.match(/\.story-shell \.btn \{[^}]*\}/)![0];
    expect(base).toContain('clip-path: none');
    expect(base).toContain('min-height: 44px');
    expect(base).toContain('border-radius: 12px');
    expect(base).toContain('text-transform: none');
    expect(base).toContain('font-family: inherit');
  });

  it('primary and secondary are the same shape — hierarchy by fill, not by form', () => {
    const primary = design.match(/\.story-shell \.btn\.primary \{[^}]*\}/)![0];
    const ghost = design.match(/\.story-shell \.btn\.ghost \{[^}]*\}/)![0];
    expect(primary).toContain('#241a05'); // dark ink on warm amber
    expect(primary).not.toContain('clip-path');
    expect(ghost).toContain('border-color: rgba(238, 201, 106'); // amber hairline, not a UA outline
    expect(ghost).not.toContain('clip-path');
  });

  it('the stop action row distributes by flex fractions, so no button can overflow the card', () => {
    const btns = design.match(/\.story-stop-actions \.btn \{[^}]*\}/)![0];
    expect(btns).toContain('flex: 1 1 0');
    expect(btns).toContain('min-width: 0');
    // the three-action (in-progress) row wraps BY DESIGN at phone widths:
    // the primary takes its own line, the secondaries split the next
    expect(design).toContain('.story-stop-actions:has(.story-restart) .btn.primary');
    expect(design).toContain('flex: 1 1 100%');
    // no story action button carries a fixed pixel width
    expect(design).not.toMatch(/\.story-(meet|play|restart) \{[^}]*width:/);
  });

  it('state chips are quiet captions over the art, not solid broadcast blocks', () => {
    const chip = design.match(/\.story-card-state \{[^}]*\}/)![0];
    expect(chip).toContain('border: 1px solid rgba(');
    expect(chip).toContain('background: rgba('); // translucent shade, not a solid block
    const here = design.match(/\.story-card-state\.here \{[^}]*\}/)![0];
    expect(here).not.toContain('background: #c9a227'); // the old solid ESPN gold
    expect(here).toContain('rgba(238, 201, 106'); // warm amber hairline instead
  });
});
