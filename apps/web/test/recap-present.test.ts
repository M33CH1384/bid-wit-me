/**
 * Recap presentation (owner reports, 2026-10-21, Mac):
 *
 *  1. "This screen should be reworked for large screens." The recap sheet
 *     rendered as a phone-width column pinned to the LEFT of a desktop
 *     window (the ≥900px tablet-rail pin: justify-content:flex-start and
 *     .tt at 452px) with most of the screen empty black. A ≥1024px layer
 *     now centers the sheet and opens it into two regions (scores/hands
 *     rail + side cards); below 1024px nothing changes.
 *
 *  2. "The animation happened before we got to the screen so I never saw
 *     it." A fresh set cover's CSS clock started at MOUNT — under the
 *     sheet's fade-up entrance, and (single-column layout) with the set
 *     side's card below the fold of the sheet's scrollport — so it
 *     finished unseen. Two gates now hold a fresh cover at its first
 *     frame until it can actually be watched: the backdrop's .presented
 *     (entrance complete, Intermission) and the cover's own .sc-wait
 *     (its card observed in view, SetCover). The finale's --sc-delay
 *     counts from the lift, so 3 THE HARD WAY → finale order holds.
 *
 *  Also pinned: the third-set ending takes the same decided-recap hold
 *  as a shot-out — its flash and finale live in that recap, and Table
 *  used to route it straight to the results modal. The DOM timing half
 *  (the gates lifting in order) lives in recap-present-dom.test.ts —
 *  happy-dom rewrites import.meta.url, so the file-reading pins stay in
 *  this node-environment file.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameResult, type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';
import { SetCover } from '../src/animfx/SetCover';
import { clearTeamHoles } from '../src/shotMarks';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const animCss = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');
const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

/* ---------- fixtures (same construction as set-anims.test.ts) ---------- */

function toHandOver(): GameState {
  const rules = makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, 'recap-present');
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

function stamp(st: GameState, sideShots: number[][], opts: { lost?: number[]; thirdSet?: boolean } = {}): GameState {
  const last = st.history.at(-1)!;
  const history = sideShots.map((shotSides, i) => ({
    ...last,
    handNo: i + 1,
    bids: last.bids.map(() => 4),
    sides: last.sides.map((s) => ({
      ...s,
      contract: 4,
      contractMade: shotSides.includes(s.side) ? false as const : true,
      contractTricks: shotSides.includes(s.side) ? 1 : 4,
      ...(opts.lost?.includes(s.side) && i === sideShots.length - 1 ? { out: true } : {}),
    })),
  }));
  const result = opts.lost ? {
    endReason: (opts.thirdSet ? 'third-set' : 'shotOut') as GameResult['endReason'],
    shotOut: opts.lost,
    finalScores: st.scores,
    placements: st.scores.map(() => 1),
    winners: [0],
  } : null;
  return { ...st, rules: { ...st.rules, shotOut: true }, result, history, handNo: history.length, phase: opts.lost ? 'gameOver' : 'handOver' };
}

const NAMES = ['You', 'Hana', 'Mei', 'Jamal'];
const PORCH = { storyStopId: 'porch', venueId: 'grandma', setting: 'auto' };
const recapEl = (st: GameState) => createElement(Intermission, {
  st, names: NAMES, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
  onReady: () => {}, onScorePad: () => {}, onChat: () => {}, setAnimCtx: PORCH,
});

/* ---------- 1. the large-screen layer ---------- */

