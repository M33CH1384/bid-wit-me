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
