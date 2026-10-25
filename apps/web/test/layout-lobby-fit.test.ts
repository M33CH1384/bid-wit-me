import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Online lobby fit (design audit 2026-10-24, defect D2 — the owner's
 * 844×390 specimen, quantified against production in lobby-prod.md:
 * 505 P0 across 72 combos). Root mechanism: a ~916px non-scrolling column
 * ordered venue → settings → title/code → seats, painted over by a fixed
 * 222px dock of stacked full-width rows — seats off-canvas in landscape,
 * the venue select under the dock in portrait, a seat's Sit-here area
 * crushed to 3×54px in the partnership room.
 *
 * Lobby v8 (online.css) fixes the composition around the v7 seat stage
 * (whose own pins live in seat-fit.test.ts and are NOT weakened here):
 *  (1) the dock is a compact bar — meta row (teams + status) and action
 *      row (START/waiting beside LEAVE) wrap inside the start block,
 *      above a 44px media bar; its worst-case height is modelled below
 *      and must stay under the --dock-h reserve the stage subtracts;
 *  (2) the head is one row (title + code ticket), freeing ~70px of stage;
 *  (3) phone landscape is a stage: a clamp()-wide rail (head over
 *      venue/settings, scrolling inside its own box) beside a one-row
 *      strip felt, with the dock as a two-column grid.
 * These tests recompute every budget from the shipped CSS constants, in
 * the house idiom, for all 11 audit sizes × the worst states
 * (partnership host — team chips + badges + status present — unless a
 * state is noted). Rendered verification is the coordinator's prod sweep.
 */
const css = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('../src/online/Lobby.tsx', import.meta.url), 'utf8');

const v7 = css.slice(css.indexOf('lobby v7'));
const stage = v7.slice(0, v7.indexOf('/* very short screens'));
const compact = v7.slice(v7.indexOf('/* very short screens'), v7.indexOf('/* landscape phones'));
const v8 = css.slice(css.indexOf('lobby v8'));
const v8tap = v8.slice(0, v8.indexOf('@media (max-width: 1023px)'));
const v8A = v8.slice(v8.indexOf('@media (max-width: 1023px)'), v8.indexOf('/* (3) phone landscape stage'));
const v8B = v8.slice(v8.indexOf('/* (3) phone landscape stage'));

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};
const clamp3 = (re: RegExp, s: string): [number, number, number] => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return [parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!)];
};
const clampAt = (t: [number, number, number], unit: number) => Math.min(t[2], Math.max(t[0], t[1] * unit));

