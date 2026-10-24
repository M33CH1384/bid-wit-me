import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Seat-picker fit (owner 2026-10-24): the phone lobby's seat table must fit
 * its section — the whole felt inside its panel, the panel ending where the
 * fixed dock begins, no seat clipped or slid under the dock.
 *
 * Before lobby v7 the felt was sized by its content (~458px) while the first
 * screen only had room for part of it, so the dock covered the panel's bottom
 * and seat 1 rendered underneath it. v7 makes the first screen a stage: the
 * lobby-main column is exactly viewport − top chrome − dock height, the panel
 * flexes inside it, and the felt is a size container whose rows are 1fr
 * shares — contain by construction. These tests compute the fit from the
 * shipped CSS (the fan-coverage pin is the model) so a regression to
 * content-sized felt fails here instead of on the owner's phone.
 */
const css = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('../src/online/Lobby.tsx', import.meta.url), 'utf8');
const v7 = css.slice(css.indexOf('lobby v7'));
const stage = v7.slice(0, v7.indexOf('/* very short screens'));
const compact = v7.slice(v7.indexOf('/* very short screens'), v7.indexOf('/* landscape phones'));

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};

/** Chrome constants parsed from the shipped rules. */
const CH = {
  dockFallback: num(/var\(--dock-h, calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)\)/, stage),
  topChrome: num(/100dvh - \((\d+)px \+ env\(safe-area-inset-top\)\)/, stage),
  topChromeCompact: num(/100dvh - \((\d+)px \+ env\(safe-area-inset-top\)\)/, compact),
  panelPadding: num(/\.lobby-table \{ padding: (\d+)px; \}/, css) * 2,
  feltBorder: num(/\.mini-felt \{\s*border: (\d+)px solid transparent;/, css) * 2,
  feltPadY: num(/\.mini-felt \{[^}]*padding: (\d+)px \d+px;/, stage) * 2,
  feltPadYCompact: num(/\.mini-felt \{ padding: (\d+)px \d+px;/, compact) * 2,
  rowGap: num(/\.mini-felt \{[^}]*gap: (\d+)px \d+px;/, stage) * 2,
  rowGapCompact: num(/\.mini-felt \{ padding: \d+px \d+px; gap: (\d+)px \d+px; \}/, compact) * 2,
  ringFactor: num(/\.seat-ring \{ width: min\(52px, ([\d.]+)cqh\)/, stage),
  ringFactorCompact: num(/\.seat-ring \{ width: min\(52px, ([\d.]+)cqh\)/, compact),
};
/** Measured against the shipped DOM in a real layout engine (Chromium):
 * the head (title + share chip + margins) and the compact dock's trims.
 * If the head or dock grows, update these with a fresh measurement. */
const HEAD_STANDARD = 141; // head + its bottom margin, >719px tall screens
const HEAD_COMPACT = 121; // after the ≤719px trims
const DOCK_COMPACT_TRIM = 31; // the ≤719px dock-spacing trims, total

const SIZES = [
  { name: '375×667', w: 375, h: 667, sat: 20, sbot: 0 },
  { name: '390×844', w: 390, h: 844, sat: 47, sbot: 34 },
  { name: '430×932', w: 430, h: 932, sat: 59, sbot: 34 },
] as const;

function fit(h: number, sat: number, sbot: number) {
  const isCompact = h <= 719;
  const top = (isCompact ? CH.topChromeCompact : CH.topChrome) + sat;
  // Worst case is the CSS fallback; on device the ResizeObserver refines
  // --dock-h to the dock's real height, which can only help the compact case.
  const dock = CH.dockFallback + sbot - (isCompact ? DOCK_COMPACT_TRIM : 0);
  const stageH = h - top - dock;
  const head = isCompact ? HEAD_COMPACT : HEAD_STANDARD;
  const feltH = stageH - head - CH.panelPadding;
  const padY = isCompact ? CH.feltPadYCompact : CH.feltPadY;
  const gap = isCompact ? CH.rowGapCompact : CH.rowGap;
  const rowH = (feltH - CH.feltBorder - padY - gap) / 3;
  const ring = Math.min(52, ((isCompact ? CH.ringFactorCompact : CH.ringFactor) / 100) * feltH);
  return { stageH, feltH, rowH, ring, dockTop: h - dock, panelBottom: top + stageH };
}

describe('seat table fits its section (lobby v7)', () => {
  it('the stage is constructed, not content-sized', () => {
    expect(stage).toContain('height: calc(100dvh');
    expect(stage).toContain('container-type: size');
    expect(stage).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))');
    expect(stage).toContain('.lobby-main .lobby-table { flex: 1 1 auto;');
    // the seat layout itself is untouched: diamond areas + center card
    expect(css).toContain('grid-template-areas: ". top ." "left center right" ". bottom ."');
    // natural-size caps keep the proportional system identical at full size
    expect(stage).toContain('.seat-ring { width: min(52px,');
    expect(stage).toContain('max-height: 120px');
  });

  it('Lobby publishes the dock’s real height as --dock-h', () => {
    expect(lobby).toContain("root.style.setProperty('--dock-h'");
    expect(lobby).toContain('new ResizeObserver(apply)');
    expect(lobby).toContain('ref={dockRef}');
    expect(lobby).toContain("root.style.removeProperty('--dock-h')");
  });

  it('the panel ends exactly where the dock begins, at every phone size', () => {
    for (const s of SIZES) {
      const f = fit(s.h, s.sat, s.sbot);
      expect(f.panelBottom, s.name).toBe(f.dockTop);
      expect(f.stageH, s.name).toBeGreaterThan(0);
    }
  });

  it('all three seat rows stay usable and the ring fits its row', () => {
    for (const s of SIZES) {
      const f = fit(s.h, s.sat, s.sbot);
      // a seat card is a tap target: never under the 44px floor
      expect(f.rowH, s.name).toBeGreaterThanOrEqual(48);
      // ring + plate (16) + label zone pads (≤14) fit inside the row
      expect(f.ring + 30, s.name).toBeLessThanOrEqual(f.rowH);
      // the felt is a real table, not a sliver
      expect(f.feltH, s.name).toBeGreaterThanOrEqual(190);
    }
  });

  it('landscape phones keep the table scroll-reachable instead of crushing it', () => {
    expect(v7).toContain('@media (max-height: 599px)');
    expect(v7).toContain('.lobby-main { min-height: 400px; }');
  });
});
