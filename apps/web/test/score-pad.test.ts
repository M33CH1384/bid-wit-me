import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { ScorePad, rulesLine } from '../src/ScorePad';

function playHands(n: number, rules = makeRules('joker', { targetScore: 250 })): GameState {
  let st = newGame(rules, 'pad-test');
  for (let g = 0; g < 4000 && st.history.length < n && st.phase !== 'gameOver'; g++) {
    if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st)!;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

describe('score pad', () => {
  it('readable rules line', () => {
    expect(rulesLine(makeRules('joker', { targetScore: 250 }))).toBe('Playing to 250 · Lose at -200 · 10 bags = −100 · Shot = out · hand 1 needs 4+ books');
  });
  it('labeled columns per team: bid as "a + b = total", took, result chip, points with a breakdown, running bags, total, dealer per hand', () => {
    const st = playHands(3);
    const names = ['You', 'Hana', 'Mei', 'Jamal'];
    const html = renderToStaticMarkup(createElement(ScorePad, { st, names, onClose: () => {}, sideName: (i: number) => (i ? 'Them' : 'Us') }));
    for (const lbl of ['Bid', 'Took', 'Result', 'Points', 'Bags', 'Total']) expect(html).toContain(`>${lbl}<`);
    expect(html).toContain('Books (hand 1)');
    expect(html).toMatch(/\d+ \+ \d+ = \d+|Nil \+ \d+/);
    expect(html).toMatch(/class="rchip (made|set|books|shot|nil-ok|nil-bust)"/);
    expect(html).toMatch(/dealt/);
    expect(html).toContain('pad-hand last');
    expect(html).toMatch(/for the bid of \d+|set \(bid \d+\)|for \d+ books/);
    expect(html).not.toMatch(/Books\+Books/);
  });
});
