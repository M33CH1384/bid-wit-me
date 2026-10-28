import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, type HandRecord, type SideHandResult, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission, calloutsFor } from '../src/Intermission';
import { ScorePad } from '../src/ScorePad';
import { BoxScore, bostonSides, boxScoreRows, gameHeadlines } from '../src/BoxScore';
import { THIRD_SET_HEADLINE, endReasonText } from '../src/shotOut';

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

  it('headlines come only from the records: books, nils made, the winner’s best hand', () => {
    const head = gameHeadlines(teamState());
    expect(head.books).toEqual([{ side: 0, n: 25 }, { side: 1, n: 14 }]);
    expect(head.nilsMade).toEqual([{ side: 0, n: 0 }, { side: 1, n: 1 }]);
    // side 1's +150 (hand 3) is the biggest hand of the game, but side 1 LOST —
    // the headline belongs to the winning side's best hand (side 0, +130, hand 2)
    expect(head.bestHand).toEqual({ side: 0, points: 130, handNo: 2 });
    expect(head.outs).toEqual([]);
  });

  it('best hand follows the winners passed in, and lines list the winner first', () => {
    // same game, but call it for side 1 as the winner: framing flips, data doesn't
    const head = gameHeadlines(teamState(), [1]);
    expect(head.bestHand).toEqual({ side: 1, points: 150, handNo: 3 });
    expect(head.books).toEqual([{ side: 1, n: 14 }, { side: 0, n: 25 }]);
    expect(head.nilsMade).toEqual([{ side: 1, n: 1 }, { side: 0, n: 0 }]);
  });

  it('with no result yet, best hand falls back to the best hand by any side', () => {
    const st = { ...teamState(), result: null } as unknown as GameState;
    expect(gameHeadlines(st).bestHand).toEqual({ side: 1, points: 150, handNo: 3 });
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
    expect(html).toContain('Us 25 · Them 14'); // both sides, winner (Us) first
    expect(html).toContain('Nils made');
    expect(html).toContain('Best hand');
    expect(html).toContain('Us +130 · Hand 2'); // the WINNER's best hand, not the loser's +150
    expect(html).not.toContain('Them +150 · Hand 3');
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

/* --------------------------------- tall games: the card keeps every row */

describe('box score on long games (the victory sheet must fit these)', () => {
  it('a 12-hand game renders all 12 rows and its headlines', () => {
    let t0 = 0; let t1 = 0;
    const history = Array.from({ length: 12 }, (_, i) => {
      const p0 = i % 2 ? -40 : 60; const p1 = -p0;
      t0 += p0; t1 += p1;
      return handRec({
        handNo: i + 1, bids: [5, 5, 4, 5], tricksWon: [7, 6, 0, 0],
        sides: [
          sideRes({ side: 0, seats: [0, 2], tricks: 7, points: p0, totalScore: t0, contractMade: p0 > 0 }),
          sideRes({ side: 1, seats: [1, 3], tricks: 6, points: p1, totalScore: t1, contractMade: p1 > 0 }),
        ],
      });
    });
    const st = {
      rules: teamRules, history, scores: [t0, t1], phase: 'gameOver',
      result: { endReason: 'target', finalScores: [t0, t1], placements: [1, 2], winners: [0] },
    } as unknown as GameState;
    const out = renderToStaticMarkup(createElement(BoxScore, { st, label: (s: number) => (s ? 'Them' : 'Us'), mySide: 0, winners: [0] }));
    for (let n = 1; n <= 12; n++) expect(out).toContain(`data-testid="box-row-${n}"`);
    expect(out).toContain('Total books');
    expect(out).toContain('Us 84 · Them 72');
  });

  it('a 4-side cutthroat game renders an Out line per elimination', () => {
    const rules = makeRules('cutthroat', { playerCount: 4, targetScore: 300 });
    // an eliminated side stays flagged out on every later hand record (the
    // engine's shape) — that's what keeps its Time of death pinned
    const mk = (handNo: number, pts: number[], totals: number[], outSides: number[] = []) => handRec({
      handNo, bids: [3, 3, 3, 3], tricksWon: [4, 3, 3, 3],
      sides: [0, 1, 2, 3].map((side) => sideRes({
        side, seats: [side], tricks: [4, 3, 3, 3][side]!, points: pts[side]!, contractMade: true,
        totalScore: totals[side]!, out: outSides.includes(side),
      })),
    });
    const history = [
      mk(1, [50, 40, 30, 20], [50, 40, 30, 20]),
      mk(2, [60, -40, 30, 20], [110, 0, 60, 40], [1]),
      mk(3, [60, 0, -40, 20], [170, 0, 20, 60], [1, 2]),
    ];
    const st = {
      rules, history, scores: [170, 0, 20, 60], phase: 'gameOver',
      result: { endReason: 'target', finalScores: [170, 0, 20, 60], placements: [1, 4, 3, 2], winners: [0] },
    } as unknown as GameState;
    const head = gameHeadlines(st);
    expect(head.outs).toEqual([{ side: 1, handNo: 2 }, { side: 2, handNo: 3 }]);
    const out = renderToStaticMarkup(createElement(BoxScore, {
      st, label: (s: number) => ['Ana', 'Bo', 'Cy', 'Di'][s]!, mySide: 0, winners: [0],
    }));
    expect(out.split('>Out<').length - 1).toBe(2);
    expect(out).toContain('Bo · Hand 2');
    expect(out).toContain('Cy · Hand 3');
  });
});

/* --------------------------- stamp/sentence dedupe (owner, 2026-10-21) */

describe('end-reason sentence never repeats the stamp', () => {
  const label = (s: number) => (s ? 'Them' : 'Us');
  it('shot out: the sentence carries the detail, not the SHOT OUT lead', () => {
    const st = {
      history: [{ handNo: 1 }, { handNo: 2 }, { handNo: 3 }],
      result: { endReason: 'shotOut', shotOut: [1], finalScores: [154, -40], placements: [1, 2], winners: [0] },
    } as unknown as GameState;
    const text = endReasonText(teamRules, st, label);
    expect(text).toBe('Them got shot two hands in a row.');
    expect(text).not.toContain('SHOT OUT');
    // the banner above this sentence now stamps the ending's NAME (owner,
    // 2026-10-28) — for this path SHOT BACK 2 BACK — and the sentence must
    // not repeat any of the names either
    expect(text).not.toContain('SHOT BACK 2 BACK');
    expect(text).not.toContain('1ST ROUND TKO');
  });
  it('shot out on hand 1 keeps its own wording, still without the stamp', () => {
    const st = {
      history: [{ handNo: 1 }],
      result: { endReason: 'shotOut', shotOut: [0, 1], finalScores: [10, -20], placements: [1, 2], winners: [0] },
    } as unknown as GameState;
    const text = endReasonText(teamRules, st, label);
    expect(text).toBe('Us & Them got shot on the first hand.');
    expect(text).not.toContain('1ST ROUND TKO');
    expect(text).not.toContain('SHOT OUT');
  });
  it('shot out across a gap (sticky): the sentence carries the detail, not any of the names', () => {
    const rec = (handNo: number, shot: boolean) => ({ handNo, sides: [{ side: 0, shot: false }, { side: 1, shot }] });
    const st = {
      history: [rec(1, true), rec(2, false), rec(3, true)],
      result: { endReason: 'shotOut', shotOut: [1], finalScores: [154, -40], placements: [1, 2], winners: [0] },
    } as unknown as GameState;
    const text = endReasonText(teamRules, st, label);
    expect(text).toBe('Them got shot while on notice for good.');
    for (const name of ['SHOT OUT', '1ST ROUND TKO', 'SHOT BACK 2 BACK']) expect(text).not.toContain(name);
  });
  it('other end reasons are untouched', () => {
    const floor = { history: [{ handNo: 1 }], result: { endReason: 'floor', finalScores: [10, -510], placements: [1, 2], winners: [0] } } as unknown as GameState;
    expect(endReasonText(teamRules, floor, label)).toBe('Ended by the losing floor.');
    const target = { history: [{ handNo: 1 }], result: { endReason: 'target', finalScores: [250, 90], placements: [1, 2], winners: [0] } } as unknown as GameState;
    expect(endReasonText(teamRules, target, label)).toBe('First to 250.');
  });
  it('third set: the headline is the stamp, the sentence carries the plain detail', () => {
    expect(THIRD_SET_HEADLINE).toBe('3 the Hard Way');
    const st = {
      history: [{ handNo: 1 }, { handNo: 2 }, { handNo: 3 }, { handNo: 4 }, { handNo: 5 }],
      result: { endReason: 'third-set', shotOut: [1], finalScores: [120, -90], placements: [1, 2], winners: [0] },
    } as unknown as GameState;
    const text = endReasonText(teamRules, st, label);
    expect(text).toBe("Them got set for the third time — that's the ballgame.");
    expect(text).not.toContain('3 the Hard Way');
  });
});

/* --------------------------- third set: tally + banner */

describe('third set surfaces', () => {
  it('gameHeadlines counts sets per side from the records (a busted nil counts, per the engine)', () => {
    // teamHistory: hand 1 side 1 busts a nil (set), hand 2 side 1 misses (set), hand 3 side 0 misses (set)
    expect(gameHeadlines(teamState()).sets).toEqual([{ side: 0, n: 1 }, { side: 1, n: 2 }]);
  });
  it('the box score renders the Sets line', () => {
    const out = renderToStaticMarkup(createElement(BoxScore, { st: teamState(), label: (s: number) => (s ? 'Them' : 'Us'), mySide: 0, winners: [0] }));
    expect(out).toContain('>Sets<');
    expect(out).toContain('Us 1 · Them 2');
  });
  it('both game-over views stamp the headline banner for a third-set ending', () => {
    const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(tableSrc).toContain("res.endReason === 'third-set'");
    expect(tableSrc).toContain("st.result.endReason === 'third-set'");
    expect(tableSrc).toContain('data-testid="third-set"');
    expect(css).toContain('.shot-out-banner.third-set');
  });
});

/* ---------------- game-over layout: scroll region + pinned buttons (CSS) */

describe('game-over fit: hero fixed, middle scrolls, buttons pinned', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const tableSrc = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
  const animCss = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');

  it('the offline modal wraps placements + box score in the .scroll region, actions outside it', () => {
    const modalAt = tableSrc.indexOf('modal glass slant gameover espn');
    const scrollAt = tableSrc.indexOf('data-testid="gameover-scroll"', modalAt);
    const boxAt = tableSrc.indexOf('<BoxScore', scrollAt);
    const actionsAt = tableSrc.indexOf('confirm-actions', scrollAt);
    expect(modalAt).toBeGreaterThan(-1);
    expect(scrollAt).toBeGreaterThan(modalAt);
    expect(boxAt).toBeGreaterThan(scrollAt); // the box score lives INSIDE the scroll region
    expect(actionsAt).toBeGreaterThan(boxAt); // buttons come after — pinned below, not scrolled
    expect(tableSrc).toContain('className="scroll go-scroll"');
  });

  it('the online foot wraps its middle in .vic-scroll with the actions as a sibling below', () => {
    const footAt = tableSrc.indexOf('vic-foot glass');
    const scrollAt = tableSrc.indexOf('data-testid="victory-scroll"', footAt);
    const boxAt = tableSrc.indexOf('<BoxScore', scrollAt);
    const actionsAt = tableSrc.indexOf('confirm-actions', scrollAt);
    expect(footAt).toBeGreaterThan(-1);
    expect(scrollAt).toBeGreaterThan(footAt);
    expect(boxAt).toBeGreaterThan(scrollAt);
    expect(actionsAt).toBeGreaterThan(boxAt);
  });

  it('both scroll regions are real overflow regions with the actions flex-pinned', () => {
    expect(css).toContain('.vic-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto;');
    expect(css).toContain('.vic-foot .confirm-actions { flex: none;');
    expect(css).toContain('.modal.gameover .confirm-actions { flex: none; }');
    expect(css).toContain('.gameover .go-scroll { display: flex; flex-direction: column;');
    // the modal's own .scroll contract is what bounds the offline region
    expect(css).toContain('.modal > .scroll { flex: 1 1 auto; min-height: 0; overflow: auto;');
    // the victory screen no longer page-scrolls its whole column away
    expect(css).toContain('.victory-screen { overflow: hidden; }');
  });

  it('the hero is tightened in the fit pass (trophy, title, stamp)', () => {
    expect(css).toContain('.gameover .trophy { font-size: 40px;');
    expect(css).toContain('.gameover h2 { font-size: 30px; }');
    expect(css).toContain('.espn .shot-out-banner { font-size: clamp(24px, 6vw, 42px);');
  });

  it('the animfx stamps (PAYBACK / UPSET) still land above both game-over views', () => {
    expect(animCss).toContain('.animfx-stamps { position: fixed; inset: 0; z-index: 1150;');
    expect(css).toContain('.victory-screen { position: fixed; inset: 0; z-index: 1000;');
    // stamps root (1150) > victory screen / modal backdrop (1000–1200 range is
    // reserved for sheets; the game-over roots themselves stay at 1000/1010)
    expect(css).toContain('.modal-backdrop, .tt-backdrop { z-index: 1000; }');
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
  it('the header reserves the sound dock corner so chat sits fully left of the speaker', () => {
    // The speaker dock paints OVER the recap's top-right corner (z 1050): right
    // offset 8px + safe-area, button 46px wide in portrait (40px slotted in the
    // scorebug) — its left edge reaches at most 54px + safe-area from the screen's
    // right edge, which is exactly where the in-flow chat button used to slide
    // under it (owner 2026-10-21). The header's right padding must reserve that
    // whole footprint, tracked with the dock's own safe-area term.
    const reserve = css.match(/\.tt-head \{ padding-right: calc\((\d+)px \+ env\(safe-area-inset-right\)\); \}/);
    expect(reserve).not.toBeNull();
    expect(Number(reserve![1])).toBeGreaterThanOrEqual(54); // 8px dock offset + 46px widest dock button
    // …and the reservation must WIN the cascade over every header padding
    // shorthand (base rule + both compact variants), or phones re-collide.
    const at = css.indexOf(reserve![0]);
    expect(at).toBeGreaterThan(css.indexOf('.tt-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px 10px;'));
    expect(at).toBeGreaterThan(css.indexOf('.tt-head { padding: 6px 12px; }'));
    expect(at).toBeGreaterThan(css.indexOf('.tt-head { padding: 10px 12px 8px; gap: 8px; }'));
  });
  it('the speaker dock itself is untouched: fixed at the corner, above the recap', () => {
    expect(css).toContain('.sound-dock { position: fixed; z-index: 70; top: calc(6px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right)); }');
    expect(css).toContain('.sound-dock { z-index: 1050; }');
    expect(css).toContain('.tt-backdrop { position: fixed; inset: 0;');
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
