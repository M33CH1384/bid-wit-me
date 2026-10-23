/**
 * SETUP SCREEN SCROLL SAFETY — source pins (owner report, 2026-10-23: the
 * table step opened with its left side cut off — "can't see most of the left
 * side and it can't resize to fix it" — and the bottom create bar never
 * appeared).
 *
 * Two mechanisms, both proven against the built app in a real engine
 * (Chromium probe, 430px and 390px viewports):
 *
 * 1. THE SIDEWAYS PAN. DeckGallery's mount effect called
 *    scrollIntoView({ inline: 'center' }) on the selected cover. That call
 *    scrolls EVERY scrollable ancestor — including .wizard, whose
 *    overflow-x: hidden makes it a programmatic scroll container with ~55px
 *    of scrollable overflow (485px scrollWidth at a 430px viewport, from the
 *    top bar's dock-slot reservation). The wizard scrolled sideways
 *    (scrollLeft 55 at 430px, 95 at 390px), carrying the whole form with it,
 *    and no player gesture can scroll an overflow:hidden container back.
 *    The fix scrolls the SLIDER ONLY, via its own scrollLeft. The behavior
 *    half of this pin lives in setup-gallery-scroll.test.ts.
 *
 * 2. THE CAPTURED BAR. .setup-bar is position:fixed but lives inside
 *    main.wiz-step, whose slide animation filled `both` — a forwards fill
 *    keeps the finished animation's transform applied (computed transform is
 *    an identity matrix, not `none`), so <main> stays the containing block
 *    for fixed descendants and the bar anchored to the bottom of the
 *    page-length step (measured bottom 1495 at a 932px viewport) instead of
 *    the viewport. The fill is now `backwards`, which is visually identical
 *    (no delay; the end keyframe is the natural state) and releases the
 *    transform when the slide settles. The same capture hid the deck
 *    browser's fixed backdrop.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('setup scroll safety — source pins', () => {
  it('DeckGallery never calls scrollIntoView (it pans the wizard sideways)', () => {
    expect(src('DeckGallery.tsx')).not.toMatch(/\.scrollIntoView\s*\(/);
  });

  it('DeckGallery parks on the current deck by scrolling the slider itself', () => {
    const gallery = src('DeckGallery.tsx');
    expect(gallery).toContain("querySelector('.dg-cover.on')");
    expect(gallery).toMatch(/list\.scrollLeft\s*\+=/);
  });

  it('the wizard slide animation never fills forwards (a fill captures fixed descendants)', () => {
    const css = src('styles.css');
    for (const cls of ['slide-fwd', 'slide-back']) {
      const rule = new RegExp(`\\.${cls} \\{[^}]*\\}`).exec(css)?.[0] ?? '';
      expect(rule, `${cls} rule`).toContain('backwards');
      expect(rule, `${cls} rule`).not.toContain('both');
    }
  });

  it('the setup bar itself stays position:fixed (viewport-anchored once released)', () => {
    const css = src('styles.css');
    const rule = /\.setup-bar \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('position: fixed');
  });
});
