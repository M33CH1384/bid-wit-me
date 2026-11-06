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
import { fanEpisodeActive, panelBodyHeld } from '../src/social/entryPeak';

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
