/**
 * Bid panel × hand fan fit — the founder's iPhone defect of 2026-10-28
 * ("When standing the bid window is covering my cards", story Porch, hand 2).
 *
 * The bid panel's column (.me) is supposed to rest just above the player's fan:
 * Table measures the live hand top and sets --hand-clear, and the CSS anchor is
 * `bottom: var(--hand-clear, <fallback>)`. On the founder's phone the measurement
 * never landed (the 3D layout publish is not reliable there, and the flat felt
 * hand published nothing at all), so the panel sat on the old 23vh / 27vh
 * fallback guesses — ~110px too low in portrait — and covered the top half of
 * the fan while he was trying to bid.
 *
 * This test computes the fit from the shipped CSS + the shipped fan geometry
 * (the same solver Scene feeds the table) so the regression fails here instead
 * of on his phone:
 *   1. Each orientation's UNMEASURED fallback, on its own, must clear the
 *      13-card fan's top edge (+ the 6px breathing room --hand-clear adds) at
 *      every audited phone size, standing and sitting.
 *   2. The measurement itself must cover every hand the table can show: the
 *      3D layout publish AND the DOM felt hand.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cardScreenQuad,
  handFan,
  MIN_STRIP_PX,
  phoneHandFan,
  PHONE_HAND_STRIP_PX,
  type FanOpts,
} from '../src/three/layout';
import { feltCardBox, FELT_MAX_HEIGHT_FRAC } from '../src/FeltHand';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const table = read('../src/Table.tsx');

/** The fan options Scene.tsx builds for a 13-card hand (headless: safe-area insets are 0). */
function sceneFanOpts(W: number, H: number, view: 'standing' | 'sitting'): { opts: FanOpts; short: boolean } {
  const aspect = W / H;
  const short = aspect >= 1.25; // isShortLandscape gate used for the .short class family
  const sittingBottom = view === 'sitting' ? 12 / H : 0;
  if (short) {
    return { short, opts: { short: true, view, reserveFrac: 186 / W, bottomFrac: sittingBottom, heightFrac: 0.32, pxW: W, minStripPx: MIN_STRIP_PX } };
  }
  return { short, opts: { ...phoneHandFan(), view, bottomFrac: (phoneHandFan().bottomFrac ?? 0) + sittingBottom, pxW: W, minStripPx: PHONE_HAND_STRIP_PX } };
}

/** Topmost screen y of the 13-card fan, from the shipped layout solver. */
function fanTop(W: number, H: number, view: 'standing' | 'sitting'): number {
  const aspect = W / H;
  const { opts, short } = sceneFanOpts(W, H, view);
  let top = Infinity;
  for (let i = 0; i < 13; i++) {
    const t = handFan(aspect, 13, i, 0, 0, opts, 0, H);
    top = Math.min(top, ...cardScreenQuad(aspect, t, W, H, 0, short, view).map((p) => p.y));
  }
  return top;
}

