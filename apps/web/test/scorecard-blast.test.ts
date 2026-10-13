import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, isShot, makeRules, newGame, pendingTurn, scoreHand, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';

function toHandOver(mode: 'joker' | 'cutthroat'): GameState {
  const rules = mode === 'cutthroat' ? makeRules('cutthroat', { playerCount: 3, targetScore: 300 }) : makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, `blast-${mode}`);
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

function markShot(st: GameState, sides: number[]): GameState {
  const history = st.history.map((h, i) => i < st.history.length - 1 ? h : {
    ...h,
    sides: h.sides.map((s) => ({ ...s, contractMade: sides.includes(s.side) ? false as const : s.contractMade })),
  });
  return { ...st, history };
}

function recap(st: GameState, names: string[]) {
  return renderToStaticMarkup(createElement(Intermission, {
    st, names, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
    onReady: () => {}, onScorePad: () => {}, onChat: () => {},
  }));
}

describe('scorecard shotgun blast', () => {
  it('blasts only the shot side, and both panels when both are set', () => {
    const names = ['You', 'Hana', 'Mei', 'Jamal'];
    const one = recap(markShot(toHandOver('joker'), [1]), names);
    expect(one).toContain('data-testid="recap-side-1" data-blast="yes"');
    expect(one).not.toContain('recap-blast-');
    expect(one).not.toContain('blast-holes');
    expect(one).not.toContain('blast-cracks');
    expect(one).not.toContain('/shot/hole.png');
    expect(one).not.toContain('/shot/tape.png');
    expect(one).toContain('class="tt-team blast"');
    expect(one).toContain('data-testid="recap-side-0" data-blast="no"');
    expect(one).toContain('data-testid="recap-line-1"');
    expect(one).toContain('Took 9');
    expect(one).not.toContain('GOT SHOT');
    expect(one).not.toContain('hype-pop');

    const both = recap(markShot(toHandOver('joker'), [0, 1]), names);
    expect(both).not.toContain('/shot/hole.png');
    expect(both).toContain('class="tt-team mine blast"');
    expect(both).toContain('class="tt-team blast"');
  });

  it('blasts that player’s own panel in Cutthroat', () => {
    const names = ['You', 'Ace', 'Bea'];
    const html = recap(markShot(toHandOver('cutthroat'), [2]), names);
    expect(html).toContain('tt-recap crowded');
    expect(html).toContain('data-testid="recap-side-2" data-blast="yes"');
    expect(html).not.toContain('/shot/hole.png');
    expect(html).not.toContain('/shot/tape.png');
    expect(html).toContain('data-testid="recap-side-0" data-blast="no"');
    expect(html).toContain('data-testid="recap-side-1" data-blast="no"');
    expect(html).toContain('data-testid="recap-line-2"');
  });

  it('blasts and tapes a busted Nil, which the engine counts as a shot', () => {
    const rules = makeRules('joker', { targetScore: 500 });
    const bids = ['nil', 3, 4, 3] as const;
    const tricksWon = [1, 4, 4, 4];
    const sides = scoreHand(rules, [...bids], tricksWon, [0, 0], [0, 0]);
    expect(isShot(rules, [...bids], sides[0]!)).toBe(true);
    expect(sides[0]!.contractMade).toBe(true);
    const base = toHandOver('joker');
    const st: GameState = {
      ...base, phase: 'handOver', result: null, handNo: 2,
      history: [{ handNo: 2, dealer: 0, bids: [...bids], tricksWon, sides }],
    };
    const html = recap(st, ['You', 'Hana', 'Mei', 'Jamal']);
    expect(html).toContain('data-testid="recap-side-0" data-blast="yes"');
    expect(html).toContain('data-testid="recap-holes-0"');
    expect(html).toContain('data-testid="recap-tape-0"');
    expect(html).toContain('data-tape="yes"');
    expect(html).not.toContain('data-testid="recap-shroud-0"');
    expect(html).toContain('data-testid="recap-side-1" data-blast="no"');
  });

  it('drops the glowing constellation and keeps the boom readable', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).not.toContain('.hype-pop.shot');
    expect(css).not.toContain('.hype-pop.gotShot');
    expect(css).not.toContain('muzzle-flash');
    expect(css).not.toContain('blast-marks-in');
    expect(css).not.toContain('panel-blast');
    expect(css).not.toContain('.blast-holes');
    expect(css).toContain('animation: hole-punch');
    expect(css).toContain('animation: hole-jolt');
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}/g)].map((m) => m[0]);
    const shake = blocks.find((b) => b.includes('.shot-holes') && b.includes('animation: none'));
    expect(shake).toBeTruthy();
    expect(shake).not.toContain('display: none');
    expect(css).not.toMatch(/@media[^{]*max-width[^{]*\{[^}]*(shot-holes|caution-x|hole-punch|hole-jolt)/);
    const hype = readFileSync(new URL('../src/Hype.tsx', import.meta.url), 'utf8');
    expect(hype).not.toContain("'SHOT!'");
    expect(hype).not.toContain("'GOT SHOT'");
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).not.toContain("fx.later(shot");
    expect(table).not.toContain("fx.later('shot'");
    expect(table).not.toContain("fx.later('gotShot'");
  });

  it('plays the boom through the volume bus, which stays quiet while muted', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const play = audio.slice(audio.indexOf('play(name: Sfx'), audio.indexOf('private sample'));
    expect(play.indexOf('if (!this.settings.on')).toBeGreaterThan(-1);
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'shotgun'"));
    expect(play).toContain("case 'shotgun': return this.shotgunBoom");
    const recap = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    expect(recap).toContain("sound.play('shotgun'");
    expect(recap).toContain('contractMade === false');
  });
});