/** Constants parsed from the shipped v8 rules. */
const K = {
  dockFallback: num(/var\(--dock-h, calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)\)/, stage),
  dockPadY: num(/\.lobby-dock \{ padding: (\d+)px 12px/, v8A) * 2,
  startRowGap: num(/\.lobby-dock \.lobby-start \{[^}]*gap: (\d+)px 8px/, v8A),
  startActionH: num(/\.lobby-dock \.lobby-start > \.primary\.big \{[^}]*min-height: (\d+)px/, v8A),
  leaveH: num(/\.lobby-dock \.leave-table-btn \{[^}]*min-height: (\d+)px/, v8A),
  barMarginTop: num(/\.dock-bar \{[^}]*margin: (\d+)px auto 0/, v8A),
  barH: num(/\.dock-bar \.av-btn, \.dock-spacer \{ height: (\d+)px;/, v8A),
  headMargin: num(/\.lobby-v3 \.lobby-head \{[^}]*margin-bottom: (\d+)px/, v8A),
  cardMaxH: num(/\.seat-card \{ max-height: (\d+)px; \}/, v8A),
  botStripH: num(/\.seat-bot \{[^}]*height: (\d+)px/, v8A),
  hitPadBottom: num(/\.seat-hit \{ padding-bottom: (\d+)px; \}/, v8A),
  panelPad: num(/\.lobby-table \{ padding: (\d+)px; \}/, css) * 2,
  feltBorder: num(/\.mini-felt \{\s*border: (\d+)px solid transparent;/, css) * 2,
  feltPadY: num(/\.mini-felt \{[^}]*padding: (\d+)px \d+px;/, stage) * 2,
  feltPadYCompact: num(/\.mini-felt \{ padding: (\d+)px \d+px;/, compact) * 2,
  feltPadYB: num(/\.mini-felt \{[^}]*padding: (\d+)px 14px;/, v8B) * 2,
  rowGap: num(/\.mini-felt \{[^}]*gap: (\d+)px \d+px;/, stage) * 2,
  rowGapCompact: num(/\.mini-felt \{ padding: \d+px \d+px; gap: (\d+)px \d+px; \}/, compact) * 2,
  railMin: num(/grid-template-columns: clamp\((\d+)px,/, v8B),
  railVw: num(/grid-template-columns: clamp\(\d+px, ([\d.]+)vw,/, v8B),
  railMax: num(/grid-template-columns: clamp\(\d+px, [\d.]+vw, (\d+)px\)/, v8B),
  dockPadYB: num(/\.lobby-dock \{[^}]*padding: (\d+)px 12px/, v8B) * 2,
  barBtnW: num(/\.dock-bar \.av-btn \{ flex: 0 0 (\d+)px; \}/, v8B),
};
/** v7 seat-stack constants (shared with seat-fit.test.ts's model). */
const labelZone = clamp3(/\.seat-top \{[^}]*height: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, stage);
const hitPadTop = clamp3(/\.seat-hit \{[^}]*padding: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, stage);
const emptyRingF = num(/\.seat-ring\.empty \{ width: min\(52px, ([\d.]+)cqh\)/, stage);
const emptyRingFC = num(/\.seat-ring\.empty \{ width: min\(52px, ([\d.]+)cqh\)/, compact);
const compactZone = num(/\.seat-top \{ height: (\d+)px; \}/, compact);
const compactHitPadTop = num(/\.seat-hit \{ gap: 0; padding-top: (\d+)px; \}/, compact);
const emptyRingFB = num(/\.seat-ring\.empty \{ width: min\(44px, ([\d.]+)cqh\)/, v8B);

/** Model constants (the seat-fit idiom: measured head/dock models, kept
 * honest by the structural pins below — if the markup's rows change,
 * these are the numbers to re-measure). */
const HEAD_A = 72; // head row: share ticket (≤64) + margin, screens >719 tall
const HEAD_A_COMPACT = 61; // after the ≤719px head trims
const HEAD_B = 87; // rail head: title 24 + gap 10 + share ticket 53
const META_TALL = 47; // status wrapped to 3 lines (13px font), ≤430px wide
const META_COMPACT = 45; // status wrapped to 3 lines (12px font), ≤719 tall
const META_LINE = 17; // status on one line (tablet portrait)
const META_B = 30; // landscape start column: status wrapped to 2 lines
const VENUE_PANEL = 130; // title + 44px select + 3-line blurb + panel padding
const VENUE_REACH = 76; // title + select + padding: reachable with no scroll
const LABEL_MIN = 46; // "SEAT 1" at the 9px floor font (~23px ink + 5px tracking) + team chip 14 + gap 4

/**
 * Worst-state dock height (partnership host, seated): padding + meta row
 * + row gap + action row + bar margin + media bar (+ safe-area bottom).
 * The action row is START (48) beside LEAVE (48) — never two stacked rows.
 */
function dockA(h: number, w: number, sbot: number) {
  const meta = h <= 719 ? META_COMPACT : w <= 430 ? META_TALL : META_LINE;
  return K.dockPadY + sbot + meta + K.startRowGap + Math.max(K.startActionH, K.leaveH) + K.barMarginTop + K.barH;
}
/** Landscape dock: padding + (meta + gap + action row) beside the bar. */
function dockB(sbot: number) {
  return K.dockPadYB + sbot + META_B + K.startRowGap + K.startActionH;
}

const PORTRAIT = [
  { name: '375×667', w: 375, h: 667, sat: 20, sbot: 0 },
  { name: '390×844', w: 390, h: 844, sat: 47, sbot: 34 },
  { name: '430×932', w: 430, h: 932, sat: 59, sbot: 34 },
  { name: '768×1024', w: 768, h: 1024, sat: 24, sbot: 0 },
] as const;
const LANDSCAPE = [
  { name: '667×375', w: 667, h: 375, sat: 0, sbot: 0 },
  { name: '844×390', w: 844, h: 390, sat: 0, sbot: 21 },
  { name: '932×430', w: 932, h: 430, sat: 0, sbot: 21 },
] as const;
const WIDE = ['1024×768', '1180×820', '1440×900', '1920×1080'] as const;

/** Portrait geometry: v7 stage with the v8 head row + compact dock. */
function portraitFit(s: (typeof PORTRAIT)[number]) {
  const isCompact = s.h <= 719;
  const top = (isCompact ? 58 : 64) + s.sat;
  const dock = dockA(s.h, s.w, s.sbot);
  const stageH = s.h - top - dock;
  const head = isCompact ? HEAD_A_COMPACT : HEAD_A;
  const feltH = stageH - head - K.panelPad;
  const padY = isCompact ? K.feltPadYCompact : K.feltPadY;
  const gap = isCompact ? K.rowGapCompact : K.rowGap;
  const rowH = (feltH - K.feltBorder - padY - gap) / 3;
  const cqh = (feltH - K.feltBorder - padY) / 100;
  const zone = isCompact ? compactZone : clampAt(labelZone, cqh);
  const plateEmptyH = (isCompact ? 9 : clampAt([9.5, 3, 12], cqh)) * 1.15 + (isCompact ? 0 : 2 * Math.min(1, 0.3 * cqh));
  const openStack =
    (isCompact ? compactHitPadTop : clampAt(hitPadTop, cqh)) +
    zone +
    Math.min(52, (isCompact ? emptyRingFC : emptyRingF) * cqh) +
    plateEmptyH +
    K.hitPadBottom;
  const contentW = Math.min(s.w, 560) - 32;
  const feltInnerW = contentW - K.panelPad - K.feltBorder - (isCompact ? 28 : 40);
  const cardW = Math.min((feltInnerW - 2 * 6) / 3, 104);
  return { dock, stageH, feltH, rowH, cqh, openStack, cardH: Math.min(rowH, K.cardMaxH), cardW, dockTop: s.h - dock, panelBottom: top + stageH };
}

/** Landscape geometry: rail + strip felt + two-column dock. */
function landscapeFit(s: (typeof LANDSCAPE)[number]) {
  const dock = dockB(s.sbot);
  const stageH = s.h - (58 + s.sat) - dock;
  const feltH = stageH - K.panelPad;
  const rowH = feltH - K.feltBorder - K.feltPadYB;
  const cqh = (feltH - K.feltBorder - K.feltPadYB) / 100;
  const openStack =
    clampAt(hitPadTop, cqh) +
    compactZone +
    Math.min(44, emptyRingFB * cqh) +
    9 * 1.15 +
    K.hitPadBottom;
  const contentW = Math.min(s.w, 900) - 32;
  const rail = Math.min(K.railMax, Math.max(K.railMin, (K.railVw / 100) * s.w));
  const feltW = contentW - rail - 12;
  const cardW = Math.min((feltW - K.panelPad - K.feltBorder - 28 - 4 * 8) / 5, 104);
  const settingsH = stageH - HEAD_B - 8;
  return { dock, stageH, feltH, rowH, openStack, cardH: Math.min(rowH, K.cardMaxH), cardW, rail, settingsH, dockTop: s.h - dock, colsBottom: 58 + s.sat + stageH };
}

describe('lobby v8 structure', () => {
  it('the dock is two wrapped rows + a bar, never a stack of full-width rows', () => {
    expect(v8A).toContain('.lobby-dock .lobby-start { display: flex; flex-wrap: wrap;');
    expect(v8A).toContain('.lobby-dock .leave-table-btn { order: 4;');
    expect(v8A).toContain('.lobby-dock .exit-divider { display: none; }');
    // the markup is untouched: divider, portal and dock testids all still ship
    expect(lobby).toContain('className="exit-divider"');
    expect(lobby).toContain('data-testid="lobby-dock"');
    expect(lobby).toContain('createPortal');
  });

  it('the head is one row on non-wide screens', () => {
    expect(v8A).toContain('.lobby-v3 .lobby-head { display: flex; flex-wrap: wrap;');
    expect(v8A).toContain('.lobby-v3 .lobby-share { flex: 1 1 auto;');
  });

  it('landscape is a stage: rail + strip felt + grid dock', () => {
    expect(v8B).toContain('grid-template-areas: "head table" "settings table"');
    expect(v8B).toContain('.lobby-main { display: contents; }');
    expect(v8B).toContain('grid-template-areas: "left top center right bottom"');
    expect(v8B).toContain('.mini-felt.n3 { grid-template-areas: "left center right bottom ."; }');
    expect(v8B).toContain('.lobby-settings { grid-area: settings; min-height: 0; overflow-y: auto;');
    expect(v8B).toContain('.lobby-dock { display: grid; grid-template-columns: minmax(0, 1fr) auto;');
    // the seat diamond itself is untouched outside landscape
    expect(css).toContain('grid-template-areas: ". top ." "left center right" ". bottom ."');
  });

  it('the wide layout is untouched (desktop PASSes today and must not regress)', () => {
    expect(css).toContain('.lobby-cols { height: 100%; display: grid; grid-template-columns: minmax(420px, 1.25fr) minmax(320px, 1fr) minmax(300px, 360px); gap: 16px; }');
    // every .lobby-dock rule in v8 lives inside the non-wide (A) or landscape (B) gates
    expect(v8tap).not.toContain('.lobby-dock');
    expect(WIDE).toHaveLength(4);
    // no theme selectors in v8: geometry is theme-identical, Neon is color/glass only
    expect(v8).not.toContain('data-theme');
    expect(v8).not.toContain('html[');
  });

  it('Find a Table is not styled from online.css (its chips live in social.css — flagged for the coordinator, not re-fixed here)', () => {
    expect(css).not.toContain('.ot-filters');
    expect(css).not.toContain('.ot-acts');
  });
});

describe('the dock reserves its space and stays a bar (D2 root mechanism)', () => {
  it('the fallback reserve covers the modelled worst-case dock at every size', () => {
    for (const s of [...PORTRAIT]) {
      expect(dockA(s.h, s.w, s.sbot), s.name).toBeLessThanOrEqual(K.dockFallback + s.sbot);
    }
    for (const s of [...LANDSCAPE]) {
      expect(dockB(s.sbot), s.name).toBeLessThanOrEqual(K.dockFallback + s.sbot);
    }
    // and Lobby still publishes the live height over the fallback
    expect(lobby).toContain("root.style.setProperty('--dock-h'");
  });

  it('the dock is a fraction of the screen it used to swallow (was 222px = 57% at 844×390)', () => {
    for (const s of [...PORTRAIT]) expect(dockA(s.h, s.w, s.sbot) / s.h, s.name).toBeLessThanOrEqual(0.26);
    for (const s of [...LANDSCAPE]) expect(dockB(s.sbot) / s.h, s.name).toBeLessThanOrEqual(0.3);
    expect(dockB(21)).toBeLessThanOrEqual(120);
  });

  it('the stage ends exactly where the dock begins — nothing under the dock, at every non-wide size', () => {
    for (const s of [...PORTRAIT]) {
      const f = portraitFit(s);
      expect(f.panelBottom, s.name).toBe(f.dockTop);
      expect(f.stageH, s.name).toBeGreaterThan(0);
    }
    for (const s of [...LANDSCAPE]) {
      const f = landscapeFit(s);
      expect(f.colsBottom, s.name).toBe(f.dockTop);
      expect(f.stageH, s.name).toBeGreaterThan(0);
    }
  });
});

describe('portrait budgets close (worst state: partnership host)', () => {
  it('the felt is a real table and every seat row clears the tap floor', () => {
    for (const s of [...PORTRAIT]) {
      const f = portraitFit(s);
      expect(f.feltH, s.name).toBeGreaterThanOrEqual(190);
      expect(f.rowH, s.name).toBeGreaterThanOrEqual(48);
      // the 3×54px crush is impossible: equal minmax(0,1fr) columns, modelled ≥76px wide
      expect(f.cardW, s.name).toBeGreaterThanOrEqual(76);
      // SEAT # label zone + team chip fit the card's inner width
      expect(f.cardW - 8, s.name).toBeGreaterThanOrEqual(LABEL_MIN);
    }
  });

  it('the tallest stack (open card + 44px + BOT strip) closes inside its card', () => {
    for (const s of [...PORTRAIT]) {
      const f = portraitFit(s);
      // +3: the house tolerance from seat-fit (fallback-vs-live dock slack)
      expect(f.openStack, s.name).toBeLessThanOrEqual(f.cardH + 3);
      // the strip and the hit area's reserve are the same 44px by construction
      expect(K.botStripH).toBe(44);
      expect(K.hitPadBottom).toBe(K.botStripH);
    }
  });

  it('the venue select is never under the dock: settings flow below a stage that ends at the dock', () => {
    // the stage (head + seats) ends at the dock top (pinned above); the
    // settings column follows it in page flow and .lobby-v3 reserves
    // --dock-h + 6px of bottom padding, so the venue panel scrolls clear
    expect(stage).toContain('padding-bottom: calc(var(--dock-h, calc(200px + env(safe-area-inset-bottom))) + 6px)');
    expect(num(/\.lobby-venue-panel \.venue-pick select \{[^}]*min-height: (\d+)px/, styles)).toBe(44);
  });
});

describe('landscape budgets close (worst state: partnership host)', () => {
  it('the strip felt closes its seat stacks in one row', () => {
    for (const s of [...LANDSCAPE]) {
      const f = landscapeFit(s);
      expect(f.feltH, s.name).toBeGreaterThanOrEqual(180);
      expect(f.openStack, s.name).toBeLessThanOrEqual(f.cardH + 3);
      expect(f.cardW, s.name).toBeGreaterThanOrEqual(60);
      expect(f.cardW - 8, s.name).toBeGreaterThanOrEqual(LABEL_MIN);
    }
  });

  it('the rail holds the head, and the venue select is reachable with no scroll at all', () => {
    for (const s of [...LANDSCAPE]) {
      const f = landscapeFit(s);
      expect(f.settingsH, s.name).toBeGreaterThanOrEqual(VENUE_REACH);
      // the full venue panel is at most a short deliberate scroll inside its own box
      expect(VENUE_PANEL - f.settingsH, s.name).toBeLessThanOrEqual(24);
      expect(f.rail, s.name).toBeGreaterThanOrEqual(K.railMin);
    }
  });

  it('the media bar is three honest buttons wide (CAM · MIC · CHAT at 64px)', () => {
    expect(K.barBtnW).toBeGreaterThanOrEqual(44);
    expect(num(/\.dock-spacer \{ flex: 0 0 (\d+)px; \}/, v8B)).toBe(2 * K.barBtnW + 8);
  });
});

describe('tap floor — the online.css census (D4)', () => {
  const floor = (re: RegExp, s: string, label: string) => expect(num(re, s), label).toBeGreaterThanOrEqual(44);
  it('every census control in online.css reaches 44px', () => {
    floor(/\.seat-bot \{[^}]*height: (\d+)px/, v8A, '+ BOT strip');
    floor(/\.seat-card \.seat-sub \{ min-height: (\d+)px/, v8A, 'seat sub-actions');
    floor(/\.lc-close \{ width: (\d+)px/, v8A, 'chat drawer close width');
    floor(/\.lc-close \{[^}]*height: (\d+)px/, v8A, 'chat drawer close');
    floor(/\.sr-timer select \{ min-height: (\d+)px/, v8tap, 'timer select');
    floor(/\.lobby-chat \.chat-input input \{ min-height: (\d+)px/, v8tap, 'chat input');
    floor(/\.lobby-chat \.chat-input button \{ min-width: (\d+)px/, v8tap, 'chat send width');
    floor(/\.lobby-chat \.chat-input button \{[^}]*min-height: (\d+)px/, v8tap, 'chat send');
    floor(/\.media-toast \.mt-x \{ width: (\d+)px/, v8tap, 'media toast close width');
    floor(/\.media-toast \.mt-x \{[^}]*height: (\d+)px/, v8tap, 'media toast close');
    floor(/\.spec-chip \{ height: (\d+)px/, v8tap, 'spectator chip');
    floor(/\.vb-menu button \{ min-height: (\d+)px/, v8tap, 'bubble menu rows');
    floor(/\.team-pill \.pencil \{ min-width: (\d+)px/, v8tap, 'team pencil width');
    floor(/\.team-pill \.pencil \{[^}]*min-height: (\d+)px/, v8tap, 'team pencil');
    floor(/\.team-pill \.team-name-edit input \{ min-height: (\d+)px/, v8tap, 'team name input');
    floor(/\.team-pill \.team-name-edit button \{ min-height: (\d+)px/, v8tap, 'team name save');
    floor(/\.lobby-social \{ min-width: (\d+)px/, v8tap, 'lobby Social width');
    floor(/\.lobby-social \{[^}]*min-height: (\d+)px/, v8tap, 'lobby Social');
    floor(/\.share-code \{ min-height: (\d+)px/, v8tap, 'code ticket');
    // the dock's own controls clear the floor with room to spare
    expect(K.startActionH, 'START').toBeGreaterThanOrEqual(48);
    expect(K.leaveH, 'LEAVE').toBeGreaterThanOrEqual(48);
    expect(K.barH, 'CAM/MIC/CHAT bar').toBe(44);
  });
});
