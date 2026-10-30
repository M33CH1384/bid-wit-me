/**
 * @vitest-environment happy-dom
 *
 * COUNT-UP PERFORMANCE (owner, 2026-10-30: "as it counts up here the
 * rolling numbers should change colors and enlarge to give a more
 * engaging effect"). Pins the treatment on the rewards screen:
 *  - every rolling number (postgame final scores, XP earned, coins,
 *    rating delta, playing-well XP) GROWS by transform scale only and
 *    its color TRAVELS while it counts;
 *  - crossing a round milestone (10 XP, 50 points) fires a micro-pulse —
 *    a visible extra beat of scale on the crossing frame;
 *  - the landing pops (settle overshoot) and then ALL inline styling
 *    comes off: the resting DOM is byte-for-byte the old plain number,
 *    at exactly the payload value;
 *  - a negative tally counts DOWN through the cooling ramp to its exact
 *    negative value;
 *  - the no-change rating does not perform at all;
 *  - reduced motion renders final values instantly, no roll spans.
 *
 * Same harness as rewards-reveal.test.ts: manual rAF queue + fake timers.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import GameOverRewards, { computeRewards, tallyTone, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';
import { BoxScore } from '../src/BoxScore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ fixtures */

function profile(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return {
    level: { level: 8, xp: 1000, title: 'Prospect', xpForNext: 300, xpIntoLevel: 83 },
    coins: { balance: 1250 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
    ...over,
  };
}

/** Win: +50 XP, +150 coins, rating 1000 → 1012, playing-well +8 XP,
 *  postgame 152 / −80 (the owner's screenshot game). */
function winData(): RewardsData {
  const after = profile({
    level: { level: 8, xp: 1050, title: 'Prospect', xpForNext: 300, xpIntoLevel: 133 },
    coins: { balance: 1400 },
    rank: { team: { elo: 1012 }, cutthroat: { elo: 1000 } },
    playWell: {
      gameId: 'g-win', xp: 8, coins: 0,
      lines: [
        { id: 'set2', label: 'Set the opponents ×2', xp: 4, coins: 0 },
        { id: 'dom', label: 'Domination — won by 232', xp: 4, coins: 0 },
      ],
    },
  });
  const d = computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '3 hands played', kind: 'team' });
  d.postgame = {
    sides: [
      { label: 'Homies', score: 152, books: 17, nilsMade: 0 },
      { label: 'Cookout Champs', score: -80, books: 22, nilsMade: 0 },
    ],
    myBooks: 10,
    myNilsMade: 0,
    moments: ['Your best hand: +52 points in hand 3'],
  };
  return d;
}

/** Loss: +25 XP consolation, rating 1012 → 1000 (down 12), postgame −80 / 152. */
function lossData(): RewardsData {
  const before = profile({ rank: { team: { elo: 1012 }, cutthroat: { elo: 1000 } } });
  const after = profile({
    level: { level: 8, xp: 1025, title: 'Prospect', xpForNext: 300, xpIntoLevel: 108 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
  });
  const d = computeRewards(before, after, { won: false, headline: 'GAME OVER', sub: '3 hands played', kind: 'team' });
  d.postgame = {
    sides: [
      { label: 'Homies', score: -80, books: 17, nilsMade: 0 },
      { label: 'Cookout Champs', score: 152, books: 22, nilsMade: 0 },
    ],
    myBooks: 10,
    myNilsMade: 0,
    moments: [],
  };
  return d;
}

/** Same win but the rating did not move (bot game): the 1,000 must just appear. */
function noChangeData(): RewardsData {
  const d = winData();
  d.eloBefore = 1000;
  d.eloAfter = 1000;
  return d;
}

/* ------------------------------------------------------- raf + mounting */

let rafQ: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;

function pumpFrame(ts: number) {
  const q = rafQ;
  rafQ = [];
  act(() => { for (const f of q) f.cb(ts); });
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

let container: HTMLDivElement;
let root: Root;

function mount(data: RewardsData) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(GameOverRewards, {
      data,
      onHome: () => undefined,
      onRematch: () => undefined,
      onProfile: () => undefined,
      onOpenTables: () => undefined,
    }));
  });
}

const page = () => container.querySelector('.rewards-page')!;
const nums = () => [...container.querySelectorAll('.rw-row .rw-num')].map((n) => n.textContent ?? '');
const scoreCells = () => [...container.querySelectorAll('[data-testid="postgame-report"] tbody tr')].slice(0, 2).map((tr) => tr.querySelector('td')?.textContent ?? '');
const rollSpans = () => [...container.querySelectorAll<HTMLElement>('.roll-num')];
const xpSpan = () => rollSpans().find((s) => (s.textContent ?? '').startsWith('+') && s.closest('.rw-row')?.querySelector('span')?.textContent === 'XP earned');
const scaleOf = (el: HTMLElement) => {
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
  return m ? parseFloat(m[1]!) : 1;
};
const rgbOf = (el: HTMLElement) => {
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(el.style.color);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] as const : null;
};

