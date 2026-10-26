/**
 * @vitest-environment happy-dom
 *
 * HOME STAGE FIT (2026-10-25, owner screenshots, portrait + landscape):
 * the design audit proved Home was geometrically legal (nothing clipped,
 * nothing overlapping) while its composition plainly wasn't — the owner
 * opened the app to a top-loaded stack over a dead void, and a sound dock
 * sitting in a stray box off the header row. Geometry-pass is not
 * design-pass; these pins hold the composition itself.
 *
 * THE VOID. .wiz-home was justify-content:center: splash + actions lumped
 * into one centered block. Measured on the shipped build (Chromium,
 * stage = header bottom → ticker reserve): bottom void 26–35% of the
 * stage in the plain state at every portrait size (31.3% at 390×844),
 * hero parked at 23–33%. Fix: .wiz-home is a five-row grid stage —
 * air / hero / breath / actions / settle — whose fr shares distribute
 * extra height proportionally at both ends (floors keep short screens
 * tight). The budget below re-resolves that grid from the shipped
 * constants over the measured content heights of all three home states
 * (plain / story rows / resume + story rows) and fails if any state at
 * any size re-top-loads: hero must open in the top 5–30% of the stage
 * and the settle under the last action may not exceed 15%.
 *
 * THE DOCK. Two defects met in the wizard header. (1) The step dots are
 * invisible on the home step but still reserved 150px of the flex row, so
 * chip + phantom dots + the right cluster summed past the bar's content
 * box below ~428px and pushed the dock slot off the right edge — on the
 * home step the dots now leave the flow (display:none; they were already
 * invisible). (2) A dock portaled into the wizard slot kept the fixed
 * base rule's top/right offsets; as a position:relative box those
 * displace it from its seat — down 10px + the device's top safe-area
 * inset in portrait (a full row on an iPhone), left 8px + the right
 * inset in landscape (~57px on a notched phone: across the gear, onto
 * Social, its seat left empty at the corner). The shared slotted rule
 * zeroes the offsets (rogue-dock fix, a9518a15), so a slotted dock's
 * rect IS its slot's rect — in line with social/gear, zero overlap, at
 * any inset, either orientation; this suite pins that Home's seat
 * stands on that contract, plus the header budget that keeps the seat
 * on-screen. (happy-dom has no layout: seating is pinned as the CSS
 * contract + the header budget; the Chromium harness numbers live in
 * the build report.)
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { themeStore } from '../src/theme';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');

/* ---------- the stage grid, resolved from the shipped constants ---------- */

type Track = { floor: number; fr: number } | { auto: true };
function parseStageTracks(): Track[] {
  const m = css.match(/\.wiz-home\s*\{[^}]*grid-template-rows:\s*([^;]+);/);
  expect(m, '.wiz-home carries a grid-template-rows stage').toBeTruthy();
  return parseTracksRaw(m![1]);
}
function parseTracksRaw(spec: string): Track[] {
  const out: Track[] = [];
  const re = /minmax\(\s*([\d.]+)px\s*,\s*([\d.]+)fr\s*\)|auto/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(spec))) {
    if (mm[0] === 'auto') out.push({ auto: true });
    else out.push({ floor: parseFloat(mm[1]), fr: parseFloat(mm[2]) });
  }
  return out;
}

/** Resolve flexible tracks the way CSS Grid does: unit = free / Σfr over
 * unfrozen tracks; a track whose floor beats its share freezes at the
 * floor and the unit recomputes without it. */
