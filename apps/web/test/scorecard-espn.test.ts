import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, type HandRecord, type SideHandResult, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission, calloutsFor } from '../src/Intermission';
import { ScorePad } from '../src/ScorePad';
import { BoxScore, bostonSides, boxScoreRows, gameHeadlines } from '../src/BoxScore';

/* ------------------------------------------------------------ fixtures */

function sideRes(p: Partial<SideHandResult> & { side: number }): SideHandResult {
  return {
    seats: [], contract: 0, contractTricks: 0, tricks: 0, contractMade: null, contractPoints: 0,
    nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0,
    points: 0, totalScore: 0, totalBags: 0, ...p,
  };
}
function handRec(p: Partial<HandRecord> & { handNo: number }): HandRecord {
  return { dealer: 0, bids: [], tricksWon: [], sides: [], ...p };
}

const teamRules = makeRules('joker', { targetScore: 250 });
/** A 3-hand team game: a busted nil, a Boston+nuke hand, then a blind nil made. */
function teamHistory(): HandRecord[] {
  return [
    handRec({
      handNo: 1, bids: [5, 'nil', 3, 5], tricksWon: [5, 0, 3, 5],
      sides: [
        sideRes({ side: 0, seats: [0, 2], tricks: 8, points: 83, totalScore: 83, contractMade: true }),
        sideRes({ side: 1, seats: [1, 3], tricks: 5, points: -50, totalScore: -50, contractMade: true, nils: [{ seat: 1, kind: 'nil', tricks: 1, made: false, points: -100 }] }),
      ],
    }),
    handRec({
      handNo: 2, bids: [6, 5, 4, 5], tricksWon: [7, 0, 6, 0], nuke: { seat: 2 },
      sides: [
        sideRes({ side: 0, seats: [0, 2], tricks: 13, points: 130, totalScore: 213, contractMade: true }),
        sideRes({ side: 1, seats: [1, 3], tricks: 0, points: -130, totalScore: -180, contractMade: false }),
      ],
    }),
    handRec({
      handNo: 3, bids: [4, 4, 4, 'blindNil'], tricksWon: [2, 5, 2, 4],
      sides: [
        sideRes({ side: 0, seats: [0, 2], tricks: 4, points: -120, totalScore: 93, contractMade: false }),
        sideRes({ side: 1, seats: [1, 3], tricks: 9, points: 150, totalScore: -30, contractMade: true, nils: [{ seat: 3, kind: 'blindNil', tricks: 0, made: true, points: 200 }] }),
      ],
    }),
  ];
}
function teamState(): GameState {
  return {
    rules: teamRules, history: teamHistory(), scores: [93, -30], phase: 'gameOver',
    result: { endReason: 'target', finalScores: [93, -30], placements: [1, 2], winners: [0] },
  } as unknown as GameState;
}

/* ------------------------------------------------- moment callouts */

describe('recap moment callouts (Boston / Wheels / nuke)', () => {
  it('names the Boston, the Wheels, and the nuke from the hand record', () => {
    const st = { rules: teamRules, history: [teamHistory()[1]!] } as unknown as GameState;
    const calls = calloutsFor(st, 0, ['You', 'Hana', 'Mei', 'Jamal']);
    const kinds = calls.map((c) => c.kind);
    expect(kinds).toContain('boston');
    expect(kinds).toContain('wheels');
    expect(kinds).toContain('nuke');
    expect(calls.find((c) => c.kind === 'nuke')!.text).toContain('Mei'); // seat 2 blew it
    expect(calls.find((c) => c.kind === 'boston')!.text).toContain('took every book');
  });

  it('a plain hand earns none of the moment callouts', () => {
    const plain = handRec({
      handNo: 1, bids: [4, 4, 3, 4], tricksWon: [4, 3, 3, 3],
      sides: [
        sideRes({ side: 0, seats: [0, 2], tricks: 7, points: 74, totalScore: 74, contractMade: true }),
        sideRes({ side: 1, seats: [1, 3], tricks: 6, points: -60, totalScore: -60, contractMade: true }),
      ],
    });
    const st = { rules: teamRules, history: [plain] } as unknown as GameState;
    const kinds = calloutsFor(st, 0, ['You', 'Hana', 'Mei', 'Jamal']).map((c) => c.kind);
    expect(kinds).not.toContain('boston');
    expect(kinds).not.toContain('wheels');
    expect(kinds).not.toContain('nuke');
  });

  it('bostonSides follows the Postgame rule (every book, full 13+ trick hand)', () => {
    expect(bostonSides(teamHistory()[1]!)).toEqual([0]);
    expect(bostonSides(teamHistory()[0]!)).toEqual([]);
  });
});

/* ------------------------------------------------------ helpers */