function openGate() {
  pumpFrame(0);
  pumpFrame(16);
  expect(page().classList.contains('rw-play')).toBe(true);
}

/** Pump frames at a steady step until `cond` holds (or the cap runs out). */
function pumpUntil(cond: () => boolean, startTs: number, stepMs = 50, maxFrames = 80): number {
  let ts = startTs;
  for (let i = 0; i < maxFrames && !cond(); i++) {
    ts += stepMs;
    pumpFrame(ts);
  }
  return ts;
}

beforeEach(() => {
  rafQ = [];
  rafSeq = 0;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQ.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQ = rafQ.filter((f) => f.id !== id); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------- tests */

describe('count-up performance', () => {
  it('pre-gate: counters and final scores sit plainly at zero — no roll spans yet', () => {
    mount(winData());
    expect(nums()).toEqual(['+0', '+0', '▲ 0', '+0 XP']);
    expect(scoreCells()).toEqual(['0', '0']);
    expect(rollSpans()).toHaveLength(0);
  });

  it('mid-count the XP number is enlarged and its color is traveling (not yet the resting white)', () => {
    mount(winData());
    openGate();
    advance(200); // XP row delay
    pumpFrame(1000); // tween start frame
    pumpUntil(() => {
      const s = xpSpan();
      return !!s && Number((s.textContent ?? '+0').slice(1)) >= 20;
    }, 1000);
    const s = xpSpan()!;
    expect(s).toBeTruthy();
    expect(s.dataset.roll).toBe('rolling');
    expect(scaleOf(s)).toBeGreaterThan(1.05);
    const rgb = rgbOf(s)!;
    expect(rgb).toBeTruthy();
    expect(rgb).not.toEqual([255, 255, 255]); // has not landed on the resting color
    expect(rgb).not.toEqual([179, 167, 204]); // and has left the resting muted start
    // digit widths stay tabular: the span lives inside .rw-num (tabular-nums)
    expect(s.closest('.rw-num')).toBeTruthy();
  });

  it('milestone pulse: the frame the count crosses +10 carries an extra beat of scale', () => {
    mount(winData());
    openGate();
    advance(200);
    pumpFrame(1000);
    // step in fine frames; find the first frame whose value reaches +10 —
    // the crossing frame itself carries pulse = 1 (the full +0.055 beat on
    // top of growth: at +10 the eased progress is ~0.2, growth alone
    // would give only ~1.03 for a +50 count)
    let s: HTMLElement | undefined;
    let ts = 1000;
    for (let i = 0; i < 60; i++) {
      ts += 16;
      pumpFrame(ts);
      s = xpSpan();
      if (s && Number((s.textContent ?? '+0').slice(1)) >= 10) break;
      s = undefined;
    }
    expect(s).toBeTruthy();
    expect(scaleOf(s!)).toBeGreaterThan(1.06);
  });

  it('landing pops, then rests as the plain exact values with no spans left', () => {
    mount(winData());
    openGate();
    // run every count to done
    advance(2000);
    pumpUntil(() => nums()[0] === '+50' && scoreCells()[0] === '152', 100, 50, 60);
    // the settle pop: a done span is present, overshooting rest scale
    const done = rollSpans().filter((s) => s.dataset.roll === 'done');
    expect(done.length).toBeGreaterThan(0);
    expect(Math.max(...done.map(scaleOf))).toBeGreaterThan(1.04);
    // let the settle finish (timers) — every span comes off; counts that
    // finished on the last pumped frame need one more timer flush
    advance(1000);
    pumpFrame(5000);
    advance(1000);
    expect(rollSpans()).toHaveLength(0);
    expect(nums()).toEqual(['+50', '+150', '▲ 12', '+8 XP']);
    expect(scoreCells()).toEqual(['152', '-80']);
  });

  it('loss: the negative tally counts down through the cooling ramp to exactly −80; the rating falls red-ward', () => {
    mount(lossData());
    openGate();
    advance(250); // postgame score delay
    pumpFrame(1000);
    // mid-flight: my side's tally is a negative between 0 and −80
    let midNeg = '';
    pumpUntil(() => {
      midNeg = scoreCells()[0]!;
      const n = Number(midNeg);
      return n < -20 && n > -80;
    }, 1000);
    expect(Number(midNeg)).toBeLessThan(0);
    expect(Number(midNeg)).toBeGreaterThan(-80);
    // the −80 span's color travels the cool path: at mid-flight it is NOT
    // the warm gold of a winning tally
    const negSpan = rollSpans().find((s) => (s.textContent ?? '').startsWith('-'))!;
    expect(negSpan).toBeTruthy();
    const [r, g] = rgbOf(negSpan)!;
    expect(g).toBeLessThanOrEqual(r + 40); // lavender-cool, never gold-warm (gold has g close under r with b far lower)
    expect(rgbOf(negSpan)![2]).toBeGreaterThan(120); // blue channel stays high on the cool path
    // rating delta: run to a late frame and check it leans red (r > g)
    advance(520);
    pumpUntil(() => {
      const s = rollSpans().find((x) => (x.textContent ?? '').startsWith('▼'));
      return !!s && Number((s.textContent ?? '').replace('▼ ', '')) >= 10;
    }, 1000);
    const downSpan = rollSpans().find((x) => (x.textContent ?? '').startsWith('▼'))!;
    const [dr, dg] = rgbOf(downSpan)!;
    expect(dr).toBeGreaterThan(dg);
    // everything lands exact
    advance(2500);
    pumpUntil(() => scoreCells()[1] === '152', 2000, 50, 60);
    advance(1000);
    pumpFrame(6000);
    advance(1000);
    expect(rollSpans()).toHaveLength(0);
    expect(scoreCells()).toEqual(['-80', '152']);
    expect(nums()).toContain('▼ 12');
    expect(nums()).toContain('+25');
  });

  it('no-change rating never performs: no roll span in its row, value simply present', () => {
    mount(noChangeData());
    openGate();
    advance(2000);
    pumpUntil(() => nums()[0] === '+50', 100, 50, 60);
    advance(1000);
    pumpFrame(5000);
    advance(1000);
    const eloRow = [...container.querySelectorAll('.rw-row')].find((r) => r.textContent?.includes('Team rating'))!;
    expect(eloRow.querySelector('.roll-num')).toBeNull();
    expect(eloRow.querySelector('.rw-num')?.textContent).toBe('1,000');
    expect(rollSpans()).toHaveLength(0); // everyone else rested too
  });

  it('reduced motion: final values instantly, no roll spans at any point', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    mount(winData());
    expect(page().classList.contains('rw-reduced')).toBe(true);
    expect(nums()).toEqual(['+50', '+150', '▲ 12', '+8 XP']);
    expect(scoreCells()).toEqual(['152', '-80']);
    expect(rollSpans()).toHaveLength(0);
    pumpFrame(0);
    pumpFrame(16);
    advance(2000);
    expect(rollSpans()).toHaveLength(0);
    expect(nums()).toEqual(['+50', '+150', '▲ 12', '+8 XP']);
  });
});


/* ── The in-table victory overlay (owner, 2026-10-30: "Extend it there
   to") — the SAME count-up machinery, one implementation, drives the
   overlay's final tallies: the standings placements in Table.tsx and
   the box score's Final row (BoxScore's opt-in `roll`). Per-hand rows,
   headline lines and every other record stay static. ──────────────── */

/** A decided game with real history (one played hand) and stamped
 *  finals — the state the victory overlay renders. */
function decidedGame(finalScores: [number, number], winners: number[]): GameState {
  const rules = makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, 'countup-overlay');
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  // Placement follows the crown, not the points: a side can win a
  // shot-out ending while behind on score, and the sheet ranks it first.
  const placements = finalScores.map((_, i) => (winners.includes(i) ? 1 : 2));
  return { ...st, result: { endReason: 'target', finalScores: [...finalScores], placements, winners } };
}

