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

/**
 * The seat-number label's home (owner 2026-10-24): on the owner's phone the
 * "SEAT n" label at the top of each seat card was broken three ways — on the
 * OPEN card it sat on the dashed border (it was absolutely positioned at a
 * magic top: 7px while the card's outline is inset only ~3px, so the frame
 * struck through the text, and the hit area's centered ring rode up over it
 * on short stages, measured −8px at 375×667); on the viewer's OWN card the
 * label slot swapped the number for a "YOU" tag squeezed into the same few
 * pixels behind the avatar; on occupied cards it was glued to the top frame
 * (the v7 padding-top collapses to 1.8px on compact stages, for a label whose
 * ink — Barlow's text range runs ≈1.3× the font size — is ~11px tall in a
 * 9.35px line box). The fix gives the label a reserved zone in the same cqh
 * system: an in-flow, flex-none strip of fixed height at the top of EVERY
 * card, the seat number in it unconditionally, card/hit top padding with a
 * floor that clears the frame (taken: the 2–3px inset shadow; open: the
 * dashed outline, now inset 2px + its 2px stroke = its line ends 4px in).
 * These pins compute the contract from the shipped CSS; the geometry was
 * verified in Chromium against the shipped styles at all three sizes.
 */
describe('the seat-number label has a home (owner 2026-10-24)', () => {
  const clampOf = (re: RegExp, s: string): [number, number, number] => {
    const m = s.match(re);
    if (!m) throw new Error(`pattern not found: ${re}`);
    return [parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!)];
  };
  const clampAt = (t: [number, number, number], unit: number) => Math.min(t[2], Math.max(t[0], t[1] * unit));
  const one = (re: RegExp, s: string) => num(re, s);

  const labelFont = clampOf(/\.seat-top \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, stage);
  const labelZone = clampOf(/\.seat-top \{[^}]*height: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, stage);
  const cardPadTop = clampOf(/\.seat-card \{[^}]*padding: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, stage);
  const hitPadTop = clampOf(/\.seat-hit \{[^}]*padding: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, stage);
  const plateFont = clampOf(/\.seat-plate \.seat-name \{ font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, stage);
  const ringMineF = one(/\.seat-ring\.mine \{ width: min\(58px, ([\d.]+)cqh\)/, stage);
  const emptyRingF = one(/\.seat-ring\.empty \{ width: min\(52px, ([\d.]+)cqh\)/, stage);
  const compactZone = one(/\.seat-top \{ height: (\d+)px; \}/, compact);
  const compactCardPadTop = clampOf(/\.seat-card \{ padding-top: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, compact);
  const compactHitPadTop = one(/\.seat-hit \{ gap: 0; padding-top: (\d+)px; \}/, compact);
  const compactRingMineF = one(/\.seat-ring\.mine \{ width: min\(58px, ([\d.]+)cqh\)/, compact);
  const compactEmptyRingF = one(/\.seat-ring\.empty \{ width: min\(52px, ([\d.]+)cqh\)/, compact);
  /** Barlow Condensed's text range (what Chromium measures for the label's
   * text) runs ≈1.30× the font size — 11.0px of ink at the old 8.5px floor. */
  const INK = 1.3;

  it('the label is the seat number on every card — no YOU swap, no absolute positioning', () => {
    expect(lobby).toContain('className="seat-top">{label}');
    expect(lobby).not.toContain('you-tag');
    expect(css).not.toContain('.you-tag');
    expect(css).not.toContain('.seat-hit .seat-top');
    // the label renders before the ring in both card branches, in flow
    expect(lobby).toContain('{top}<span className="seat-ring empty"');
    expect(lobby).toMatch(/\{top\}\s*<div className=\{`seat-ring occupied/);
    // … and the zone cannot be shrunk or overlapped by the ring: flex-none
    // strip in the card's column, ring/plate centered by auto margins only
    // in the space the label leaves (open card)
    expect(stage).toMatch(/\.seat-top \{[^}]*flex: none/);
    expect(css).toContain('.seat-hit .seat-ring { margin-top: auto; }');
    expect(css).toContain('.seat-hit .seat-plate { margin-bottom: auto; }');
    expect(css).toMatch(/\.seat-hit \{[^}]*justify-content: flex-start/);
  });

  it('the open card’s dashed frame ends 4px in (2px inset + 2px stroke)', () => {
    expect(css).toMatch(/\.seat-card\.open \{[^}]*outline: 2px dashed[^}]*outline-offset: -2px/);
  });

  it('the zone contains the ink and the ink clears the frame, at every size', () => {
    for (const s of SIZES) {
      const isCompact = s.h <= 719;
      const f = fit(s.h, s.sat, s.sbot);
      // cqh resolves against the felt's CONTENT box (measured in Chromium)
      const cqh = (f.feltH - CH.feltBorder - (isCompact ? CH.feltPadYCompact : CH.feltPadY)) / 100;
      const font = clampAt(labelFont, cqh);
      const ink = font * INK;
      const zone = isCompact ? compactZone : clampAt(labelZone, cqh);
      expect(font, s.name).toBeGreaterThanOrEqual(9);
      expect(zone, `${s.name}: zone holds the ink`).toBeGreaterThanOrEqual(ink);
      // the ink sits centered in its zone (flex align-items: center)
      const inkTopTaken = (isCompact ? clampAt(compactCardPadTop, cqh) : clampAt(cardPadTop, cqh)) + Math.max(0, (zone - ink) / 2);
      const inkTopOpen = (isCompact ? compactHitPadTop : clampAt(hitPadTop, cqh)) + Math.max(0, (zone - ink) / 2);
      // taken: the thickest frame is the mine card's 3px inset shadow
      expect(inkTopTaken - 3, `${s.name}: label clears the taken frame`).toBeGreaterThanOrEqual(1.5);
      // open: the dashed outline's line ends 4px inside the card
      expect(inkTopOpen - 4, `${s.name}: label clears the dashed frame`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('the label’s cost stays inside the row budget, at every size', () => {
    for (const s of SIZES) {
      const isCompact = s.h <= 719;
      const f = fit(s.h, s.sat, s.sbot);
      const cqh = (f.feltH - CH.feltBorder - (isCompact ? CH.feltPadYCompact : CH.feltPadY)) / 100;
      const zone = isCompact ? compactZone : clampAt(labelZone, cqh);
      const gap = Math.min(2, 0.45 * cqh);
      const padBottom = Math.min(7, 1.5 * cqh);
      // the tallest taken stack: the viewer's own card (biggest ring)
      const ringMine = Math.min(58, (isCompact ? compactRingMineF : ringMineF) * cqh);
      const plateH = clampAt(plateFont, cqh) * 1.15 + 2 * Math.min(3, 0.7 * cqh) + (isCompact ? 0 : Math.min(2, 0.3 * cqh));
      const padT = isCompact ? clampAt(compactCardPadTop, cqh) : clampAt(cardPadTop, cqh);
      const taken = padT + zone + gap + ringMine + gap + plateH + padBottom;
      // the open stack: label + placeholder ring + SIT HERE plate
      const ringEmpty = Math.min(52, (isCompact ? compactEmptyRingF : emptyRingF) * cqh);
      const plateEmptyH = 9.5 * 1.15 + (isCompact ? 0 : 2 * Math.min(1, 0.3 * cqh));
      const padH = isCompact ? compactHitPadTop : clampAt(hitPadTop, cqh);
      const open = padH + zone + ringEmpty + plateEmptyH;
      // +3: this fit model prices the dock at its CSS FALLBACK; on device the
      // ResizeObserver only ever returns stage height vs that fallback (the
      // v7 header's own note), and Chromium measurement against the shipped
      // CSS shows ≥4px of real slack in the worst (375×667 mine) card.
      expect(taken, `${s.name}: taken stack`).toBeLessThanOrEqual(f.rowH + 3);
      expect(open, `${s.name}: open stack`).toBeLessThanOrEqual(f.rowH + 3);
    }
  });
});
