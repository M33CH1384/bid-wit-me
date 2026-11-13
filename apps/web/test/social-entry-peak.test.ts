/**
 * crash-social3 — the Social entry peak: while a Card Fan episode is
 * running, the panel must not add its own first paint to the swap.
 * Two mechanisms, both pinned here:
 *  - the destination BODY is held until the episode ends (the frame —
 *    backdrop, header, nav, footer — paints under the fan as before);
 *  - the panel's backdrop filters stand down for the episode (a
 *    full-screen blur re-rasterizes on every fan frame).
 * The settled panel is untouched: at idle the body is present and the
 * glass is back. Pure predicate pins + source-wiring pins, repo idiom.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fanEpisodeActive, panelBodyHeld, socialFanSkipped } from '../src/social/entryPeak';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('crash-social3 — fan episode predicate', () => {
  it('a fan episode is active through cover and reveal, whatever rides it', () => {
    expect(fanEpisodeActive({ phase: 'cover', program: 'fan' })).toBe(true);
    expect(fanEpisodeActive({ phase: 'reveal', program: 'fan' })).toBe(true);
  });
  it('idle is never an episode, and other programs never hold the panel', () => {
    expect(fanEpisodeActive({ phase: 'idle', program: 'fan' })).toBe(false);
    expect(fanEpisodeActive({ phase: 'cover', program: 'spray' })).toBe(false);
    expect(fanEpisodeActive({ phase: 'reveal', program: 'deal' })).toBe(false);
    expect(fanEpisodeActive({ phase: 'cover', program: 'doorway' })).toBe(false);
    expect(fanEpisodeActive({ phase: 'idle', program: 'spray' })).toBe(false);
  });
  it('the body is held only while an episode runs and it has not latched yet', () => {
    expect(panelBodyHeld(true, false)).toBe(true);
    expect(panelBodyHeld(true, true)).toBe(false);
    expect(panelBodyHeld(false, false)).toBe(false);
    expect(panelBodyHeld(false, true)).toBe(false);
  });
});

describe('crash-social3 — wiring', () => {
  const social = read('../src/social/Social.tsx');
  const css = read('../src/social/social.css');
  const store = read('../src/social/store.ts');

  it('SocialPanel subscribes to the transition snapshot and derives the hold from it', () => {
    expect(social).toContain('useSyncExternalStore(subscribeTransitions, getTransitionSnapshot, getTransitionSnapshot)');
    expect(social).toContain('fanEpisodeActive');
    expect(social).toContain('panelBodyHeld');
  });
  it('the backdrop carries the episode class only while an episode runs', () => {
    expect(social).toMatch(/soc-backdrop[^`]*\$\{[^}]*soc-episode/);
  });
  it('the body content is gated by the hold (frame renders regardless)', () => {
    expect(social).toMatch(/\{!bodyHeld && \(/);
    expect(social).toContain('data-testid="social-panel"');
  });
  it('CSS stands the backdrop filters down during an episode, both themes', () => {
    expect(css).toMatch(/\.modal-backdrop\.soc-backdrop\.soc-episode\s*\{[^}]*backdrop-filter:\s*none/);
    expect(css).toMatch(/html\[data-theme="neon"\] \.soc-backdrop\.soc-episode \.soc-panel\s*\{[^}]*backdrop-filter:\s*none/);
  });
  it('the settled panel keeps its glass (the base rules are untouched)', () => {
    expect(css).toMatch(/\.modal-backdrop\.soc-backdrop \{[^}]*backdrop-filter: blur\(6px\)/);
    expect(css).toMatch(/html\[data-theme="neon"\] \.soc-panel \{[^}]*backdrop-filter: blur\(20px\)/);
  });
  it('Social open/close leave telemetry crumbs (the menu/Social death class was invisible)', () => {
    expect(store).toContain("noteCrumb('social', 'open')");
    expect(store).toContain("noteCrumb('social', 'close')");
  });
});

describe('crash-social4 — the fan is skipped for Social panel moves on iOS (reserve shelf)', () => {
  const dev = (ua: string, platform = '', maxTouchPoints = 0) => ({ ua, platform, maxTouchPoints });

  it('iPhone, iPad and iPod skip the fan', () => {
    expect(socialFanSkipped(dev('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15', 'iPhone', 5))).toBe(true);
    expect(socialFanSkipped(dev('Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15', 'iPad', 5))).toBe(true);
    expect(socialFanSkipped(dev('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15', 'iPod', 5))).toBe(true);
  });
  it('iPadOS desktop-mode UA (Macintosh + touch) skips the fan', () => {
    expect(socialFanSkipped(dev('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel', 5))).toBe(true);
  });
  it('a real Mac (no touch), Android and Windows keep the fan', () => {
    expect(socialFanSkipped(dev('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel', 0))).toBe(false);
    expect(socialFanSkipped(dev('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0', 'Linux armv8l', 5))).toBe(false);
    expect(socialFanSkipped(dev('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0', 'Win32', 0))).toBe(false);
    expect(socialFanSkipped(dev('', '', 0))).toBe(false);
  });

  const store = read('../src/social/store.ts');
  it('every Social panel move routes through the skip-aware swap (one fan call site: the funnel itself)', () => {
    expect(store).toContain('socialFanSkipped');
    expect(store).toContain('panelSwap');
    expect(store.match(/coverThen\(apply, 'profile-social'\)/g)).toHaveLength(1);
    expect(store.match(/panelSwap\(apply\)/g)!.length).toBeGreaterThanOrEqual(7);
  });
});
