import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { ScorePad, rulesChips, rulesLine } from '../src/ScorePad';

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
    expect(rulesLine(makeRules('joker', { targetScore: 250 }))).toBe('Playing to 250 · Lose at -200 · 10 bags = −100 · Minimum 4 · Shot = out');
  });
  it('compact rule chips', () => {
    expect(rulesChips(makeRules('joker', { targetScore: 250 }))).toEqual(['To 250', 'Lose at -200', '10 bags = −100', 'Minimum 4', 'Shot = out', 'Normal · bid 20s / play 30s']);
  });
  it('labeled columns per team: bid as "a + b = total", took, result chip, points with a breakdown, running bags, total, dealer per hand', () => {
    const st = playHands(3);
    const names = ['You', 'Hana', 'Mei', 'Jamal'];
    const html = renderToStaticMarkup(createElement(ScorePad, { st, names, onClose: () => {}, sideName: (i: number) => (i ? 'Them' : 'Us') }));
    for (const lbl of ['Bid', 'Took', 'Points', 'Total']) expect(html).toContain(`>${lbl}<`);
    expect(html).not.toContain('Books (hand 1)');
    expect(html).not.toMatch(/\d+ books</);
    expect(html).toContain('pad-continue');
    expect(html).toMatch(/\d+ \+ \d+ = \d+|Nil \+ \d+/);
    expect(html).toMatch(/dealt/);
    expect(html).toContain('pad-hand last');
    expect(html).toMatch(/for the bid of \d+|set \(bid \d+\)|for \d+ books/);
    expect(html).not.toMatch(/Books\+Books/);
    expect(html).toContain('Playing to 250');
    expect(html).toContain('data-testid="pad-board"');
    const handsAt = html.indexOf('pad-hand');
    expect(html.slice(0, handsAt)).not.toContain('rule-chip');
    expect(html.indexOf('data-testid="pad-rules"')).toBeGreaterThan(html.indexOf('locked-rules-details'));
    for (const chip of ['Lose at -200', '10 bags = −100', 'Shot = out', 'Minimum 4']) expect(html).toContain(chip);
  });
  it('scoreboard lists every cutthroat player, not two teams', () => {
    const st = newGame(makeRules('cutthroat', { playerCount: 3, targetScore: 300 }), 'cut-pad');
    const names = ['You', 'Ace', 'Bea'];
    const html = renderToStaticMarkup(createElement(ScorePad, { st, names, onClose: () => {}, sideName: (i: number) => names[i]! }));
    expect(html).toContain('Playing to 300');
    expect(html.match(/data-testid="pad-board-side"/g)).toHaveLength(3);
    for (const name of names) expect(html).toContain(name);
    expect(html.slice(0, html.indexOf('locked-rules-details'))).not.toContain('rule-chip');
  });
});
