import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';

function toHandOver(mode: 'joker' | 'cutthroat'): GameState {
  const rules = mode === 'cutthroat' ? makeRules('cutthroat', { playerCount: 3, targetScore: 300 }) : makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, `shroud-${mode}`);
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

/** Replace history with numeric-bid hands. `sideShots[hand]` lists the sides set that hand. Hand 1 is index 0. */
function stamp(st: GameState, sideShots: number[][], shotOut = true): GameState {
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
    })),
  }));
  return { ...st, rules: { ...st.rules, shotOut }, history, handNo: history.length, phase: 'handOver' };
}

function recap(st: GameState, names: string[]) {
  return renderToStaticMarkup(createElement(Intermission, {
    st, names, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
    onReady: () => {}, onScorePad: () => {}, onChat: () => {},
  }));
}

describe('scorecard caution tape and shroud', () => {
  const names = ['You', 'Hana', 'Mei', 'Jamal'];

  it('tapes the panel on a shot after hand 1, and leaves the other side clear', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1]]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="yes" data-sheet="no" data-siren="no"');
    expect(html).toContain('class="tt-team blast taped tape-in"');
    expect(html).toContain('data-testid="recap-tape-1"');
    expect(html).toContain('>CAUTION<');
    expect(html).not.toContain('data-testid="recap-shroud-1"');
    expect(html).not.toContain('recap-tape-0');
    expect(html).toContain('data-testid="recap-side-0" data-blast="no" data-tape="no" data-sheet="no" data-siren="no"');
    expect(html).toContain('data-testid="recap-line-1"');
  });

  it('pulls the tape off once they make their books', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1], []]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="no" data-tape="no" data-sheet="no" data-siren="no"');
    expect(html).not.toContain('recap-tape-');
    expect(html).not.toContain('recap-shroud-');
    expect(html).not.toContain('tape-in');
    expect(html).toContain('data-testid="recap-line-1"');
  });

  it('drapes the sheet when they are shot again while the previous hand was a shot', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1], [1]]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="no" data-sheet="yes" data-siren="no"');
    expect(html).toContain('class="tt-team blast shrouded sheet-in"');
    expect(html).toContain('data-testid="recap-shroud-1"');
    expect(html).not.toContain('recap-tape-');
    expect(html).toContain('data-testid="recap-line-1"');
    expect(html).not.toContain('recap-shroud-0');
  });

  it('on a hand-1 shot-out shows the sheet and the tape, and plays the siren through the volume bus', () => {
    const html = recap(stamp(toHandOver('joker'), [[1]]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="yes" data-sheet="yes" data-siren="yes"');
    expect(html).toContain('class="tt-team blast taped tape-in shrouded sheet-in"');
    expect(html).toContain('data-testid="recap-tape-1"');
    expect(html).toContain('data-testid="recap-shroud-1"');
    expect(html).toContain('data-testid="recap-line-1"');
    const off = recap(stamp(toHandOver('joker'), [[1]], false), names);
    expect(off).toContain('data-tape="yes" data-sheet="no" data-siren="no"');
    expect(off).not.toContain('recap-shroud-');
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const play = audio.slice(audio.indexOf('play(name: Sfx'), audio.indexOf('private sample'));
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'siren'"));
    expect(play).toContain("case 'siren': return this.siren");
    expect(audio).toContain('Original synthesis, no sampled recording');
    const recapSrc = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    expect(recapSrc).toContain("sound.play('siren'");
    expect(recapSrc).toContain('shotCovers(r, st.history)');
  });

  it('tapes that Cutthroat player’s own panel', () => {
    const html = recap(stamp(toHandOver('cutthroat'), [[], [2]]), ['You', 'Ace', 'Bea']);
    expect(html).toContain('tt-recap crowded');
    expect(html).toContain('data-testid="recap-side-2" data-blast="yes" data-tape="yes" data-sheet="no" data-siren="no"');
    expect(html).toContain('data-testid="recap-tape-2"');
    expect(html).not.toContain('recap-tape-0');
    expect(html).not.toContain('recap-tape-1');
    expect(html).toContain('data-testid="recap-line-2"');
  });

  it('keeps the tape and the sheet at phone widths, and skips only their entrance when motion is reduced', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toContain('animation: tape-slap');
    expect(css).toContain('animation: sheet-drop');
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}/g)].map((m) => m[0]);
    const entrance = blocks.find((b) => b.includes('.caution-tape') && b.includes('.shroud'));
    expect(entrance).toContain('animation: none');
    expect(entrance).not.toContain('display: none');
    expect(css).not.toMatch(/@media[^{]*max-width[^{]*\{[^}]*(caution-tape|\.shroud)/);
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain("endReason === 'shotOut' && !shotRecapAck");
    expect(table).toContain('setShotRecapAck(true)');
  });
});