function resolveFlex(tracks: Track[], free: number): number[] {
  const sizes = tracks.map((t) => ('auto' in t ? 0 : t.floor));
  const flexIdx = tracks.map((t, i) => ('fr' in t ? i : -1)).filter((i) => i >= 0);
  let remaining = free;
  let open = [...flexIdx];
  for (let guard = 0; guard < 8 && open.length; guard++) {
    const sumFr = open.reduce((s, i) => s + (tracks[i] as { fr: number }).fr, 0);
    const unit = remaining / sumFr;
    const freezing = open.filter((i) => (tracks[i] as { floor: number }).floor > unit * (tracks[i] as { fr: number }).fr);
    if (!freezing.length) {
      for (const i of open) sizes[i] = unit * (tracks[i] as { fr: number }).fr;
      break;
    }
    for (const i of freezing) { sizes[i] = (tracks[i] as { floor: number }).floor; remaining -= sizes[i]; }
    open = open.filter((i) => !freezing.includes(i));
  }
  return sizes;
}

describe('home stage: the grid distributes the full height', () => {
  it('ships a five-row stage: air / hero / breath / actions / settle', () => {
    const tracks = parseStageTracks();
    expect(tracks.length).toBe(5);
    expect('auto' in tracks[1]).toBe(true);
    expect('auto' in tracks[3]).toBe(true);
    for (const i of [0, 2, 4]) expect((tracks[i] as { fr: number }).fr).toBeGreaterThan(0);
    // the breath between hero and actions is the largest share; the
    // settle under the actions is the smallest — air at both ends, never
    // one void parked under the stack
    const fr = (i: number) => (tracks[i] as { fr: number }).fr;
    expect(fr(2)).toBeGreaterThan(fr(0));
    expect(fr(0)).toBeGreaterThan(fr(4));
    expect(css).toContain('.wiz-home .splash { grid-row: 2; }');
    expect(css).toContain('.wiz-home .wiz-actions { grid-row: 4; }');
  });

  it('landscape phones leave the grid for the side-by-side row', () => {
    const block = css.match(/@media \(orientation: landscape\) and \(max-height: 540px\) \{([\s\S]*?)\n\}/);
    expect(block).toBeTruthy();
    expect(block![1]).toMatch(/\.wiz-home \{ display: flex;/);
  });

  // Content heights measured on the shipped build (Chromium harness,
  // 2026-10-25) for the three home states — plain (PLAY + story row),
  // story (PLAY + resume signpost + entry row), full (RESUME + PLAY +
  // both story rows) — at the portrait matrix heights.
  const CASES: [string, number, number, number][] = [
    ['plain 375×667', 541, 109.1, 149], ['plain 390×844', 718, 112.3, 149],
    ['plain 430×932', 806, 121, 149], ['plain 768×1024', 898, 138.4, 149],
    ['plain 1920×1080', 954, 138.4, 149],
    ['story 375×667', 541, 109.1, 235], ['story 390×844', 718, 112.3, 235],
    ['story 430×932', 806, 121, 235], ['story 768×1024', 898, 138.4, 215],
    ['story 1920×1080', 954, 138.4, 215],
    ['full 375×667', 541, 109.1, 332], ['full 390×844', 718, 112.3, 332],
    ['full 430×932', 806, 121, 332], ['full 768×1024', 898, 138.4, 312],
    ['full 1920×1080', 954, 138.4, 312],
  ];
  it.each(CASES)('%s: hero opens 5–30% down the stage, settle ≤15%', (_label, homeH, splashH, actionsH) => {
    const tracks = parseStageTracks();
    const content = splashH + actionsH;
    const free = Math.max(0, homeH - content);
    const sizes = resolveFlex(tracks, free);
    const stageH = homeH + 32; // .wiz-step padding: 8 top + 24 bottom
    const heroTopShare = (8 + sizes[0]) / stageH;
    const settleShare = (sizes[4] + 24) / stageH;
    expect(heroTopShare).toBeGreaterThanOrEqual(0.05);
    expect(heroTopShare).toBeLessThanOrEqual(0.30);
    expect(settleShare).toBeLessThanOrEqual(0.15);
    // and the whole free height is accounted for — nothing is parked
    const used = sizes[0] + sizes[2] + sizes[4];
    expect(Math.abs(used - free)).toBeLessThan(1.5);
  });
});

describe('landscape phones: the full stack stays clear of the ticker', () => {
  const socialCss = read('../src/social/social.css');
  const land = css.match(/@media \(orientation: landscape\) and \(max-height: 540px\) \{([\s\S]*?)\n\}/)![1];

  it('home rows compress a step inside the landscape block', () => {
    expect(land).toMatch(/\.wizard\.step-home \.wiz-step \{ padding-top: 48px; padding-bottom: 12px; \}/);
    expect(land).toMatch(/\.wiz-home \.hero-btn \{ min-height: 64px; padding: 9px 16px; \}/);
    expect(land).toMatch(/\.wiz-home \.quiet-row \{ min-height: 46px; padding: 9px 14px; \}/);
  });

  it('full state (RESUME + PLAY + signpost + entry): the last row clears the ticker at 375/390px heights', () => {
    const reserve = parseFloat(socialCss.match(/html\.bwm-ticker-on \.wizard \{ padding-bottom: calc\(([\d.]+)px/)![1]);
    const gap = parseFloat(land.match(/\.wiz-actions \{[^}]*gap: ([\d.]+)px/)![1]);
    // content heights measured on the shipped build: hero 51 (83 − 2×16
    // base padding); entry row 24 (52 − 2×14); the signpost is the tall
    // one — 66 of content at phone-landscape widths (94 − 2×14), where
    // its title wraps to two lines beside the pair chip and the chip
    // wraps under it at 667px wide
    const hero = Math.max(64, 51 + 2 * 9);
    const signpost = Math.max(46, 66 + 2 * 9);
    const entry = Math.max(46, 24 + 2 * 9);
    const column = hero * 2 + signpost + entry + gap * 3;
    for (const vh of [375, 390]) {
      const lastRowBottom = 48 + column; // home step padding-top + the column
      const tickerTop = vh - reserve;
      expect(lastRowBottom, `last row bottom ${lastRowBottom} vs ticker top ${tickerTop} @${vh}`).toBeLessThanOrEqual(tickerTop);
    }
    // tap floors survive the compression
    for (const h of [hero, signpost, entry]) expect(h).toBeGreaterThanOrEqual(44);
  });
});

/* ---------- the header: every control fits, the dock sits in its seat --- */

const px = (re: RegExp, label: string) => {
  const m = css.match(re);
  expect(m, label).toBeTruthy();
  return parseFloat(m![1]);
};

describe('home header: the row fits at phone widths, dots phantom removed', () => {
  it('the invisible home-step dots leave the flex flow', () => {
    expect(css).toMatch(/\.wizard\.step-home \.wiz-dots \{ display: none; \}/);
    // other steps keep their visible progress dots untouched
    expect(css).toContain('.wiz-dots { display: flex; gap: 7px; }');
  });

  it('chip + right cluster fit the smallest portrait bar with room to spare', () => {
    const side = px(/\.wiz-bar \{[^}]*padding: 10px ([\d.]+)px 0/, 'bar side padding');
    const icon = px(/\.icon-btn \{\s*width: ([\d.]+)px/, 'icon button width');
    const slot = px(/\.wiz-right \.dock-slot \{ width: ([\d.]+)px/, 'wizard slot width');
    const gap = px(/\.wiz-right \{ display: flex; align-items: center; gap: ([\d.]+)px/, 'wiz-right gap');
    // measured caps at HEAD: social (icon-only in portrait) 47.4 → 48;
    // identity chip (avatar + name + level) capped generously at 150.
    const socialCap = 48, chipCap = 150;
    const total = side * 2 + chipCap + socialCap + icon /* gear */ + slot + gap * 2;
    expect(total).toBeLessThan(375); // smallest portrait phone in the matrix
    // with the phantom dots (150px) the same row summed to ~480 — the
    // overflow that pushed the slot off-screen; they no longer count.
  });
});

describe('the dock, seated in the wizard header', () => {
  it('the shared slotted rule zeroes the fixed offsets, so the wizard seat is exact', () => {
    // landed with the rogue-dock fix (a9518a15): a slotted dock's rect IS
    // its slot's rect — in the wizard header that means in line with
    // social/gear, zero overlap, at any safe-area inset, either
    // orientation. Home's seating stands on this contract.
    expect(css).toContain('.sound-dock.slotted { position: relative; top: auto; right: auto; width: 100%; height: 100%; display: block; }');
  });

  it('the slotless fixed fallback is untouched (other surfaces keep it)', () => {
    const base = css.match(/\.sound-dock \{\s*position: fixed;[^}]*top: calc\(6px/);
    expect(base).toBeTruthy();
    // the D1 portal fill contract itself is unchanged
    expect(css).toContain('.sound-dock.slotted .dock-btn { width: 100% !important; height: 100% !important; }');
  });
});

/* ---------- structure: the markup the composition stands on ------------- */

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}
afterEach(() => {
  unmount();
  act(() => themeStore.set('classic'));
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

async function renderThemed(theme: 'classic' | 'neon', node: ReactNode) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    themeStore.set(theme);
    root!.render(node);
  });
  return el;
}

describe('home structure under both themes', () => {
  it.each(['classic', 'neon'] as const)('%s: stage children in order, slot inside the header cluster', async (theme) => {
    const c = await renderThemed(theme, createElement(Setup, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onStart: () => {},
    }));
    const home = c.querySelector('.wiz-home');
    expect(home).toBeTruthy();
    const kids = [...home!.children].map((n) => (n as HTMLElement).className);
    expect(kids).toEqual(['splash', 'wiz-actions']);
    // the dock's seat is the header's right cluster, in line with
    // social + gear — the markup never moved; the CSS seats it there
    const slot = c.querySelector('.wiz-bar .wiz-right .dock-slot');
    expect(slot).toBeTruthy();
    expect(slot!.parentElement!.querySelector('.icon-btn.gear')).toBeTruthy();
    // dots markup still exists (CSS removes it from home flow only)
    expect(c.querySelector('.wiz-bar .wiz-dots')).toBeTruthy();
  });
});

describe('home backdrop art: the Neon layer covers the stage (owner, 2026-10-26)', () => {
  // The owner, with the composition fix already live: "The photo in the
  // background should cover the white space here." The grid above
  // distributes the stage's air, but the Neon emblem layer was boxed
  // into a 252px medallion at the hero — so the distributed breath
  // between the tagline and the actions read as a dead band of bare
  // page (art over at ~40% of the screen, buttons at ~62%). The layer
  // is now the stage's backdrop. These pins hold the coverage from the
  // shipped CSS, in the same stage accounting as the grid suite.
  const beforeRule = () => {
    const m = css.match(/html\[data-theme="neon"\] \.wiz-home::before \{([^}]*)\}/);
    expect(m, 'the neon home ::before rule exists').toBeTruthy();
    return m![1];
  };

  it('the art box spans the whole stage, not a hero medallion', () => {
    const rule = beforeRule();
    expect(rule).toContain('inset: 0');
    expect(rule).not.toContain('width: min(62vw, 252px)');
    expect(rule).not.toContain('contain');
    // decoration contract unchanged: behind everything, never a target
    expect(rule).toContain('pointer-events: none');
  });

  it('the painting covers hero + breath and reaches into the actions zone', () => {
    const rule = beforeRule();
    const sizeM = rule.match(/\/ auto (\d+(?:\.\d+)?)%/);
    expect(sizeM, 'the emblem paints height-driven off the stage box').toBeTruthy();
    const pct = parseFloat(sizeM![1]);
    const posM = rule.match(/no-repeat 50% -(\d+(?:\.\d+)?)px/);
    const lift = posM ? parseFloat(posM[1]) : 0;
    const tracks = parseStageTracks();
    // the phone portrait matrix from the grid suite (stage height,
    // splash height, actions height per state)
    const CASES: [string, number, number, number][] = [
      ['plain 375×667', 541, 109.1, 149], ['story 375×667', 541, 109.1, 235],
      ['plain 390×844', 718, 112.3, 149], ['story 390×844', 718, 112.3, 235],
      ['full 390×844', 718, 112.3, 332],
      ['story 430×932', 806, 121, 235], ['full 430×932', 806, 121, 332],
    ];
    for (const [label, homeH, splashH, actionsH] of CASES) {
      const sizes = resolveFlex(tracks, homeH - splashH - actionsH);
      const actionsTop = sizes[0] + splashH + sizes[2];
      const paintedBottom = (pct / 100) * homeH - lift;
      // the art must paint PAST the top of the actions block — the
      // whole breath is art-covered, and the fade (mask, below) is
      // what ends it inside the actions zone, never a bare gap
      expect(paintedBottom, `${label}: painted art bottom vs actions top`).toBeGreaterThan(actionsTop + 24);
    }
  });

  it('the mask grades the art out inside the stage: strong core, gone before the bottom', () => {
    const rule = beforeRule();
    const maskM = rule.match(/mask-image: radial-gradient\(ellipse (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)% at 50% (\d+(?:\.\d+)?)%, #000 (\d+(?:\.\d+)?)%, transparent (\d+(?:\.\d+)?)%\)/);
    expect(maskM, 'the backdrop keeps its radial grade').toBeTruthy();
    const [, , , centerY, solid, clear] = maskM!.map(Number);
    // anchored on the hero (center in the top third), opaque through
    // the hero and the breath's start, fully transparent before the
    // stage's bottom edge — no hard cutoff anywhere
    expect(centerY).toBeLessThanOrEqual(30);
    expect(solid).toBeGreaterThanOrEqual(50);
    expect(clear).toBeLessThanOrEqual(90);
  });

  it('wide screens bleed the backdrop past the centered column, mask completing inside', () => {
    const wide = css.match(/@media \(min-width: 700px\) \{([\s\S]*?)\n\}/);
    expect(wide, 'a wide-screen backdrop regime exists').toBeTruthy();
    expect(wide![1]).toContain('.wiz-home::before');
    expect(wide![1]).toContain('width: min(1056px, 100vw)');
    expect(wide![1]).toContain('background-size: cover');
  });

  it('landscape phones re-seat the art behind the splash column, fully feathered', () => {
    const land = css.match(/@media \(orientation: landscape\) and \(max-height: 520px\) \{([\s\S]*?)\n\}/);
    expect(land, 'the short-landscape block exists').toBeTruthy();
    const seg = land![1].match(/\.wiz-home::before \{([^}]*)\}/);
    expect(seg, 'landscape re-seats the backdrop').toBeTruthy();
    // the old medallion width must not come back (it would break the
    // stage-spanning box), and the landscape mask must finish fading
    // well inside the stage so no image edge shows against the page
    expect(seg![1]).not.toContain('width: 148px');
    const maskM = seg![1].match(/transparent (\d+(?:\.\d+)?)%/);
    expect(maskM).toBeTruthy();
    expect(parseFloat(maskM![1])).toBeLessThanOrEqual(80);
    // the ace accent sits in the splash column, not over the actions
    expect(land![1]).toMatch(/\.wiz-home::after \{[^}]*right: calc\(50% \+ 8px\)/);
  });

  it('the art layer is Neon-only: Classic carries no home art layer to strand', () => {
    // every .wiz-home::before/::after rule in the stylesheet is scoped
    // to the Neon theme — Classic's backdrop is the wizard's own
    // full-stage gradient, which has no "art ends here" edge
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .map((m) => m[1])
      .filter((s) => s.includes('.wiz-home::before') || s.includes('.wiz-home::after'));
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toContain('html[data-theme="neon"]');
  });
});
