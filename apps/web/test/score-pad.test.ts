import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, type HandRecord, applyAction, makeRules, newGame, pendingTurn, scoreHand, viewFor } from '@spades/rules';
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
    expect(rulesLine(makeRules('joker', { targetScore: 250 }))).toBe('Playing to 250 · Lose at -200 · 10 bags = −100 · Minimum 4 · Shot = out · 3 sets = out');
  });
  it('compact rule chips', () => {
    expect(rulesChips(makeRules('joker', { targetScore: 250 }))).toEqual(['To 250', 'Lose at -200', '10 bags = −100', 'Minimum 4', 'Shot = out', '3 sets = out', 'Normal · bid 30s / play 30s']);
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

describe('score pad — the running set tally (third-set rule)', () => {
  const rules = makeRules('joker', { targetScore: 250 });
  const SET0: HandRecord[] = [1, 2, 3].map((handNo) => ({
    handNo, dealer: 3, bids: [4, 3, 2, 3], tricksWon: [3, 3, 1, 6],
    sides: scoreHand(rules, [4, 3, 2, 3], [3, 3, 1, 6], [0, 0], [0, 0]), // side 0 bids 6, takes 4: a set
  }));
  const names = ['You', 'Hana', 'Mei', 'Jamal'];
  const render = (st: GameState) => renderToStaticMarkup(createElement(ScorePad, { st, names, onClose: () => {}, sideName: (i: number) => (i ? 'Them' : 'Us') }));

  it('the board shows the count per side, with the warning when one more ends it', () => {
    const st = { ...newGame(rules, 'pad-sets'), history: SET0.slice(0, 2), scores: [-120, 126], bags: [0, 6] } as GameState;
    const html = render(st);
    expect(html).toContain('data-sets="2"');
    expect(html).toContain('data-sets="0"');
    expect(html).toContain('2 sets · one more ends it');
    expect(html).toContain('0 sets');
  });

  it('a game ended by the third set chips the final hand OUT · 3RD SET', () => {
    const st = {
      ...newGame(rules, 'pad-sets-over'), history: SET0, scores: [-180, 189], bags: [0, 9], phase: 'gameOver',
      result: { endReason: 'third-set', shotOut: [0], finalScores: [-180, 189], placements: [2, 1], winners: [1] },
    } as unknown as GameState;
    const html = render(st);
    expect(html).toContain('data-sets="3"');
    expect(html).toContain('OUT · 3RD SET');
  });
});
