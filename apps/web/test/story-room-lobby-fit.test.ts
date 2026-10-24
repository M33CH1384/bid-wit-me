/**
 * Co-op room lobby fit (owner 2026-10-24: "none of them are clearly
 * in view unless I scroll — restructure this screen so that no
 * scroll is needed").
 *
 * The d7cbc51c composition was content-sized: hero + ticket + felt +
 * lines + route + actions summed past the viewport, the actions
 * rested below the fold, and the first button showed as a gold
 * sliver. The restructure makes the lobby a STAGE: `.story-room-
 * shell` is exactly 100dvh and a size container, every section is a
 * cqh share of it or a fixed floor, the felt is the one elastic
 * section (and itself a size container, so seat faces/type scale
 * with the felt's own height), and the stop chips are a single
 * no-wrap row at any progress level.
 *
 * These tests compute the fit from the shipped CSS (the seat-fit /
 * fan-coverage pin is the model) so a regression to content-sized
 * sections fails here instead of on the owner's phone.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/story/story.css', import.meta.url), 'utf8');
const room = css.slice(css.indexOf('.story-room-shell {'));

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};
const clamp3 = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return { min: parseFloat(m[1]!), f: parseFloat(m[2]!), max: parseFloat(m[3]!) };
};
// (clamp regexes below write min/max as ([\d.]+)px — several shipped
// clamps use fractional px like 12.5px.)
const evalClamp = (c: { min: number; f: number; max: number }, base: number) =>
  Math.min(c.max, Math.max(c.min, (c.f / 100) * base));

/** Chrome constants parsed from the shipped rules. */
const CH = {
  shellPadTop: num(/\.story-room-shell \{[^}]*padding-top: calc\((\d+)px \+ env\(safe-area-inset-top\)\)/, room),
  shellPadBottom: num(/\.story-room-shell \{[^}]*padding-bottom: calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/, room),
  heroShare: num(/\.story-room-hero \{[^}]*height: ([\d.]+)cqh/, room),
  heroMin: num(/\.story-room-hero \{[^}]*min-height: (\d+)px/, room),
  heroMax: num(/\.story-room-hero \{[^}]*max-height: (\d+)px/, room),
  heroPadF: num(/\.story-room-hero \{[^}]*padding: ([\d.]+)cqh/, room),
  heroMarginF: num(/\.story-room-hero \{[^}]*margin-bottom: ([\d.]+)cqh/, room),
  title: clamp3(/\.story-room-hero \.story-title \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  sub: clamp3(/\.story-room-hero \.story-sub \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  shareShare: num(/\.story-room-share \{[^}]*height: ([\d.]+)cqh/, room),
  shareMin: num(/\.story-room-share \{[^}]*min-height: (\d+)px/, room),
  shareMax: num(/\.story-room-share \{[^}]*max-height: (\d+)px/, room),
  shareMarginF: num(/\.story-room-share \{[^}]*margin: 0 0 ([\d.]+)cqh/, room),
  code: clamp3(/\.story-room-code \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  feltMin: num(/\.story-room-table \{[^}]*min-height: (\d+)px/, room),
  feltPadY: num(/\.story-room-table \{[^}]*padding: (\d+)px;/, room) * 2,
  feltGap: num(/\.story-room-table \{[^}]*gap: (\d+)px;/, room) * 2,
  feltMarginF: num(/\.story-room-table \{[^}]*margin: 0 0 ([\d.]+)cqh/, room),
  face: clamp3(/\.story-room-table \.story-face\.room-face,[^}]*width: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  seatName: clamp3(/\.story-room-seat-name \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  seatRole: clamp3(/\.story-room-seat-role \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  line: clamp3(/\.story-room-line \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  lineMarginF: num(/\.story-room-line \{[^}]*margin: 0 0 ([\d.]+)cqh/, room),
  headMargin: num(/\.story-room-stops \.story-coop-h \{[^}]*margin: 0 0 (\d+)px/, room),
  node: clamp3(/\.story-room-stops \.story-gate-node \{[^}]*width: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  caption: clamp3(/\.story-room-route-line \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, room),
  captionMargin: num(/\.story-room-route-line \{[^}]*margin: (\d+)px 0 0/, room),
  stopsMarginF: num(/\.story-room-stops \{[^}]*margin: 0 0 ([\d.]+)cqh/, room),
  chipsMargin: num(/\.story-room-stoprow \{[^}]*margin-top: (\d+)px/, room),
  actionsPadTop: num(/\.story-room-shell \.story-room-actions \{[^}]*padding-top: (\d+)px/, room),
  btnMinH: num(/\.story-shell \.btn \{[^}]*min-height: (\d+)px/, css),
};

/** Worst-case line counts for the shipped copy at phone widths,
 * measured against the owner's screenshots: the hero sub wraps to
 * two lines at 375/390 (one at 430); the route caption wraps to
 * two; the waiting line wraps to three; the awareness line is one.
 * If the copy grows, re-measure and update these. */
const HEADING_BOX = 19; // "The pair's stop" at 14px, line box + its margin handled separately
const ACTIONS_ROW = 46; // .btn min-height 44 + border
const AWARE_LINES = 1;
const WAITING_LINES = 3;
const CAPTION_LINES = 2;
const CRUMB_BOX = 11 * 1.3 + 2; // crumb line + its bottom margin

const SIZES = [
  { name: '375×667', w: 375, h: 667, sat: 20, sbot: 0, subLines: 2 },
  { name: '390×844', w: 390, h: 844, sat: 47, sbot: 34, subLines: 2 },
  { name: '430×932', w: 430, h: 932, sat: 59, sbot: 34, subLines: 1 },
] as const;

function budget(h: number, sat: number, sbot: number, subLines: number) {
  const H = h - (CH.shellPadTop + sat) - (CH.shellPadBottom + sbot);
  const heroH = Math.min(CH.heroMax, Math.max(CH.heroMin, (CH.heroShare / 100) * H));
  const heroContent = 2 * ((CH.heroPadF / 100) * H)
    + CRUMB_BOX
    + evalClamp(CH.title, H) * 1.1
    + 4 // .story-sub margin-top
    + subLines * evalClamp(CH.sub, H) * 1.3;
  const shareH = Math.min(CH.shareMax, Math.max(CH.shareMin, (CH.shareShare / 100) * H));
  const ticketContent = 10 + 10.5 * 1.3 + 1 + evalClamp(CH.code, H) * 1.15;
  const lineFont = evalClamp(CH.line, H);
  const lineAware = lineFont * 1.35 * AWARE_LINES;
  const lineWaiting = lineFont * 1.35 * WAITING_LINES;
  const stopsH = HEADING_BOX + CH.headMargin
    + evalClamp(CH.node, H)
    + CH.captionMargin + CAPTION_LINES * evalClamp(CH.caption, H) * 1.3;
  const chipsH = CH.chipsMargin + CH.btnMinH + 2;
  const actionsH = CH.actionsPadTop + ACTIONS_ROW;
  const marginsBound = ((CH.heroMarginF + CH.shareMarginF + CH.feltMarginF + CH.lineMarginF + CH.stopsMarginF) / 100) * H;
  const marginsUnbound = ((CH.heroMarginF + CH.shareMarginF + CH.feltMarginF + CH.lineMarginF) / 100) * H;
  // The owner's screenshot state, and the heaviest: partner bound,
  // awareness line up, host's chips present.
  const feltBound = H - (heroH + shareH + lineAware + stopsH + chipsH + actionsH + marginsBound);
  // Partner not yet bound: the waiting line runs long, but there is
  // no pair progress yet — no stops block, no chips.
  const feltUnbound = H - (heroH + shareH + lineWaiting + actionsH + marginsUnbound);
  const felt = Math.min(feltBound, feltUnbound);
  const rowH = (felt - CH.feltPadY - CH.feltGap) / 3;
  const face = evalClamp(CH.face, felt);
  const seatBlock = face + 2 // seat gap
    + evalClamp(CH.seatName, felt) * 1.15 + 2 // name line + its top margin (ready tick rides this line)
    + evalClamp(CH.seatRole, felt) * 1.2;
  return { H, heroH, heroContent, shareH, ticketContent, feltBound, feltUnbound, felt, rowH, face, seatBlock };
}

describe('the room lobby is a stage, not a scroll (owner 2026-10-24)', () => {
  it('the shell is exactly the viewport, a size container, and the felt flexes inside it', () => {
    expect(room).toMatch(/\.story-room-shell \{[^}]*height: 100dvh/);
    expect(room).toMatch(/\.story-room-shell \{[^}]*container-type: size/);
    expect(room).toMatch(/\.story-room-shell \{[^}]*overflow: hidden/);
    expect(room).toMatch(/\.story-room-table \{[^}]*flex: 1 1 auto/);
    expect(room).toMatch(/\.story-room-table \{[^}]*container-type: size/);
    expect(room).toMatch(/\.story-room-table \{[^}]*grid-template-rows: repeat\(3, minmax\(0, 1fr\)\)/);
    // the fallback: very short heights flow instead of clipping
    expect(room).toMatch(/@media \(max-height: 560px\) \{\s*\.story-room-shell \{[^}]*container-type: normal/);
  });

  it('the chips are one row at any progress level, and the ready status is not a button in dress', () => {
    expect(room).toMatch(/\.story-room-stoprow \{[^}]*flex-wrap: nowrap; overflow-x: auto/);
    const status = room.match(/\.story-room-status \{[^}]*\}/)![0];
    expect(status).not.toContain('background');
    expect(status).not.toContain('border');
  });

  for (const s of SIZES) {
    describe(`at ${s.name}`, () => {
      const b = budget(s.h, s.sat, s.sbot, s.subLines);
      it('the hero holds its whole title block inside its capped share', () => {
        expect(b.heroContent).toBeLessThanOrEqual(b.heroH);
      });
      it('the ticket holds the code inside the share row, and the row is a full tap target', () => {
        expect(b.ticketContent).toBeLessThanOrEqual(b.shareH);
        expect(b.shareH).toBeGreaterThanOrEqual(44);
        expect(CH.btnMinH).toBeGreaterThanOrEqual(44);
      });
      it('the felt keeps its floor in the heaviest state — no section pushes the actions off', () => {
        expect(b.feltBound).toBeGreaterThanOrEqual(CH.feltMin);
        expect(b.feltUnbound).toBeGreaterThanOrEqual(CH.feltMin);
      });
      it('a seat fits its row with the face at a legible size', () => {
        expect(b.seatBlock).toBeLessThanOrEqual(b.rowH);
        expect(b.face).toBeGreaterThanOrEqual(38);
      });
    });
  }
});
