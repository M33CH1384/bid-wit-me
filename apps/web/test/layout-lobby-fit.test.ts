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
 *
 * Lobby v8b (the 2026-10-25 prod re-sweep follow-up) repairs what v8's
 * static model missed — the re-sweep ran the LIVE build and measured:
 *  (1) THE DOCK BALLOON: v8's start-block rules were written as row-flex
 *      shares but never set flex-direction, and the shipped base
 *      .lobby-start is a COLUMN — so every flex-basis became a height
 *      (--dock-h measured 609px on prod; START 196×200; seats ~60×5
 *      slivers). v8b makes the direction explicit in v8A and re-derives
 *      every dock budget below in ROW terms; the cascade pin here fails
 *      if the v8 tier's effective direction is ever not row again.
 *  (2) THE WIDE + BOT pill rendered 47×19: the 44px strip lived only in
 *      the non-wide tier. It is now in the wide gate too, and the wide
 *      seat card grows 120 → 148px so the open stack still closes.
 *  (3) THE 1024–1279 WIDE TIER: main and chat share one column (rail
 *      areas "settings main" / "settings chat") and main's unscrolled
 *      tail (pencil, CAM/MIC, START) rect-collided with the chat input.
 *      The tier is now a budgeted stage: a definite 168px chat row with
 *      itemized internals, a one-row head, a strip felt, two-row start.
 *  (4) THE 768–899 STACK: settings sit in a grid row ABOVE main, so the
 *      v7 stage height (viewport − chrome − dock) over-ran the dock top
 *      by the settings row and the top seat met the dock's team pencil.
 *      The tier's cols are now height-bounded by the same calc and main
 *      flexes into its row — the stage ends at the dock top again.
 *  (5) THE NARROW-LANDSCAPE HEAD (v8c, re-sweep #2): at 667×375 only,
 *      the rail head's share row (code ticket + Social, ≈279px of
 *      content-sized floor at every landscape width) overruns the
 *      200px rail and Social paints 18–24px over the first seat's
 *      Sit-here area. A narrow-landscape sub-tier (≤800px wide, so
 *      844/932 are untouched) shrinks the ticket's code to the compact
 *      20px and trims both items' side padding; the row's floor drops
 *      to ≈182px ≤ the 190px rail floor. The pin below recomputes the
 *      row from the shipped constants — it fails on the pre-v8c CSS.
 *  (6) THE SETTINGS SELECTS AT REST (v8d, the audit's last lobby
 *      remainder — re-sweeps #2/#3: every remaining P0 was this one
 *      signature): in the page-flow composition the settings column
 *      starts 18px below a stage that ends at the dock's top edge, so
 *      at scroll 0 the venue and timer selects sit inside the dock's
 *      band (21–44px underlaps vs START / LEAVE / MIC / CHAT / the
 *      team pencil); in the landscape stage the settings box ends at
 *      the dock's top edge but its taller content's rects report
 *      their layout positions, and the timer select's rect crossed
 *      the box's bottom edge by 5–30px into the action row. The
 *      owner's call (2026-10-25) was to fix it anyway, accepting the
 *      flow hole the audit flagged: the page-flow settings column
 *      now starts one live dock-height below the stage's end (=
 *      exactly the viewport's bottom edge at scroll 0), and in the
 *      landscape stage the two settings panels stop stacking and
 *      sit in a two-column grid, each stretched to the box's height
 *      and scrolling internally, so both selects rest at their
 *      panels' tops inside the box. The v8d pins below model both,
 *      with the pre-fix constants reproducing the overlap as the
 *      negative control.
 * These tests recompute every budget from the shipped CSS constants, in
 * the house idiom, for all 11 audit sizes × the worst states
 * (partnership host — team chips + badges + status present — unless a
 * state is noted). Rendered verification is the coordinator's prod sweep.
 */