describe('box score helpers', () => {
  it('rows carry per-hand points and running totals', () => {
    const rows = boxScoreRows(teamHistory());
    expect(rows.map((r) => r.handNo)).toEqual([1, 2, 3]);
    expect(rows[1]!.cells).toEqual([
      { side: 0, points: 130, total: 213 },
      { side: 1, points: -130, total: -180 },
    ]);
  });

  it('headlines come only from the records: books, nils made, best hand', () => {
    const head = gameHeadlines(teamState());
    expect(head.books).toEqual([{ side: 0, n: 25 }, { side: 1, n: 14 }]);
    expect(head.nilsMade).toEqual([{ side: 0, n: 0 }, { side: 1, n: 1 }]);
    expect(head.bestHand).toEqual({ side: 1, points: 150, handNo: 3 });
    expect(head.outs).toEqual([]);
  });

  it('eliminations read the hand a side went out on (Time of death)', () => {
    const rules = makeRules('cutthroat', { playerCount: 3, targetScore: 300 });
    const history = [
      handRec({
        handNo: 1, bids: [4, 4, 4], tricksWon: [5, 4, 4],
        sides: [0, 1, 2].map((side) => sideRes({ side, seats: [side], tricks: [5, 4, 4][side]!, points: [50, 40, 40][side]!, totalScore: [50, 40, 40][side]!, contractMade: true })),
      }),
      handRec({
        handNo: 2, bids: [4, 4, 4], tricksWon: [6, 3, 4],
        sides: [0, 1, 2].map((side) => sideRes({ side, seats: [side], tricks: [6, 3, 4][side]!, points: [60, -40, 40][side]!, totalScore: [110, 0, 80][side]!, contractMade: side !== 1, out: side === 1 })),
      }),
    ];
    const st = { rules, history, scores: [110, 0, 80], result: null } as unknown as GameState;
    expect(gameHeadlines(st).outs).toEqual([{ side: 1, handNo: 2 }]);
  });
});

/* ------------------------------------------------------ BoxScore */

describe('end-of-game box score', () => {
  const label = (s: number) => (s ? 'Them' : 'Us');
  const html = renderToStaticMarkup(createElement(BoxScore, { st: teamState(), label, mySide: 0, winners: [0] }));

  it('renders every hand with points and running totals, plus the final', () => {
    expect(html).toContain('data-testid="box-score"');
    for (const n of [1, 2, 3]) expect(html).toContain(`data-testid="box-row-${n}"`);
    expect(html).toContain('+130');
    expect(html).toContain('−130');
    expect(html).toContain('<small>213</small>');
    expect(html).toContain('data-testid="box-final"');
    expect(html).toContain('<b>93</b>');
  });

  it('highlights the winner in gold and keeps headline lines honest', () => {
    const final = html.slice(html.indexOf('data-testid="box-final"'));
    expect(final).toContain('class="win"');
    expect(html).toContain('Total books');
    expect(html).toContain('Us 25 · Them 14');
    expect(html).toContain('Nils made');
    expect(html).toContain('Best hand');
    expect(html).toContain('Them +150 · Hand 3');
    expect(html).not.toContain('>Out<'); // nobody was eliminated in this fixture
  });

  it('omits lines the records do not carry (no nils, no positive hand)', () => {
    const quiet = {
      rules: teamRules, scores: [-40, -90], phase: 'gameOver',
      history: [handRec({
        handNo: 1, bids: [5, 5, 4, 5], tricksWon: [4, 5, 2, 2],
        sides: [
          sideRes({ side: 0, tricks: 6, points: -40, totalScore: -40, contractMade: false }),
          sideRes({ side: 1, tricks: 7, points: -90, totalScore: -90, contractMade: false }),
        ],
      })],
      result: { endReason: 'target', finalScores: [-40, -90], placements: [1, 2], winners: [0] },
    } as unknown as GameState;
    const out = renderToStaticMarkup(createElement(BoxScore, { st: quiet, label, mySide: 0, winners: [0] }));
    expect(out).toContain('Total books');
    expect(out).not.toContain('Nils made');
    expect(out).not.toContain('Best hand');
  });
});

/* ------------------------------------------- surfaces: recap + pad */

