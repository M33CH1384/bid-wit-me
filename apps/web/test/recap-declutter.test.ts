import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';

function toHandOver(rules: ReturnType<typeof makeRules>): GameState {
  let st = newGame(rules, 'recap-declutter');
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

function recap(st: GameState, names: string[], series = false) {
  return renderToStaticMarkup(createElement(Intermission, {
    st, names, mySide: 0, secs: null, online: false, unread: 2, chatOpen: false,
    onReady: () => {}, onScorePad: () => {}, onChat: () => {},
    series: series ? createElement('span', { 'data-testid': 'series-chip' }, 'SERIES 1–0') : undefined,
  }));
}

describe('hand recap', () => {
  it('keeps the header, series chip, and two team cards, and drops chat, avatars, shuffle, and the team editor', () => {
    const st = toHandOver(makeRules('joker', { targetScore: 500 }));
    expect(st.history.length).toBeGreaterThan(0);
    const names = ['You', 'Hana', 'Mei', 'Jamal'];
    const html = recap(st, names, true);
    expect(html).toContain(`HAND ${st.handNo} RECAP`);
    expect(html).toContain('data-testid="series-chip"');
    expect(html).toContain('data-testid="recap-chat"');
    expect(html).toContain('data-testid="recap-unread"');
    expect(html.match(/data-testid="recap-side-/g)).toHaveLength(2);
    for (const id of ['recap-line-', 'recap-players-', 'recap-points-', 'recap-total-']) {
      expect(html).toContain(`data-testid="${id}0"`);
      expect(html).toContain(`data-testid="${id}1"`);
    }
    expect(html).toContain('Took ');
    expect(html).toContain('took ');
    expect(html).toContain('bag');
    expect(html).toContain(`to ${st.rules.targetScore}`);
    expect(html).toContain('Score pad');
    expect(html).toContain('data-testid="talk-ready"');
    expect(html).toContain('Continue');
    expect(html).toContain('primary big');
    for (const gone of ['talk-grid', 'react-gg', 'data-testid="tt-team-name"', 'Shuffling', 'Talk your talk', 'YOUR TEAM NAME', 'class="tt-chat"', 'tt-deal', 'tt-reacts']) {
      expect(html).not.toContain(gone);
    }
  });

  it('gives Cutthroat one card per player', () => {
    const st = toHandOver(makeRules('cutthroat', { playerCount: 3, targetScore: 300 }));
    expect(st.phase).toBe('handOver');
    expect(st.rules.partnerships).toBe(false);
    const names = ['You', 'Ace', 'Bea'];
    const html = recap(st, names);
    expect(html.match(/data-testid="recap-side-/g)).toHaveLength(3);
    expect(html).toContain('tt-recap crowded');
    for (const name of names) expect(html).toContain(name);
    expect(html).toContain('to 300');
  });

  it('keeps the corner chat sheet above the recap and the team cards centered', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.chat.glass.slant.recap-chat');
    expect(css).toContain('justify-content: safe center');
    expect(css).toMatch(/modal-open > :not\([\s\S]*?:not\(\.recap-chat\)/);
    expect(css).toContain('.tt-chat-btn');
  });
});
