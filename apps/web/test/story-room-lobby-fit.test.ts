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

/** ---- landscape stage (design audit D7, 2026-10-24) ----
 * In phone landscape the column stage's fixed shares exceed the
 * 355–389px content heights before the felt's 240px floor, so the
 * ≤560px flow fallback took over and the actions sat ~290px below
 * the fold. The fix keeps the stage at short heights on wide
 * viewports and composes it as a two-pane grid: a 280px rail
 * (hero + share + line) beside a felt that spans the main height,
 * the stops as one horizontal bar, actions pinned on the last row.
 * The block below parses that media query's constants and closes
 * the same worst state the portrait budget uses (partner bound,
 * awareness line, chips present) at the three landscape sizes. */
const landStart = room.indexOf('@media (max-height: 560px) and (min-width: 600px)');
const land = (() => {
  if (landStart < 0) throw new Error('landscape stage media query not found');
  let depth = 0;
  for (let i = room.indexOf('{', landStart); i < room.length; i++) {
    if (room[i] === '{') depth++;
    if (room[i] === '}' && --depth === 0) return room.slice(landStart, i + 1);
  }
  throw new Error('landscape stage media query not closed');
})();

const L = {
  railW: num(/grid-template-columns: minmax\(0, (\d+)px\)/, land),
  rowGap: num(/gap: (\d+)px \d+px/, land),
  heroPadY: num(/\.story-room-hero \{[^}]*padding: (\d+)px/, land),
  crumb: num(/\.story-room-hero \.story-crumb \{[^}]*font-size: ([\d.]+)px/, land),
  title: num(/\.story-room-hero \.story-title \{[^}]*font-size: (\d+)px/, land),
  sub: num(/\.story-room-hero \.story-sub \{[^}]*font-size: ([\d.]+)px/, land),
  shareMin: num(/\.story-room-share \{[^}]*min-height: (\d+)px/, land),
  code: num(/\.story-room-code \{[^}]*font-size: (\d+)px/, land),
  line: num(/\.story-room-line \{[^}]*font-size: (\d+)px/, land),
  feltMin: num(/\.story-room-table \{[^}]*min-height: (\d+)px/, land),
  feltPadY: num(/\.story-room-table \{[^}]*padding: (\d+)px;/, land) * 2,
  face: clamp3(/\.story-room-table \.story-face\.room-face,[^}]*width: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, land),
  seatName: clamp3(/\.story-room-seat-name \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, land),
  seatRole: clamp3(/\.story-room-seat-role \{[^}]*font-size: clamp\(([\d.]+)px, ([\d.]+)cqh, ([\d.]+)px\)/, land),
  caption: num(/\.story-room-route-line \{[^}]*font-size: ([\d.]+)px/, land),
  heading: num(/\.story-room-stops \.story-coop-h \{[^}]*font-size: (\d+)px/, land),
  actionsPadTop: num(/\.story-room-shell \.story-room-actions \{[^}]*padding-top: (\d+)px/, land),
};

const LAND_SIZES = [
  { name: '667×375', w: 667, h: 375, sat: 0, sbot: 0 },
  { name: '844×390', w: 844, h: 390, sat: 0, sbot: 21 },
  { name: '932×430', w: 932, h: 430, sat: 0, sbot: 21 },
] as const;

/** Landscape worst state, same actors as the portrait budget:
 * partner bound, awareness line up, host's chips present. The hero
 * sub is budgeted at two lines (the rail is 280px wide); the route
 * caption at three lines at 10.5px in its ~177px+ flex share. */
function landBudget(h: number, sat: number, sbot: number) {
  const H = h - (CH.shellPadTop + sat) - (CH.shellPadBottom + sbot);
  const heroH = 2 * L.heroPadY + 2 // hero vertical padding + border
    + (L.crumb * 1.3 + 2) // crumb line + its bottom margin
    + L.title * 1.1
    + 4 // .story-sub margin-top
    + 2 * L.sub * 1.3;
  const ticketContent = 10 + 10.5 * 1.3 + 1 + L.code * 1.15;
  const shareH = Math.max(L.shareMin, ticketContent, CH.btnMinH);
  const lineAware = L.line * 1.35;
  const lineWaiting = 3 * L.line * 1.35; // the long waiting line at rail width
  const railBound = heroH + shareH + lineAware + 2 * L.rowGap;
  const railWaiting = heroH + shareH + lineWaiting + 2 * L.rowGap;
  const stopsH = Math.max(CH.btnMinH + 2, 3 * L.caption * 1.3, 22, L.heading * 1.3);
  const actionsH = L.actionsPadTop + ACTIONS_ROW;
  // Felt spans grid rows 1–4; the whole stage is rows 1–6 with five
  // row gaps, so the felt takes H minus stops, actions and the two
  // gaps that are not inside its span.
  const felt = H - stopsH - actionsH - 2 * L.rowGap;
  const rowH = (felt - L.feltPadY - CH.feltGap) / 3;
  const face = evalClamp(L.face, felt);
  const seatBlock = face + 2
    + evalClamp(L.seatName, felt) * 1.15 + 2
    + evalClamp(L.seatRole, felt) * 1.2;
  return { H, heroH, shareH, railBound, railWaiting, stopsH, actionsH, felt, rowH, face, seatBlock };
}