describe('large screens: the recap centers and opens into two regions', () => {
  const block = css.slice(css.indexOf('Hand recap on large screens'));

  it('has a ≥1024px layer, after (so it overrides) the ≥900px tablet-rail pin', () => {
    expect(css.indexOf('@media (min-width: 1024px)')).toBeGreaterThan(css.indexOf('@media (min-width: 900px)'));
    expect(block).toContain('@media (min-width: 1024px)');
  });

  it('centers the backdrop and widens the sheet', () => {
    expect(block).toContain('.tt-backdrop { justify-content: center; }');
    expect(block).toContain('.tt { width: min(1040px, 100%); }');
  });

  it('lays the body out as scores rail + side cards (review entries live in the header, not the grid)', () => {
    expect(block).toContain('grid-template-areas: "scores recap" "strip recap" "callouts recap"');
    expect(block).toContain('.tt-top-scores { grid-area: scores;');
    expect(block).toContain('.tt-strip { grid-area: strip;');
    expect(block).toContain('.tt-recap { grid-area: recap;');
    expect(block).not.toContain('.tt-run');
    expect(block).not.toContain('grid-area: tricks');
  });

  it('is theme-agnostic (same structure in Classic and Neon — parity law)', () => {
    expect(block).not.toContain('data-theme');
  });

  it('leaves the phone/base rules byte-identical underneath', () => {
    expect(css).toContain('.tt { width: min(560px, 100%);');
    expect(css).toContain('.tt { width: 452px; flex: none; }'); // the ≥900px pin stays for 900–1023
    expect(css).toMatch(/\.tt-body \{[^}]*display: flex; flex-direction: column/);
  });
});

/* ---------- 2a. the gate CSS ---------- */

describe('the presentation gates: CSS holds fresh covers at frame one', () => {
  it('pauses a waiting cover and everything inside it', () => {
    expect(animCss).toContain('.setcover.sc-wait, .setcover.sc-wait *');
    expect(animCss).toContain('animation-play-state: paused');
  });

  it('pauses every fresh cover (and the tape-in jolt) until the backdrop is presented', () => {
    expect(animCss).toContain('.tt-backdrop:not(.presented) .setcover.fresh, .tt-backdrop:not(.presented) .setcover.fresh *');
    expect(animCss).toContain('.tt-backdrop:not(.presented) .tt-team.tape-in');
  });
});

/* ---------- 2b. the gates at first render (SSR: no effects have run) ---------- */

describe('the gates start closed', () => {
  beforeEach(() => clearTeamHoles());

  it('the backdrop renders unpresented; a fresh house cover renders waiting', () => {
    const html = renderToStaticMarkup(recapEl(stamp(toHandOver(), [[], [1]])));
    expect(html).toContain('data-presented="no"');
    expect(html).not.toContain('tt-backdrop presented');
    expect(html).toContain('data-testid="recap-setanim-1"');
    expect(html).toContain('data-mode="fresh"');
    expect(html).toContain('data-wait="yes"');
    expect(html).toContain('sc-wait');
  });

  it('static and reduced covers never wait — their end state is the presentation', () => {
    const statik = renderToStaticMarkup(createElement(SetCover, { animId: 'porch', tier: 'regular', mode: 'static', reduced: false, side: 1 }));
    expect(statik).not.toContain('sc-wait');
    expect(statik).not.toContain('data-wait');
    const reduced = renderToStaticMarkup(createElement(SetCover, { animId: 'porch', tier: 'finale', mode: 'fresh', reduced: true, side: 1 }));
    expect(reduced).not.toContain('sc-wait');
    expect(reduced).not.toContain('data-wait');
  });

  it('a third-set decided recap: winner flow, flash, and the finale — gated, delay intact', () => {
    const html = renderToStaticMarkup(recapEl(stamp(toHandOver(), [[1], [], [1], [], [1]], { lost: [1], thirdSet: true })));
    expect(html).toContain('data-decided="yes"');
    expect(html).toContain('See final results');
    expect(html).toContain('data-testid="hardway-flash"');
    expect(html).toContain('data-tier="finale"');
    expect(html).toContain('--sc-delay:2300ms');
    expect(html).toContain('data-wait="yes"');
  });
});

/* ---------- the third-set decided-recap hold in Table ---------- */

describe('Table routes a third-set ending through the decided recap', () => {
  it('the hold covers shotOut and third-set alike (its flash + finale live there)', () => {
    expect(tableSrc).toContain("(st.result?.endReason === 'shotOut' || st.result?.endReason === 'third-set') && !shotRecapAck");
  });
});