function mountBox(st: GameState, opts: { roll?: boolean; reduced?: boolean } = {}): Root {
  const hosts = [...document.querySelectorAll('.box-host')];
  hosts.forEach((h) => h.remove());
  const hostEl = document.createElement('div');
  hostEl.className = 'box-host';
  document.body.appendChild(hostEl);
  root = createRoot(hostEl);
  act(() => {
    root.render(createElement(BoxScore, {
      st,
      label: (s: number) => ['Us', 'Them'][s]!,
      mySide: 0,
      winners: st.result!.winners,
      roll: opts.roll ?? true,
      reduced: opts.reduced ?? false,
    }));
  });
  return root;
}

const finalCells = () => [...document.querySelectorAll('[data-testid="box-final"] td b')];

describe('tallyTone — the overlay tally honesty rules', () => {
  it('the winner warms to gold whatever the sign of their score', () => {
    expect(tallyTone(500, true)).toBe('gainGold');
    expect(tallyTone(-20, true)).toBe('gainGold'); // shot-out: crowned while behind
    expect(tallyTone(0, true)).toBe('gainGold');
  });

  it('a non-winner never travels gold: negative cools, anything else stays flat', () => {
    expect(tallyTone(-80, false)).toBe('scoreLoss');
    expect(tallyTone(120, false)).toBe('scoreFlat');
    expect(tallyTone(0, false)).toBe('scoreFlat');
  });
});