function toHandOver(seed: string): GameState {
  let st = newGame(makeRules('joker'), seed);
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}
function playHands(n: number): GameState {
  let st = newGame(makeRules('joker', { targetScore: 250 }), 'espn-pad');
  for (let g = 0; g < 4000 && st.history.length < n && st.phase !== 'gameOver'; g++) {
    if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st)!;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

describe('ESPN recap + score pad', () => {
  it('recap gains the hands strip (dots only — totals still live in TOP SCORES alone)', () => {
    const st = toHandOver('espn-recap');
    const html = renderToStaticMarkup(createElement(Intermission, {
      st, names: ['You', 'Yesenia', 'Omar', 'Sven'], mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
      onReady: () => {}, onScorePad: () => {}, onChat: () => {},
    }));
    expect(html).toContain('tt glass slant espn');
    expect(html).toContain('TOP SCORES');
    expect(html).toContain('HANDS');
    expect(html).toContain('data-testid="recap-strip"');
    expect(html.split('class="hs-dot ').length - 1).toBe(st.history.length * 2);
    // the founder rule survives: each running total still appears exactly once
    for (const s of st.history[st.history.length - 1]!.sides) {
      expect(html.split(`<b>${s.totalScore}</b>`).length - 1).toBe(1);
    }
  });

  it('score pad gains the strip and keeps its full inventory (rules, totals, breakdown)', () => {
    const st = playHands(3);
    const html = renderToStaticMarkup(createElement(ScorePad, {
      st, names: ['You', 'Hana', 'Mei', 'Jamal'], onClose: () => {}, sideName: (i: number) => (i ? 'Them' : 'Us'),
    }));
    expect(html).toContain('score-pad v2 espn');
    expect(html).toContain('data-testid="pad-strip"');
    expect(html.split('class="hs-dot ').length - 1).toBe(st.history.length * 2);
    expect(html).toContain('data-testid="pad-board"');
    expect(html).toContain('data-testid="locked-rules-details"');
    expect(html).toContain('Playing to 250');
  });

  it('pad hand headers call out recorded moments (Boston / nuke chips)', () => {
    const st = {
      rules: teamRules, history: teamHistory(), scores: [93, -30], bags: [4, 9], seed: 'espn-moments', phase: 'handOver', handNo: 3, dealer: 0,
      bids: [null, null, null, null], tricksWon: [0, 0, 0, 0], result: null,
    } as unknown as GameState;
    const html = renderToStaticMarkup(createElement(ScorePad, {
      st, names: ['You', 'Hana', 'Mei', 'Jamal'], onClose: () => {}, sideName: (i: number) => (i ? 'Them' : 'Us'),
    }));
    expect(html).toContain('data-testid="pad-moment-2"');
    expect(html).toContain('BOSTON');
    expect(html).toContain('NUKE');
    expect(html).not.toContain('data-testid="pad-moment-1"');
  });
});

/* ------------------------------------------------- parity + CSS */

describe('recap chat affordance (owner: no floating button over the scores)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const recapEl = (extra: Record<string, unknown> = {}) => createElement(Intermission, {
    st: toHandOver('espn-chat'), names: ['You', 'Yesenia', 'Omar', 'Sven'], mySide: 0, secs: null, online: false,
    unread: 0, chatOpen: false, onReady: () => {}, onScorePad: () => {}, onChat: () => {},
    ...extra,
  });
  it('the chat button renders INSIDE the recap header row, not as a sheet overlay', () => {
    const html = renderToStaticMarkup(recapEl());
    const headStart = html.indexOf('tt-head');
    const headEnd = html.indexOf('</header>');
    const btn = html.indexOf('data-testid="recap-chat"');
    expect(headStart).toBeGreaterThan(-1);
    expect(btn).toBeGreaterThan(headStart);
    expect(btn).toBeLessThan(headEnd); // inside <header>…</header>: in-flow, above the body
    expect(html.indexOf('tt-top-scores')).toBeGreaterThan(headEnd); // scores live below the header, never under the button
  });
  it('the unread badge survives on the header button', () => {
    const html = renderToStaticMarkup(recapEl({ unread: 16 }));
    expect(html).toContain('data-testid="recap-unread"');
    expect(html).toContain('>16<');
  });
  it('the button is not fixed-positioned — no viewport overlay is possible', () => {
    const rule = css.match(/\.tt-chat-btn \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('position: relative');
    expect(rule).not.toContain('position: fixed');
    expect(rule).not.toContain('z-index');
    expect(css).not.toContain('.tt-chat-btn { position: fixed');
  });
  it('the header no longer reserves a 56px dodge for a floating button', () => {
    expect(css).not.toContain('.tt-head { display: flex; align-items: center; gap: 10px; padding: 12px 56px');
    expect(css).toContain('.tt-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px 10px;');
  });
});

describe('theme parity + CSS pins', () => {
  it('scorecard markup is theme-agnostic: same fixture, identical render', () => {
    const a = renderToStaticMarkup(createElement(BoxScore, { st: teamState(), label: (s: number) => (s ? 'Them' : 'Us'), mySide: 0, winners: [0] }));
    const b = renderToStaticMarkup(createElement(BoxScore, { st: teamState(), label: (s: number) => (s ? 'Them' : 'Us'), mySide: 0, winners: [0] }));
    expect(a).toBe(b);
    expect(a).not.toContain('data-theme');
  });

  it('the ESPN block is additive: pinned base rules survive byte-for-byte', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.box-table');
    expect(css).toContain('.hands-strip');
    expect(css).toContain('.tt-body { padding: 12px 12px 14px; gap: 10px; }');
    expect(css).toContain('.tt-top-scores li b { font-size: 22px; font-weight: 800; }');
    expect(css).toContain('.pad-board-total { font-size: 30px;');
  });
});