/** Extract the vh fallback of the panel-open .me anchor for one orientation family. */
function fallbackVh(selector: string): number {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${esc} \\{ bottom: var\\(--hand-clear, calc\\((\\d+(?:\\.\\d+)?)vh`));
  if (!m) throw new Error(`panel-open anchor rule not found: ${selector}`);
  return Number(m[1]);
}

const PORTRAIT_PHONES: [number, number][] = [[360, 740], [390, 844], [393, 852], [412, 915], [430, 932]];
const LANDSCAPE_PHONES: [number, number][] = [[740, 360], [844, 390], [915, 412], [932, 430]];
const VIEWS = ['standing', 'sitting'] as const;

describe('bid panel never covers the fan, even unmeasured', () => {
  it('portrait: the panel-open fallback clears the fan top at every phone size, both views', () => {
    const vh = fallbackVh('.table-screen:not(.short) .me:has(> .bid-panel)');
    for (const [W, H] of PORTRAIT_PHONES) {
      for (const view of VIEWS) {
        const needPx = H - fanTop(W, H, view) + 6; // --hand-clear's own formula
        const fallbackPx = (vh / 100) * H;
        expect(fallbackPx, `${W}x${H} ${view}: fallback ${fallbackPx.toFixed(0)}px must clear the fan (needs ${needPx.toFixed(0)}px)`).toBeGreaterThanOrEqual(needPx - 1);
      }
    }
  });

  it('landscape: the panel-open fallback clears the fan top at every phone size, both views', () => {
    const vh = fallbackVh('.table-screen.short .me:has(> .bid-panel)');
    for (const [W, H] of LANDSCAPE_PHONES) {
      for (const view of VIEWS) {
        const needPx = H - fanTop(W, H, view) + 6;
        const fallbackPx = (vh / 100) * H;
        expect(fallbackPx, `${W}x${H} ${view}: fallback ${fallbackPx.toFixed(0)}px must clear the fan (needs ${needPx.toFixed(0)}px)`).toBeGreaterThanOrEqual(needPx - 1);
      }
    }
  });

  it('the no-panel landscape anchor keeps its low rest position (only the panel-open state rises)', () => {
    // .me without a bid panel (the plate row during play) must not inherit the
    // panel-open fallback: the plain short rule still falls back to 27vh.
    expect(css).toContain('.table-screen.short .me { bottom: var(--hand-clear, calc(27vh + env(safe-area-inset-bottom))); }');
  });
});

describe('the hand measurement covers every hand the table can show', () => {
  it('Table measures the 3D layout publish and the DOM felt hand, clearing the higher one', () => {
    expect(table).toContain("el.style.setProperty('--hand-clear'");
    expect(table).toContain('__bwmLayout');
    // The felt hand publishes nothing to __bwmLayout; without this DOM read the
    // panel anchor has no measurement at all whenever the flat fan is on screen.
    expect(table).toContain("querySelector<HTMLElement>('.felt-hand')");
    expect(table).toContain('Math.min(top, r.top)');
  });

  it('the measurement runs in both panel phases (bidding and exchange)', () => {
    expect(table).toContain("st.phase === 'bidding' || st.phase === 'exchange'");
  });

  it('the stale flat fan never anchors while the 3D hand is live (hand-3d guard)', () => {
    // CSS only HIDES the felt hand under .hand-3d (visibility), so its box still
    // measures; without the guard its lower landscape box would drag the panel
    // anchor up and clip the panel off the top of the screen.
    expect(table).toContain("classList.contains('hand-3d')");
  });
});

describe('the flat hand leaves the panel room in landscape', () => {
  // With the bid panel open, the flat fan drops to a 12px anchor (styles.css,
  // max-height:560px band); its container height is the card height + 36px of
  // rotation headroom. The panel needs its ~120px floor under the ~60px
  // scorebug band, plus the 6px hand-clear gap: felt top >= 186px.
  it('the panel-open landscape anchor drops the flat fan to 12px', () => {
    expect(css).toContain('.table-screen.short:has(.me > .bid-panel) .felt-hand { bottom: calc(12px + env(safe-area-inset-bottom)); }');
  });

  for (const [W, H] of LANDSCAPE_PHONES) {
    it(`${W}x${H}: capped felt fan top leaves room for the full bid panel`, () => {
      const box = feltCardBox(13, W, H);
      expect(box.height).toBeLessThanOrEqual(Math.floor(H * FELT_MAX_HEIGHT_FRAC));
      const feltTop = H - 12 - (box.height + 36);
      expect(feltTop, `felt top ${feltTop.toFixed(0)}px must leave >= 186px for scorebug + panel`).toBeGreaterThanOrEqual(186);
    });
  }

  it('portrait felt cards are untouched by the height cap', () => {
    const capped = feltCardBox(13, 390, 844);
    const plain = feltCardBox(13, 390);
    expect(capped).toEqual(plain);
  });
});