const css = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const socialCss = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');
const protocol = readFileSync(new URL('../../../packages/protocol/src/index.ts', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('../src/online/Lobby.tsx', import.meta.url), 'utf8');

const v7 = css.slice(css.indexOf('lobby v7'));
const stage = v7.slice(0, v7.indexOf('/* very short screens'));
const compact = v7.slice(v7.indexOf('/* very short screens'), v7.indexOf('/* landscape phones'));
const v8 = css.slice(css.indexOf('lobby v8'), css.indexOf('lobby v8b'));
const v8all = css.slice(css.indexOf('lobby v8'));
const v8b = css.slice(css.indexOf('lobby v8b'));
const v8tap = v8.slice(0, v8.indexOf('@media (max-width: 1023px)'));
const v8A = v8.slice(v8.indexOf('@media (max-width: 1023px)'), v8.indexOf('/* (3) phone landscape stage'));
const v8B = v8.slice(v8.indexOf('/* (3) phone landscape stage'));
const v8bWide = v8b.slice(v8b.indexOf('@media (min-width: 1024px) and (min-height: 600px)'), v8b.indexOf('@media (min-width: 1024px) and (max-width: 1279px)'));
const v8bTier = v8b.slice(v8b.indexOf('@media (min-width: 1024px) and (max-width: 1279px)'), v8b.indexOf('@media (min-width: 768px)'));
const v8bTablet = v8b.slice(v8b.indexOf('@media (min-width: 768px)'));
const v8c = css.slice(css.indexOf('lobby v8c'), css.indexOf('lobby v8d'));
const v8d = css.slice(css.indexOf('lobby v8d'));
const v8dPage = v8d.slice(0, v8d.indexOf('@media (max-height: 599px) and (min-width: 560px)'));
const v8dStage = v8d.slice(v8d.indexOf('@media (max-height: 599px) and (min-width: 560px)'));

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

/** Constants parsed from the shipped v8/v8b rules. */
const K = {
  dockFallback: num(/var\(--dock-h, calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)\)/, stage),
  dockPadY: num(/\.lobby-dock \{ padding: (\d+)px 12px/, v8A) * 2,
  startRowGap: num(/\.lobby-dock \.lobby-start \{[^}]*gap: (\d+)px 8px/, v8A),
  startActionH: num(/\.lobby-dock \.lobby-start > \.primary\.big \{[^}]*min-height: (\d+)px/, v8A),
  leaveH: num(/\.lobby-dock \.leave-table-btn \{[^}]*min-height: (\d+)px/, v8A),
  startBasis: num(/\.lobby-dock \.lobby-start > \.primary\.big \{[^}]*flex: 1 1 (\d+)px/, v8A),
  waitBasis: num(/\.lobby-dock \.waiting-block \{[^}]*flex: 1 1 (\d+)px/, v8A),
  leaveBasis: num(/\.lobby-dock \.leave-table-btn \{[^}]*flex: 0 1 (\d+)px/, v8A),
  statusBasis: num(/\.lobby-dock \.lobby-status \{[^}]*flex: 1 1 (\d+)px/, v8A),
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
  /* v8b */
  cardWideH: num(/\.seat-card \{ height: (\d+)px; \}/, v8bWide),
  botStripWide: num(/\.seat-bot \{[^}]*height: (\d+)px/, v8bWide),
  hitPadWide: num(/\.seat-hit \{ padding-bottom: (\d+)px; \}/, v8bWide),
  chatRowH: num(/grid-template-rows: minmax\(0, 1fr\) (\d+)px/, v8bTier),
  tierHeadMargin: num(/\.lobby-v3 \.lobby-head \{[^}]*margin-bottom: (\d+)px/, v8bTier),
  tierStartGap: num(/\.lobby-main \.lobby-start \{[^}]*gap: (\d+)px 8px/, v8bTier),
  tierActionH: num(/\.lobby-main \.lobby-start > \.primary\.big \{[^}]*min-height: (\d+)px/, v8bTier),
  panelPadWide: num(/\.panel \{[^}]*padding: (\d+)px \d+px;/, styles),
  panelPadXWide: num(/\.panel \{[^}]*padding: \d+px (\d+)px;/, styles),
  chatInputPadY: (() => { const m = styles.match(/\.chat-input \{[^}]*padding: (\d+)px \d+px (\d+)px;/); if (!m) throw new Error('chat-input padding not found'); return parseFloat(m[1]!) + parseFloat(m[2]!); })(),
  chatListMin: num(/\.lobby-chat \.chat-list \{[^}]*min-height: (\d+)px/, css),
  chatInputH: num(/\.lobby-chat \.chat-input input \{ min-height: (\d+)px/, v8tap),
  avBtnH: num(/\.av-btn \{[^}]*height: (\d+)px/, css),
  seatTopZoneWide: num(/\.seat-top \{[^}]*min-height: (\d+)px/, css),
  seatRingWide: num(/\.seat-ring \{[^}]*width: (\d+)px/, css),
  hitTopWide: num(/\.seat-hit \{ all: unset;[^}]*padding: (\d+)px 4px 24px;/, css),
  hitGapWide: num(/\.seat-hit \{ all: unset;[^}]*gap: (\d+)px;/, css),
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
const VENUE_PANEL = 130; // title + 44px select + 3-line blurb + panel padding
const VENUE_REACH = 76; // title + select + padding: reachable with no scroll
const LABEL_MIN = 46; // "SEAT 1" at the 9px floor font (~23px ink + 5px tracking) + team chip 14 + gap 4
/** Dock meta-row model, measured on the prod re-sweep (768×1024 shot):
 * the two team pills span ≈240px at the dock's 11.5px pill size; the
 * status line "1 of 4 seated · waiting on 3 · Start fills with bots"
 * spans ≈245px of ink at 13px (≈231 at the compact 12px). */
const TEAMS_W = 248;
const TEAMS_H = 24;
const STATUS_W: Record<number, number> = { 13: 250, 12: 231 };
const STATUS_LH: Record<number, number> = { 13: 17, 12: 16 };
const SETTINGS_768 = 210; // venue panel ~124 + margin 18 + closed settings panel ~68
const HEAD_TIER_ROW = 62; // one-row head in the 1024–1279 tier: the code ticket is the tall item
const TEAMS_TIER = 40; // margin 12 + pill 24 + margin 4 (inside the table panel)
const MEDIA_TIER = 56; // margin-top 8 + the 48px CAM/MIC row (inside the table panel)
const START_MARGIN_TIER = 18;
const STATUS_TIER_H = 20; // one status line at full column width
const LC_HEAD = 30; // chat head: 13px line ≈17 + padding 12 + border 1
const PLATE_WIDE = 22; // SIT HERE plate in wide: 12px line ≈14.4 + padding 6 + margin-top 2

/**
 * The meta row in ROW terms (v8b): teams and the status share a row when
 * teams + gap + the status's flex basis fit the start block's content
 * width; the status then wraps inside what is left. Otherwise the status
 * wraps to its own row under the teams, at full width. Either way the
 * ACTION row is separate and 48px — it can never become a height again
 * (the pin below asserts the row fits: START basis + LEAVE basis + gap).
 */
function metaRow(contentW: number, font: 12 | 13) {
  const ink = STATUS_W[font]!;
  const lh = STATUS_LH[font]!;
  if (TEAMS_W + 8 + K.statusBasis <= contentW) {
    return Math.max(TEAMS_H, Math.ceil(ink / (contentW - TEAMS_W - 8)) * lh);
  }
  return TEAMS_H + K.startRowGap + Math.ceil(ink / contentW) * lh;
}
/**
 * Worst-state dock height (partnership host, seated): padding + meta row
 * + row gap + action row (START beside LEAVE, each 48) + bar margin +
 * media bar (+ safe-area bottom). Row model — no basis is a height.
 */
function dockA(h: number, w: number, sbot: number) {
  const font = (h <= 719 ? 12 : 13) as 12 | 13;
  const contentW = Math.min(w - 24, 560);
  return K.dockPadY + sbot + metaRow(contentW, font) + K.startRowGap + Math.max(K.startActionH, K.leaveH) + K.barMarginTop + K.barH;
}
/** Landscape dock: padding + (meta + gap + action row) beside the bar. */
function dockB(w: number, sbot: number) {
  const startW = w - 24 - 12 - (3 * K.barBtnW + 2 * 8);
  return K.dockPadYB + sbot + metaRow(startW, 12) + K.startRowGap + K.startActionH;
}

const PORTRAIT = [
  { name: '375×667', w: 375, h: 667, sat: 20, sbot: 0 },
  { name: '390×844', w: 390, h: 844, sat: 47, sbot: 34 },
  { name: '430×932', w: 430, h: 932, sat: 59, sbot: 34 },
] as const;
const TABLET = [{ name: '768×1024', w: 768, h: 1024, sat: 24, sbot: 0 }] as const;
const LANDSCAPE = [
  { name: '667×375', w: 667, h: 375, sat: 0, sbot: 0 },
  { name: '844×390', w: 844, h: 390, sat: 0, sbot: 21 },
  { name: '932×430', w: 932, h: 430, sat: 0, sbot: 21 },
] as const;
const WIDE = ['1024×768', '1180×820', '1440×900', '1920×1080'] as const;
const TIER = [
  { name: '1024×768', w: 1024, h: 768 },
  { name: '1180×820', w: 1180, h: 820 },
] as const;
const WIDE_FULL = [
  { name: '1440×900', w: 1440, h: 900 },
  { name: '1920×1080', w: 1920, h: 1080 },
] as const;

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

/** Tablet portrait (768–899 stack): settings row over a bounded stage. */
function tabletFit(s: (typeof TABLET)[number]) {
  const top = 64 + s.sat;
  const dock = dockA(s.h, s.w, s.sbot);
  const colsH = s.h - top - dock;
  const mainH = colsH - SETTINGS_768 - 12;
  const feltH = mainH - HEAD_A - K.panelPad;
  const rowH = (feltH - K.feltBorder - K.feltPadY - K.rowGap) / 3;
  const cqh = (feltH - K.feltBorder - K.feltPadY) / 100;
  const openStack =
    clampAt(hitPadTop, cqh) +
    clampAt(labelZone, cqh) +
    Math.min(52, emptyRingF * cqh) +
    clampAt([9.5, 3, 12], cqh) * 1.15 + 2 * Math.min(1, 0.3 * cqh) +
    K.hitPadBottom;
  const contentW = Math.min(s.w, 560) - 32;
  const feltInnerW = contentW - K.panelPad - K.feltBorder - 40;
  const cardW = Math.min((feltInnerW - 2 * 6) / 3, 104);
  return { dock, colsH, mainH, feltH, rowH, openStack, cardH: Math.min(rowH, K.cardMaxH), cardW, dockTop: s.h - dock, stackBottom: top + SETTINGS_768 + 12 + mainH };
}

/** Landscape geometry: rail + strip felt + two-column dock. */
function landscapeFit(s: (typeof LANDSCAPE)[number]) {
  const dock = dockB(s.w, s.sbot);
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

/** The 1024–1279 wide tier: one budgeted column (main over a 168px chat). */
function tierFit(s: (typeof TIER)[number]) {
  const colH = s.h - 72; // .lobby-v3 wide padding: 56 top + 16 bottom (safe-area 0 in the model)
  const colW = s.w - 40 - 452 - 14; // v3 padding 20×2, settings rail 452, grid gap 14
  const mainH = colH - 14 - K.chatRowH;
  const chatList = K.chatRowH - K.panelPadWide * 2 - LC_HEAD - (K.chatInputPadY + K.chatInputH);
  const fixed =
    HEAD_TIER_ROW + K.tierHeadMargin +
    START_MARGIN_TIER + STATUS_TIER_H + K.tierStartGap + K.tierActionH +
    K.panelPadWide * 2 + TEAMS_TIER + MEDIA_TIER;
  const feltH = mainH - fixed;
  const feltMin = K.cardWideH + K.feltBorder + 20; // card + felt border + strip padding 10×2
  const cardW = Math.min((colW - 4 - K.panelPadXWide * 2 - K.feltBorder - 28 - 4 * 8) / 5, 104);
  return { colH, colW, mainH, chatList, feltH, feltMin, cardW };
}

/** The wide open-card stack (v8b): hit pad + label zone + ring + plate + strip. */
const OPEN_STACK_WIDE = () => K.hitTopWide + 2 * K.hitGapWide + K.seatTopZoneWide + K.seatRingWide + PLATE_WIDE + K.botStripWide;

describe('lobby v8 structure', () => {
  it('the dock is two wrapped rows + a bar, never a stack of full-width rows', () => {
    expect(v8A).toContain('.lobby-dock .lobby-start { display: flex; flex-direction: row; flex-wrap: wrap;');
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

  it('the ≥1280 wide layout is untouched (desktop PASSes today and must not regress)', () => {
    expect(css).toContain('.lobby-cols { height: 100%; display: grid; grid-template-columns: minmax(420px, 1.25fr) minmax(320px, 1fr) minmax(300px, 360px); gap: 16px; }');
    // every .lobby-dock rule in v8/v8b lives inside the non-wide (A) or landscape (B) gates
    expect(v8tap).not.toContain('.lobby-dock');
    expect(v8b).not.toContain('.lobby-dock');
    expect(WIDE).toHaveLength(4);
    // no theme selectors in v8/v8b: geometry is theme-identical, Neon is color/glass only
    expect(v8all).not.toContain('data-theme');
    expect(v8all).not.toContain('html[');
  });

  it('Find a Table is not styled from online.css (its chips live in social.css — flagged for the coordinator, not re-fixed here)', () => {
    expect(css).not.toContain('.ot-filters');
    expect(css).not.toContain('.ot-acts');
  });
});

describe('the dock direction pin — the pin that would have caught the balloon (v8b defect 1)', () => {
  it('the base .lobby-start is a column flex (the trap), and the v8 tier overrides it to row, explicitly', () => {
    // the shipped base: column — in a column every flex-basis is a height
    expect(css).toContain('.lobby-start { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }');
    // the v8 dock tier must declare row itself; inheriting is what ballooned
    const startRule = v8A.match(/\.lobby-dock \.lobby-start \{[^}]*\}/)![0];
    expect(startRule).toContain('flex-direction: row');
    expect(startRule).toContain('flex-wrap: wrap');
    // the landscape tier must not silently re-declare a direction — it inherits v8A's row
    const landRule = v8B.match(/\.lobby-dock \.lobby-start \{[^}]*\}/)![0];
    expect(landRule).not.toContain('flex-direction');
    // and the 1024–1279 tier's in-column start block declares row for itself
    const tierRule = v8bTier.match(/\.lobby-main \.lobby-start \{[^}]*\}/)![0];
    expect(tierRule).toContain('flex-direction: row');
  });

  it('every dock flex child reads in row terms, and the action row fits the narrowest dock on one row', () => {
    // bases are WIDTHS now: START and the waiting block share one slot value
    expect(K.waitBasis).toBe(K.startBasis);
    // START (grows from its basis) + LEAVE (shrinks from its basis) + the
    // row gap must fit the 375px dock's content width (375 − 24 padding)
    for (const s of [...PORTRAIT, ...TABLET]) {
      const contentW = Math.min(s.w - 24, 560);
      expect(K.startBasis + K.leaveBasis + 8, s.name).toBeLessThanOrEqual(contentW);
    }
    // the meta row's fit rule uses the status's parsed basis, not a height
    expect(K.statusBasis).toBe(130);
  });
});

describe('the dock reserves its space and stays a bar (D2 root mechanism)', () => {
  it('the fallback reserve covers the modelled worst-case dock at every size', () => {
    for (const s of [...PORTRAIT, ...TABLET]) {
      expect(dockA(s.h, s.w, s.sbot), s.name).toBeLessThanOrEqual(K.dockFallback + s.sbot);
    }
    for (const s of [...LANDSCAPE]) {
      expect(dockB(s.w, s.sbot), s.name).toBeLessThanOrEqual(K.dockFallback + s.sbot);
    }
    // and Lobby still publishes the live height over the fallback
    expect(lobby).toContain("root.style.setProperty('--dock-h'");
  });

  it('the dock is a fraction of the screen it used to swallow (was 222px = 57% at 844×390)', () => {
    for (const s of [...PORTRAIT, ...TABLET]) expect(dockA(s.h, s.w, s.sbot) / s.h, s.name).toBeLessThanOrEqual(0.26);
    for (const s of [...LANDSCAPE]) expect(dockB(s.w, s.sbot) / s.h, s.name).toBeLessThanOrEqual(0.3);
    expect(dockB(932, 21)).toBeLessThanOrEqual(120);
  });

  it('the stage ends exactly where the dock begins — nothing under the dock, at every non-wide size', () => {
    for (const s of [...PORTRAIT]) {
      const f = portraitFit(s);
      expect(f.panelBottom, s.name).toBe(f.dockTop);
      expect(f.stageH, s.name).toBeGreaterThan(0);
    }
    for (const s of [...TABLET]) {
      const f = tabletFit(s);
      // the bounded cols stack: chrome + settings + gap + stage == dock top
      expect(f.stackBottom, s.name).toBe(f.dockTop);
      expect(f.mainH, s.name).toBeGreaterThan(0);
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

describe('tablet portrait budgets close (768–899 stack, v8b defect 4)', () => {
  it('the cols are height-bounded by the stage calc, so the stage ends at the dock top', () => {
    expect(v8bTablet).toContain('grid-template-rows: minmax(0, auto) minmax(0, 1fr) 0px');
    expect(v8bTablet).toContain('height: calc(100dvh - (64px + env(safe-area-inset-top)) - var(--dock-h, calc(200px + env(safe-area-inset-bottom))))');
    expect(v8bTablet).toContain('height: calc(100dvh - (58px + env(safe-area-inset-top)) - var(--dock-h, calc(200px + env(safe-area-inset-bottom))))');
    expect(v8bTablet).toContain('.lobby-main { height: auto; min-height: 0; }');
  });

  it('the felt and the open-card stack close inside the bounded stage', () => {
    for (const s of [...TABLET]) {
      const f = tabletFit(s);
      expect(f.feltH, s.name).toBeGreaterThanOrEqual(190);
      expect(f.rowH, s.name).toBeGreaterThanOrEqual(48);
      expect(f.openStack, s.name).toBeLessThanOrEqual(f.cardH + 3);
      expect(f.cardW - 8, s.name).toBeGreaterThanOrEqual(LABEL_MIN);
      // the whole venue panel is visible in the settings row (it also scrolls in its own box)
      expect(SETTINGS_768, s.name).toBeGreaterThanOrEqual(VENUE_PANEL);
    }
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

describe('the narrow-landscape head is bound to the rail (v8c, re-sweep #2)', () => {
  /* The share row's floor, recomputed from the shipped CSS. Measured
   * constants (the house idiom — cf. TEAMS_W): on the prod re-sweep
   * shots the Social button is 95px wide at every landscape size
   * (24px padding + 18px icon + 6px gap + ≈47px of "Social" ink — the
   * label is one unbreakable word, so natural width == min-content),
   * the widest measured code (YRRM5) inks ≈144px at the shipped 34px /
   * .28em (⇒ a .51 average advance factor, M included), the head title
   * inks ≈130px at its compact 20px, and the rail head's share
   * allowance in HEAD_B is 53px (HEAD_B 87 = title 24 + gap 10 + 53). */
  const TITLE_W = 130;
  const CODE_ADV = 0.51;
  const SOCIAL_LABEL_W = 47;
  const HEAD_SHARE_ALLOWANCE = HEAD_B - 24 - 10;
  const em = (re: RegExp, s: string) => { const m = s.match(re); if (!m) throw new Error(`pattern not found: ${re}`); return parseFloat(m[1]!); };
  const codeChars = num(/CODE_LENGTH = (\d+)/, protocol);
  const shareGap = num(/\.lobby-share \{ display: flex; align-items: center; justify-content: center; gap: (\d+)px; \}/, css);
  const codeLsEm = em(/\.room-code b \{[^}]*letter-spacing: ([\d.]+)em;/, css);
  const codePadEm = em(/\.room-code b \{[^}]*padding-left: ([\d.]+)em; \}/, css);
  const baseCodeFont = num(/\.lobby-v3 \.room-code b \{ font-size: (\d+)px; \}/, css);
  const baseTicketPadX = num(/\.share-code \{ padding: 4px (\d+)px 2px; \}/, compact);
  const socPadX = num(/\.social-btn \{[^}]*padding: 0 (\d+)px;/, socialCss);
  const socGap = num(/\.social-btn \{[^}]*gap: (\d+)px;/, socialCss);
  const socIcon = num(/\.social-btn \.social-ico \{ font-size: (\d+)px/, socialCss);
  const socH = num(/\.social-btn \{[^}]*height: (\d+)px;/, socialCss);
  const gateMaxC = num(/@media \(max-height: 599px\) and \(min-width: 560px\) and \(max-width: (\d+)px\)/, v8c);
  const codeFontC = num(/\.share-code b \{ font-size: (\d+)px;/, v8c);
  const codeLsC = em(/\.share-code b \{[^}]*letter-spacing: ([\d.]+)em; \}/, v8c);
  const ticketPadXC = num(/\.share-code \{ padding: \d+px (\d+)px \d+px; \}/, v8c);
  const ticketPadYC = (() => { const m = v8c.match(/\.share-code \{ padding: (\d+)px \d+px (\d+)px; \}/); if (!m) throw new Error('v8c ticket padding not found'); return parseFloat(m[1]!) + parseFloat(m[2]!); })();
  const socialPadXC = num(/\.lobby-social \{ padding: 0 (\d+)px; \}/, v8c);
  const feltMaxW = num(/\.mini-felt \{\s+height: auto;[^}]*max-width: (\d+)px;/, css);
  const feltPadXB = num(/\.mini-felt \{[^}]*padding: 10px (\d+)px;/, v8B);
  const smallFont = num(/\.share-code small \{ font-size: (\d+)px !important; \}/, compact);
  const smallLsEm = em(/\.room-code small \{[^}]*letter-spacing: ([\d.]+)em;/, css);

  const railAt = (w: number) => Math.min(K.railMax, Math.max(K.railMin, (K.railVw / 100) * w));
  /** A code's ink: glyphs + one tracking step per char + the pad-left step. */
  const codeInk = (font: number, lsEm: number) => codeChars * CODE_ADV * font + codeChars * lsEm * font + codePadEm * font;
  const socialW = (padX: number) => padX * 2 + socIcon + socGap + SOCIAL_LABEL_W;
  /** The share row's floor: the ticket cannot shrink below its code. */
  const shareRow = (codeFont: number, lsEm: number, ticketPadX: number, socPad: number) =>
    codeInk(codeFont, lsEm) + ticketPadX * 2 + 2 + shareGap + socialW(socPad);
  const rowBase = shareRow(baseCodeFont, codeLsEm, baseTicketPadX, socPadX);
  const rowC = shareRow(codeFontC, codeLsC, ticketPadXC, socialPadXC);
  /** Where the strip's first seat card starts, measured from the head's left edge. */
  const seatZoneFromHeadLeft = (w: number) => {
    const contentW = Math.min(w, 900) - 32;
    const panelInner = contentW - railAt(w) - 12 - K.panelPad;
    const centering = Math.max(0, (panelInner - feltMaxW) / 2);
    return railAt(w) + 12 + K.panelPad / 2 + K.feltBorder / 2 + feltPadXB + centering;
  };

  it('the sub-tier is scoped to narrow landscape only — 844/932 cannot be touched by it', () => {
    expect(v8B).toContain('@media (max-height: 599px) and (min-width: 560px)');
    expect(gateMaxC).toBe(800);
    expect(gateMaxC).toBeLessThan(844);
    expect(v8c).toContain('.lobby-v3 .lobby-head .share-code { padding: 3px 8px 2px; }');
    expect(v8c).toContain('.lobby-v3 .lobby-head .lobby-social { padding: 0 8px; }');
    // the felt, the seats, the dock and the grid itself do not move in this tier
    for (const s of ['.seat-', '.mini-felt', '.lobby-dock', '.lobby-cols', 'grid-template']) {
      expect(v8c, s).not.toContain(s);
    }
  });

  it('the pre-v8c row reproduces the defect in the model — and only at 667', () => {
    // at 932 the baseline row fits the rail outright (279.6px)
    expect(rowBase, '932×430').toBeLessThanOrEqual(railAt(932));
    // at 844 the row spills ≈27px past the rail but the first seat card
    // sits ≈82px past it (gap + panel/felt padding + felt centering)
    expect(rowBase, '844×390').toBeLessThanOrEqual(seatZoneFromHeadLeft(844));
    // at 667 the same row reaches the first seat: the model overlap is
    // at least the probe's smaller measured value (18px, cutthroat;
    // the model carries the widest code, the probe's other room hit 24)
    expect(rowBase - seatZoneFromHeadLeft(667), '667×375').toBeGreaterThanOrEqual(18);
  });

  it('the v8c row fits the rail at 667×375 — and at every width in its gate', () => {
    for (const w of [560, 600, 667, 700, 800]) {
      expect(rowC, `${w} wide`).toBeLessThanOrEqual(railAt(w));
    }
    // the head's other row fits too: the title alone in the rail
    expect(TITLE_W).toBeLessThanOrEqual(railAt(667));
    expect(TITLE_W).toBeLessThanOrEqual(K.railMin);
    // and Social now ends ≈70px before the first seat card at 667
    expect(rowC, '667×375').toBeLessThanOrEqual(seatZoneFromHeadLeft(667) - 44);
  });

  it('the head height is unchanged: the shrunk ticket still fits the HEAD_B share allowance', () => {
    // the small print's single line ("TABLE CODE · TAP TO SHARE") wraps
    // inside the ticket's new content width; the code line is 20px tall
    const smallInk = 'TABLE CODE · TAP TO SHARE'.length * (0.4 * smallFont + smallLsEm * smallFont);
    const contentC = railAt(667) - shareGap - socialW(socialPadXC) - ticketPadXC * 2 - 2;
    const smallLines = Math.ceil(smallInk / contentC);
    const ticketHC = 2 + ticketPadYC + smallLines * 11 + codeFontC * 1.15;
    expect(smallLines).toBe(2);
    expect(ticketHC).toBeLessThanOrEqual(HEAD_SHARE_ALLOWANCE);
    expect(Math.max(ticketHC, socH)).toBeLessThanOrEqual(HEAD_SHARE_ALLOWANCE);
    // so the rail stack keeps the v8b budgets: settings keep their reach
    for (const s of [...LANDSCAPE]) {
      const f = landscapeFit(s);
      expect(f.settingsH, s.name).toBeGreaterThanOrEqual(VENUE_REACH);
    }
  });

  it('both share-row controls keep the tap floor in the sub-tier', () => {
    expect(socH).toBe(44);
    expect(socialW(socialPadXC)).toBeGreaterThanOrEqual(44);
    expect(num(/\.share-code \{ min-height: (\d+)px/, v8tap)).toBe(44);
    // the ticket's own height in the tier (above) also clears the floor
    expect(codeFontC).toBeGreaterThanOrEqual(20);
  });
});

describe('the wide tier closes (v8b defects 2 + 3)', () => {
  it('the + BOT strip is floored in wide too, with the same strip + reserve as the dock tier', () => {
    expect(K.botStripWide).toBe(44);
    expect(K.hitPadWide).toBe(K.botStripWide);
    // the wide open stack (pad + label zone + ring + plate + strip) closes in the 148px card
    expect(OPEN_STACK_WIDE()).toBeLessThanOrEqual(K.cardWideH);
  });

  it('the 1024–1279 column budget closes: head + table + start + chat + gaps ≤ the column height', () => {
    // structure: the chat row is a definite height, main is a non-scrolling
    // flex stage, the felt is a strip, the start block is two rows
    expect(v8bTier).toContain('.lobby-main { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }');
    expect(v8bTier).toContain('grid-template-areas: "left top center right bottom"');
    expect(v8bTier).toContain('.lobby-main .exit-divider { display: none; }');
    for (const s of [...TIER]) {
      const f = tierFit(s);
      // the felt absorbs the slack and never drops below the open card's home
      expect(f.feltH, s.name).toBeGreaterThanOrEqual(f.feltMin);
      // the chat's internal rows itemize inside its 168px: panel pad 12 +
      // head 30 + list + input row (padding + the 44px-floored input);
      // the list keeps its 60px floor with room to spare
      expect(f.chatList, s.name).toBeGreaterThanOrEqual(K.chatListMin);
      expect(f.chatList, s.name).toBeGreaterThanOrEqual(60);
      // seat cards keep their minimums in the strip
      expect(f.cardW, s.name).toBeGreaterThanOrEqual(60);
      expect(f.cardW - 8, s.name).toBeGreaterThanOrEqual(LABEL_MIN);
    }
  });

  it('at ≥1280 the chat is its own full-height column — media and chat are column-disjoint', () => {
    // DOM order in .lobby-cols is main · settings · chat (auto-placed 1·2·3)
    const iMain = lobby.indexOf('className="lobby-main"');
    const iSettings = lobby.indexOf('className="lobby-settings"');
    const iChat = lobby.indexOf('<LobbyChat');
    expect(iMain).toBeGreaterThan(-1);
    expect(iMain).toBeLessThan(iSettings);
    expect(iSettings).toBeLessThan(iChat);
    // the tier gate stops at 1279, so ≥1280 keeps the three-column grid
    expect(v8bTier).toContain('@media (min-width: 1024px) and (max-width: 1279px) and (min-height: 600px)');
    expect(css).toContain('.lobby-chat.wide { display: flex; flex-direction: column; min-height: 0; height: 100%; margin: 0; padding: 0; }');
    // chat internals itemize inside the full column height at both sizes
    for (const s of [...WIDE_FULL]) {
      const colH = s.h - 72;
      const list = colH - K.panelPadWide * 2 - LC_HEAD - (K.chatInputPadY + K.chatInputH);
      expect(list, s.name).toBeGreaterThanOrEqual(K.chatListMin);
      // the media row (inside main's own column) is 8 margin + one button tall
      expect(MEDIA_TIER, s.name).toBe(8 + K.avBtnH);
    }
  });
});

describe('the settings selects clear the dock at rest (v8d, the D2 remainder — owner call 2026-10-25)', () => {
  /* Where the two selects sit inside the settings flow (model constants
   * from the shipped rules): the venue select's bottom edge is
   * VENUE_REACH (76) into the flow; the timer select lives in the
   * settings panel's summary, after the venue panel — its bottom edge
   * is venue panel (130) + the panel's trailing margin (18, styles.css
   * .panel) + the summary's top padding (6) + the select's own 44px. */
  const panelMargin = num(/\.panel \{[^}]*margin-bottom: (\d+)px/, styles);
  const summaryPad = num(/\.settings-panel > summary \{[^}]*padding: (\d+)px 0/, css);
  const TIMER_BOTTOM_OFF = VENUE_PANEL + panelMargin + summaryPad + 44;
  const settingsMarginPre = num(/\.lobby-settings \{ margin-top: (\d+)px; \}/, stage);

  it('structure: the reserve reads the same live dock height the stage subtracts, and touches nothing else', () => {
    // the cure's margin is the --dock-h reserve itself, fallback included
    expect(v8dPage).toContain(`.lobby-settings { margin-top: calc(var(--dock-h, calc(${K.dockFallback}px + env(safe-area-inset-bottom)))); }`);
    // the pre-fix flow had a flat 18px margin (the negative control below)
    expect(settingsMarginPre).toBe(18);
    // the section changes no dock, seat, felt or COLS-grid geometry,
    // and is theme-free (the stage part grids .lobby-settings' OWN
    // columns only — pinned in the landscape structure test below)
    for (const s of ['.lobby-dock', '.seat-', '.mini-felt', 'data-theme', 'html[']) {
      expect(v8d, s).not.toContain(s);
    }
    expect(v8dPage).not.toContain('grid-template');
  });

  it('the page-flow gate matches only the page-flow composition', () => {
    const gate = v8dPage.slice(0, v8dPage.indexOf('{'));
    // portrait phones + the 900–1023 page-flow widths + short sub-560 screens
    expect(gate).toContain('(max-width: 767px) and (min-height: 600px)');
    expect(gate).toContain('(min-width: 900px) and (max-width: 1023px) and (min-height: 600px)');
    expect(gate).toContain('(max-width: 559px) and (max-height: 599px)');
    // never a bare non-wide clause: that would leak into the 768–899
    // bounded tier (whose settings row already ends at the dock's top
    // edge) and into the landscape stage (its own box, part 2 below)
    expect(gate).not.toContain('(max-width: 1023px),');
    expect(gate).not.toContain('768px');
  });

  it('portrait: at scroll 0 the settings column starts exactly at the viewport bottom edge', () => {
    for (const s of [...PORTRAIT]) {
      const dock = dockA(s.h, s.w, s.sbot);
      const dockTop = s.h - dock;
      // stage bottom == dock top (pinned above); the reserve adds one
      // full live dock height, so the settings start at the viewport's
      // bottom edge and every settings rect is disjoint from every
      // dock control (all control rects end at or above s.h)
      const settingsTop = dockTop + dock;
      expect(settingsTop, s.name).toBe(s.h);
      expect(settingsTop + (VENUE_REACH - 44), s.name).toBeGreaterThanOrEqual(s.h); // venue select top
      expect(settingsTop + (TIMER_BOTTOM_OFF - 44), s.name).toBeGreaterThanOrEqual(s.h); // timer select top
    }
  });

  it('portrait negative control: the pre-fix 18px margin reproduces the underlap in the model', () => {
    for (const s of [...PORTRAIT]) {
      const dock = dockA(s.h, s.w, s.sbot);
      const dockTop = s.h - dock;
      const font = (s.h <= 719 ? 12 : 13) as 12 | 13;
      const contentW = Math.min(s.w - 24, 560);
      const startTop = dockTop + K.dockPadY / 2 + metaRow(contentW, font) + K.startRowGap;
      const venueTop = dockTop + settingsMarginPre + (VENUE_REACH - 44);
      const venueBottom = dockTop + settingsMarginPre + VENUE_REACH;
      // venue select × START, pre-fix: a real overlap at every size
      // (production measured 21–44px deep across the two room kinds)
      expect(Math.min(venueBottom, startTop + K.startActionH) - Math.max(venueTop, startTop), s.name).toBeGreaterThan(0);
      // and at the two taller sizes the timer select's rect also starts
      // inside the dock's band (production caught it against the MIC /
      // CHAT row at all three; at 375×667 the model's 3-line-blurb
      // venue constant puts its start a few px past the fold instead —
      // the venue pair above carries the control at that size)
      if (s.h > 700) {
        expect(dockTop + settingsMarginPre + (TIMER_BOTTOM_OFF - 44), s.name).toBeLessThan(s.h);
      }
    }
  });

  /* The landscape grid, parsed from the shipped v8d stage rules. In
   * the pre-fix series stack the timer's bottom edge sits
   * TIMER_BOTTOM_OFF into the settings flow; the stage box is only
   * 80–144px tall (landscapeFit), so in series the timer's rect
   * crossed the box's bottom — and the dock — at every size. The
   * grid puts both selects at their panels' tops instead: the venue
   * select's bottom edge is the panel's top padding + the ≈19px
   * title line + the pick's top margin + its own 44px; the timer's
   * is the settings panel's top padding + the summary's top padding
   * + its own 44px. Both offsets are constants of the shipped rules,
   * independent of how tall the panels' remaining content runs. */
  const panelPadTop = num(/\.panel \{[^}]*padding: (\d+)px/, styles);
  const venuePadNew = num(/\.lobby-venue-panel \{[^}]*padding-top: (\d+)px/, v8dStage);
  const pickMarginNew = num(/\.venue-pick \{ margin-top: ([\d.]+)(?:px)?[; }]/, v8dStage);
  const summaryPadNew = num(/> summary \{ padding-top: (\d+)px/, v8dStage);
  const VENUE_BOTTOM_OFF = venuePadNew + 19 + pickMarginNew + 44;
  const TIMER_BOTTOM_GRID = panelPadTop + summaryPadNew + 44;

  it('landscape structure: the two panels sit in a grid inside the stage gate, uncapped', () => {
    const gate = v8dStage.slice(0, v8dStage.indexOf('{'));
    expect(gate).toContain('@media (max-height: 599px) and (min-width: 560px)');
    // no max-width cap (unlike v8c): 844 and 932 underlapped too (21–30px)
    expect(gate).not.toContain('max-width');
    // the settings region's OWN columns — the only grid-template the
    // v8d section may touch; the cols grid (rail/table) is untouched
    expect(v8dStage).toContain('.lobby-settings { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 8px; }');
    expect(v8dStage).not.toContain('.lobby-cols { grid-template');
    // each panel is stretched to the box and scrolls its own overflow
    expect(v8dStage).toContain('.lobby-settings > * { min-width: 0; min-height: 0; overflow-y: auto; scrollbar-width: thin; }');
    // a lone panel (the guest's venue-only rail) spans both columns
    expect(v8dStage).toContain('.lobby-settings > :only-child { grid-column: 1 / -1; }');
    // the ONE display:none in the section: the summary's mode line in
    // this gate — the same mode title reads on the felt's center, and
    // hiding it is what lets the timer rest on the summary's first row
    expect(v8dStage.match(/display: none/g)).toHaveLength(1);
    expect(v8dStage).toContain('.lobby-settings .settings-panel .sr-mode { display: none; }');
    expect(lobby).toContain('{modeTitle(r)}');
  });

  it('landscape: both selects rest inside the box, above the dock, at internal scroll 0', () => {
    // the panels end at the box's bottom edge == the dock's top edge,
    // so a select is disjoint from every dock control iff its bottom
    // edge (a constant offset from its panel's top == the box's top)
    // fits inside the box's height
    for (const s of [...LANDSCAPE]) {
      expect(landscapeFit(s).settingsH - VENUE_BOTTOM_OFF, s.name).toBeGreaterThanOrEqual(0);
      expect(landscapeFit(s).settingsH - TIMER_BOTTOM_GRID, s.name).toBeGreaterThanOrEqual(0);
    }
  });

  it('landscape negative control: in the pre-fix series stack the timer rect crosses the box', () => {
    // production measured timer × START 5–14px deep at 667×375, timer
    // × LEAVE 21–30px at 844×390, timer × LEAVE 22px and timer × the
    // team pencil 14px at 932×430 — the series offset against the
    // box height is the model's form of the same crossing
    for (const s of [...LANDSCAPE]) {
      expect(TIMER_BOTTOM_OFF - landscapeFit(s).settingsH, s.name).toBeGreaterThan(0);
    }
  });

  it('landscape: the venue select is still fully visible at rest inside its box', () => {
    expect(VENUE_BOTTOM_OFF).toBeLessThan(VENUE_REACH);
    for (const s of [...LANDSCAPE]) {
      expect(landscapeFit(s).settingsH, s.name).toBeGreaterThanOrEqual(VENUE_BOTTOM_OFF);
    }
  });
});

describe('tap floor — the online.css census (D4)', () => {
  const floor = (re: RegExp, s: string, label: string) => expect(num(re, s), label).toBeGreaterThanOrEqual(44);
  it('every census control in online.css reaches 44px', () => {
    floor(/\.seat-bot \{[^}]*height: (\d+)px/, v8A, '+ BOT strip (non-wide)');
    floor(/\.seat-bot \{[^}]*height: (\d+)px/, v8bWide, '+ BOT strip (wide)');
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
