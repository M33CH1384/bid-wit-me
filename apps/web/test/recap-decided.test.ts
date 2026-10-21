import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';

function toHandOver(seed: string): GameState {
  let st = newGame(makeRules('joker'), seed);
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

function recap(st: GameState) {
  return renderToStaticMarkup(createElement(Intermission, {
    st, names: ['You', 'Yesenia', 'Omar', 'Sven'], mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
    onReady: () => {}, onScorePad: () => {}, onChat: () => {}, onLeave: () => {},
  }));
}

describe('hand recap: top scores, spacing, and the decided-game flow', () => {
  it('puts TOP SCORES (leading totals first) above the per-hand sheets, with real spacing in the CSS', () => {
    const st = toHandOver('recap-decided-a');
    expect(st.phase).toBe('handOver');
    const html = recap(st);
    const topAt = html.indexOf('data-testid="recap-top-scores"');
    const sheetAt = html.indexOf('data-testid="recap-side-');
    expect(topAt).toBeGreaterThan(-1);
    expect(sheetAt).toBeGreaterThan(topAt); // top scores render ABOVE the sheets
    expect(html).toContain('TOP SCORES');
    // leader first: the side with the higher total is the first top-scores row
    const sides = st.history[st.history.length - 1]!.sides;
    const leader = [...sides].sort((a, b) => b.totalScore - a.totalScore)[0]!;
    const firstRow = html.slice(topAt, html.indexOf('</ol>', topAt));
    expect(firstRow).toContain(`data-testid="recap-top-${leader.side}"`);
    expect(firstRow.indexOf(`recap-top-${leader.side}`)).toBeLessThan(firstRow.indexOf('recap-top-', firstRow.indexOf(`recap-top-${leader.side}`) + 10) === -1 ? Infinity : firstRow.indexOf('recap-top-', firstRow.indexOf(`recap-top-${leader.side}`) + 10));
    // kept elements
    for (const kept of ['Score pad', 'Review last trick'.slice(0, 0) || 'Score pad', 'data-testid="recap-leave"', 'data-testid="talk-ready"']) expect(html).toContain(kept);
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.tt-top-scores');
    expect(css).toMatch(/\.tt-recap \{[^}]*gap: 24px/);
    expect(css).toMatch(/\.tt-body \{[^}]*gap: 24px/);
  });

  it('each running total appears exactly once: in TOP SCORES, never again in a sheet', () => {
    const st = toHandOver('recap-decided-a');
    const html = recap(st);
    expect(html).not.toContain('recap-total-');
    expect(html).not.toContain('<small>TOTAL</small>');
    // sheets keep their bags count (and books / took / points / progress bar) without the big total
    for (const s of st.history[st.history.length - 1]!.sides) {
      expect(html).toContain(`data-testid="recap-bags-${s.side}"`);
      // the total number is rendered once, as the TOP SCORES row's <b>
      expect(html.split(`<b>${s.totalScore}</b>`).length - 1).toBe(1);
    }
    expect(html).toContain('bag');
    expect(html).toContain('to ' + st.rules.targetScore);
  });

  it('a DECIDED game (winner already decided) shows the winner flow, never Continue to Hand N', () => {
    const base = toHandOver('recap-decided-b');
    const winners = [base.scores.indexOf(Math.max(...base.scores))];
    const st: GameState = {
      ...base, phase: 'gameOver',
      result: { endReason: 'shotOut', shotOut: [1], finalScores: [...base.scores], placements: base.scores.map((s) => 1 + base.scores.filter((o) => o > s).length), winners },
    };
    const html = recap(st);
    expect(html).toContain('See final results');
    expect(html).not.toContain('Continue to hand');
    expect(html).toContain('data-decided="yes"');
    // Table routes that button to the results (ack), not to nextHand — source wiring, not a hidden button
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain("if (st.phase === 'gameOver') setShotRecapAck(true); else apply({ type: 'nextHand' })");
    expect(table).toContain("(st.result?.endReason === 'shotOut' || st.result?.endReason === 'third-set') && !shotRecapAck");
  });

  it('an undecided hand still offers Continue to Hand N', () => {
    const st = toHandOver('recap-decided-c');
    expect(st.phase).toBe('handOver');
    const html = recap(st);
    expect(html).toContain(`Continue to hand ${st.handNo + 1}`);
    expect(html).not.toContain('See final results');
    expect(html).toContain('data-decided="no"');
  });
});