describe('the victory overlay box score — Final row count-up', () => {
  it('rolls both finals in step with the standings and lands exactly; records stay static', () => {
    mountBox(decidedGame([152, -80], [0]));
    // The Final row's tallies perform; per-hand rows and headline lines
    // are records — no rolling element anywhere else in the section.
    expect(document.querySelectorAll('.box-score .roll-num')).toHaveLength(2);
    expect(document.querySelector('[data-testid="box-row-1"]')!.querySelector('.roll-num')).toBeNull();
    expect(document.querySelector('.box-lines')!.querySelector('.roll-num')).toBeNull();

    /* mid-flight: the winner is growing and traveling toward gold */
    advance(200); // the winner's roll starts (placement-1 delay)
    let ts = pumpUntil(() => Number(finalCells()[0]!.textContent) > 0, 0, 50);
    const [winCell, loseCell] = finalCells();
    const winV = Number(winCell!.textContent);
    expect(winV).toBeGreaterThan(0);
    expect(winV).toBeLessThan(152);
    const winSpan = winCell!.querySelector('.roll-num') as HTMLElement;
    expect(scaleOf(winSpan)).toBeGreaterThan(1);
    const [r, g, b] = rgbOf(winSpan);
    expect([r, g, b]).not.toEqual([245, 197, 66]); // traveling — not yet resting gold
    expect([r, g, b]).not.toEqual([179, 167, 204]); // and has left the muted start

    /* the loser's tally rolls down and never touches gold */
    advance(120); // theirs starts 120 ms later (placement-2 stagger)
    ts = pumpUntil(() => Number(finalCells()[1]!.textContent) < 0, ts, 50);
    const loseV = Number(loseCell!.textContent);
    expect(loseV).toBeLessThan(0);
    expect(loseV).toBeGreaterThan(-80);
    const loseSpan = loseCell!.querySelector('.roll-num') as HTMLElement;
    const [lr, lg] = rgbOf(loseSpan);
    expect(lg).toBeLessThanOrEqual(lr + 40); // gold's green runs far ahead of its red

    /* landing: exact integers, elements gone, plain text at rest.
       Pump a fixed frame span — the rounded text reaches the final
       integers slightly BEFORE the tween's own clock does, and the
       settle only starts once the tween itself reports done. */
    for (let i = 0; i < 34; i++) { ts += 50; pumpFrame(ts); }
    advance(600); // the settle pop plays out; spans hand back to plain text
    expect(finalCells().map((c) => c.textContent)).toEqual(['152', '-80']);
    expect(document.querySelectorAll('.box-score .roll-num')).toHaveLength(0);
  });

  it('reduced motion hands over the exact finals instantly, no spans ever', () => {
    mountBox(decidedGame([152, -80], [0]), { reduced: true });
    expect(finalCells().map((c) => c.textContent)).toEqual(['152', '-80']);
    expect(document.querySelectorAll('.box-score .roll-num')).toHaveLength(0);
    advance(3000);
    pumpFrame(0);
    pumpFrame(50);
    expect(finalCells().map((c) => c.textContent)).toEqual(['152', '-80']);
    expect(document.querySelectorAll('.box-score .roll-num')).toHaveLength(0);
  });

  it('a side finishing on zero renders plain — the no-change case', () => {
    mountBox(decidedGame([0, -80], [1])); // side 1 crowned while negative
    // Only the non-zero tally performs; the zero stays plain text.
    expect(document.querySelectorAll('.box-score .roll-num')).toHaveLength(1);
    expect(finalCells()[0]!.textContent).toBe('0');
    advance(200);
    let ts = 0;
    for (let i = 0; i < 30; i++) { ts += 50; pumpFrame(ts); }
    advance(600);
    expect(finalCells().map((c) => c.textContent)).toEqual(['0', '-80']);
    expect(document.querySelectorAll('.box-score .roll-num')).toHaveLength(0);
  });

  it('without the roll opt-in the Final row is static (records surfaces untouched)', () => {
    mountBox(decidedGame([152, -80], [0]), { roll: false });
    expect(finalCells().map((c) => c.textContent)).toEqual(['152', '-80']);
    expect(document.querySelectorAll('.box-score .roll-num')).toHaveLength(0);
  });
});