describe('the room lobby stage in phone landscape (design audit D7)', () => {
  it('the stage stays a stage at short heights on wide viewports — grid, sized, no flow fallback', () => {
    expect(land).toMatch(/\.story-room-shell \{[^}]*display: grid/);
    expect(land).toMatch(/\.story-room-shell \{[^}]*height: 100dvh/);
    expect(land).toMatch(/\.story-room-shell \{[^}]*container-type: size/);
    expect(land).toMatch(/\.story-room-shell \{[^}]*overflow: hidden/);
    expect(land).toMatch(/\.story-room-table \{[^}]*grid-row: 1 \/ 5/);
    expect(land).toMatch(/\.story-room-stops \{[^}]*grid-row: 5/);
    expect(land).toMatch(/\.story-room-shell \.story-room-actions \{[^}]*grid-row: 6/);
    // the narrow-short flow fallback still exists beside it
    expect(room).toMatch(/@media \(max-height: 560px\) \{\s*\.story-room-shell \{[^}]*container-type: normal/);
  });

  for (const s of LAND_SIZES) {
    describe(`at ${s.name}`, () => {
      const b = landBudget(s.h, s.sat, s.sbot);
      it('the stage composes on one screen in the worst state — no scroll', () => {
        // felt + stops + actions + the gaps outside the felt's span
        // reconstruct H exactly: nothing is left to scroll.
        expect(b.felt + b.stopsH + b.actionsH + 2 * L.rowGap).toBeLessThanOrEqual(b.H + 0.001);
        expect(b.felt).toBeGreaterThan(0);
      });
      it('the rail (hero + share + line) fits beside the felt in bound and waiting states', () => {
        expect(b.railBound).toBeLessThanOrEqual(b.felt);
        expect(b.railWaiting).toBeLessThanOrEqual(b.felt);
      });
      it('the felt keeps its reduced floor and a seat still fits its row', () => {
        expect(b.felt).toBeGreaterThanOrEqual(L.feltMin);
        expect(L.feltMin).toBeLessThan(CH.feltMin); // the floor really did drop for landscape
        expect(b.seatBlock).toBeLessThanOrEqual(b.rowH);
        expect(b.face).toBeGreaterThanOrEqual(32);
      });
      it('the share row and the stops bar still clear the 44px tap floor', () => {
        expect(b.shareH).toBeGreaterThanOrEqual(44);
        expect(b.stopsH).toBeGreaterThanOrEqual(44);
      });
    });
  }
});

/** ---- tap-target floor (design audit D4, story.css portion) ----
 * Every story action the census flagged carries an explicit 44px
 * floor in story.css — its own rule, the floor block, or the
 * .story-shell .btn family rule. Parsed here as the maximum
 * min-height among the selector's rules (equal-specificity cascade:
 * the last rule wins, and the floor rules are the last word). */
const minHeightsFor = (selector: string) => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, ''); // comments carry commas; keep them out of selector lists
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc} \\{[^}]*\\}`, 'g');
  const vals = [...bare.matchAll(re)].map((m) => {
    const mh = m[0].match(/min-height: (\d+)px/);
    return mh ? parseFloat(mh[1]!) : 0;
  });
  // grouped rules (selector lists) — the floor block lists several
  // selectors over one shared rule; count it for each member.
  const grouped = [...bare.matchAll(/([^{}]+) \{[^}]*min-height: (\d+)px/g)]
    .filter((m) => m[1]!.split(',').map((x) => x.trim()).includes(selector))
    .map((m) => parseFloat(m[2]!));
  return Math.max(0, ...vals, ...grouped);
};

describe('story tap targets meet the 44px floor (design audit D4)', () => {
  const floored: Array<[string, string]> = [
    ['back / home buttons in the story topbar', '.story-topbar .btn'],
    ['scene + tape action rows (Skip / Next / CTA)', '.story-script-actions .btn'],
    ['outro action row', '.story-outro-actions .btn'],
    ['intro exit row (Back to map)', '.story-intro-actions .btn'],
    ['mode toggle on the hub screens', '.story-mode-toggle .btn'],
    ['room share row — Copy invite link (inside the stage share budget)', '.story-room-share .btn'],
    ['room stop chips', '.story-room-stoprow .btn'],
    ['room actions — Ready / Leave', '.story-room-actions .btn'],
    ['in-game concede cluster (outside .story-shell)', '.story-room-concede .btn'],
    ['co-op share row buttons', '.story-coop-share-row .btn'],
    ['co-op friend Invite buttons', '.story-coop-friend .btn'],
    ["the King's finale choice buttons", '.story-finale-choice .btn'],
    ["Dee's rundown listen controls", '.dee-rundown-controls .btn'],
    ['badge chips', '.story-badge'],
    ['owner reset tool buttons', '.story-reset .btn'],
    ['gate choice cards', '.story-gate-card'],
    ['co-op run rows', '.story-coop-run'],
  ];
  for (const [label, selector] of floored) {
    it(`${label} (${selector}) floors at 44px`, () => {
      expect(minHeightsFor(selector)).toBeGreaterThanOrEqual(44);
    });
  }
  it('the egg hotspot is at least 44px in both dimensions', () => {
    const spot = css.match(/\.story-hotspot \{[^}]*\}/)![0];
    expect(parseFloat(spot.match(/width: (\d+)px/)![1]!)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(spot.match(/height: (\d+)px/)![1]!)).toBeGreaterThanOrEqual(44);
    expect(minHeightsFor('.story-hotspot')).toBeGreaterThanOrEqual(44);
  });
});

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
