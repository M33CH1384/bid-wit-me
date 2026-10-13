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
function stamp(st: GameState, sideShots: number[][], opts: { shotOut?: boolean; lost?: number[] } = {}): GameState {
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
  const lost = opts.lost;
  const result = lost ? {
    endReason: 'shotOut' as const,
    shotOut: lost,
    finalScores: st.scores,
    placements: st.scores.map(() => 1),
    winners: [0],
  } : null;
  return {
    ...st,
    rules: { ...st.rules, shotOut: opts.shotOut !== false },
    result,
    history,
    handNo: history.length,
    phase: lost ? 'gameOver' : 'handOver',
  };
}

function recap(st: GameState, names: string[]) {
  return renderToStaticMarkup(createElement(Intermission, {
    st, names, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
    onReady: () => {}, onScorePad: () => {}, onChat: () => {},
  }));
}

function caption(html: string): string {
  const m = html.match(/<p class="tod"[\s\S]*?<\/p>/);
  return (m?.[0] ?? '').replace(/<[^>]+>/g, '').replace(/\u00a0|&nbsp;|&#160;/g, ' ');
}

describe('scorecard caution tape and shroud', () => {
  const names = ['You', 'Hana', 'Mei', 'Jamal'];

  it('tapes the panel on a shot after hand 1, and leaves the other side clear', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1]]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="yes" data-sheet="no" data-siren="no"');
    expect(html).toContain('class="tt-team blast taped tape-in notice"');
    expect(html).toContain('data-testid="recap-tape-1"');
    expect(html).toContain('src="/shot/tape.png"');
    expect(html).toContain('class="tape a"');
    expect(html).toContain('class="tape b"');
    expect(html).toContain('data-testid="recap-holes-1"');
    expect(html).toContain('src="/shot/hole.png"');
    expect(html.match(/src="\/shot\/hole.png"/g)).toHaveLength(4);
    expect(html).toContain('animation-delay:0ms');
    expect(html).toContain('animation-delay:90ms');
    expect(html).toContain('animation-delay:180ms');
    expect(html).toContain('animation-delay:270ms');
    expect(html).toContain('data-testid="recap-shot-stamp-1"');
    expect(html).toContain('>SHOT<');
    expect(html).toContain('data-testid="recap-notice-1"');
    expect(html).toContain('>ON NOTICE<');
    expect(html).not.toContain('SHOT · ON NOTICE');
    expect(html).not.toContain('>SET<');
    expect(html).not.toContain('data-testid="recap-shroud-1"');
    expect(html).not.toContain('time-of-death');
    expect(html).not.toContain('recap-tape-0');
    expect(html).toContain('data-testid="recap-side-0" data-blast="no" data-tape="no" data-sheet="no" data-siren="no"');
    expect(html).toContain('data-testid="recap-line-1"');
  });

  it('pulls the tape off once they make their books', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1], []]), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="no" data-tape="no" data-sheet="no" data-siren="no"');
    expect(html).not.toContain('recap-tape-');
    expect(html).not.toContain('recap-shroud-');
    expect(html).not.toContain('time-of-death');
    expect(html).not.toContain('tape-in');
    expect(html).toContain('data-testid="recap-line-1"');
  });

  it('drapes the sheet, RIP, and the siren when the recorded result is a shot-out', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1], [1]], { lost: [1] }), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="no" data-sheet="yes" data-siren="yes"');
    expect(html).toContain('class="tt-team blast shrouded sheet-in"');
    expect(html).toContain('data-testid="recap-shroud-1"');
    expect(html).toContain('data-testid="recap-rip-1"');
    expect(html).toContain('>RIP');
    expect(html).toContain('data-testid="police-lights"');
    expect(html).not.toContain('recap-tape-');
    expect(html).toContain('data-testid="recap-line-1"');
    expect(html).not.toContain('recap-shroud-0');
    expect(html).toContain('data-testid="time-of-death"');
    expect(html).toContain('data-hand="3"');
    expect(caption(html)).toBe('Time of death: Hand 3');
  });

  it('a hand-1 shot-out shows the tape and the sheet, and a non-loss stays tape', () => {
    const html = recap(stamp(toHandOver('joker'), [[1]], { lost: [1] }), names);
    expect(html).toContain('data-testid="recap-side-1" data-blast="yes" data-tape="yes" data-sheet="yes" data-siren="yes"');
    expect(html).toContain('class="tt-team blast taped tape-in shrouded sheet-in"');
    expect(html).toContain('data-testid="recap-tape-1"');
    expect(html).toContain('src="/shot/tape.png"');
    expect(html).not.toContain('recap-holes-');
    expect(html).not.toContain('recap-notice-');
    expect(html).not.toContain('>ON NOTICE<');
    expect(html).toContain('data-testid="recap-rip-1"');
    expect(html).toContain('data-testid="police-lights"');
    expect(html).toContain('data-testid="recap-line-1"');
    expect(html).toContain('data-hand="1"');
    expect(caption(html)).toBe('Time of death: Hand 1');
    const off = recap(stamp(toHandOver('joker'), [[1]], { shotOut: false }), names);
    expect(off).toContain('data-tape="yes" data-sheet="no" data-siren="no"');
    expect(off).not.toContain('recap-shroud-');
    expect(off).not.toContain('police-lights');
    expect(off).not.toContain('time-of-death');
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    const play = audio.slice(audio.indexOf('play(name: Sfx'), audio.indexOf('private sample'));
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'siren'"));
    expect(play.indexOf('if (!this.settings.on')).toBeLessThan(play.indexOf("case 'docSting'"));
    expect(play).toContain("case 'siren': return this.siren");
    expect(play).toContain("case 'docSting': return this.docSting");
    expect(audio).toContain('Original synthesis, no sampled recording');
    expect(audio).toContain('no third-party license');
    expect(audio).toContain('Not based on any show theme');
    const recapSrc = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    expect(recapSrc).toContain("sound.play('siren'");
    expect(recapSrc).toContain("sound.play('docSting'");
    expect(recapSrc).toContain('shotCovers(r, st.history, st.result)');
    expect(recapSrc).not.toContain('shotCounts');
    expect(recapSrc).toContain('covers.some((c) => c.sheet)');
    expect(recapSrc).toContain('Time of death: Hand ${rec.handNo}');
  });

  it('a Cutthroat hand-1 elimination shows tape and the sheet on that player', () => {
    const html = recap(stamp(toHandOver('cutthroat'), [[2]], { lost: [2] }), ['You', 'Ace', 'Bea']);
    expect(html).toContain('data-testid="recap-side-2" data-blast="yes" data-tape="yes" data-sheet="yes" data-siren="yes"');
    expect(html).toContain('class="tt-team blast taped tape-in shrouded sheet-in"');
    expect(html).toContain('data-testid="recap-tape-2"');
    expect(html).toContain('data-testid="recap-shroud-2"');
    expect(html).not.toContain('recap-shroud-0');
    expect(html).not.toContain('recap-tape-0');
    expect(caption(html)).toBe('Time of death: Hand 1');
  });

  it('tapes that Cutthroat player’s own panel', () => {
    const html = recap(stamp(toHandOver('cutthroat'), [[], [2]]), ['You', 'Ace', 'Bea']);
    expect(html).toContain('tt-recap crowded');
    expect(html).toContain('data-testid="recap-side-2" data-blast="yes" data-tape="yes" data-sheet="no" data-siren="no"');
    expect(html).toContain('class="tt-team blast taped tape-in notice"');
    expect(html).toContain('data-testid="recap-tape-2"');
    expect(html).toContain('data-testid="recap-holes-2"');
    expect(html).toContain('data-testid="recap-shot-stamp-2"');
    expect(html).not.toContain('recap-holes-0');
    expect(html).not.toContain('recap-tape-0');
    expect(html).not.toContain('recap-tape-1');
    expect(html).toContain('data-testid="recap-line-2"');
  });

  it('keeps the tape and the sheet at phone widths, and skips only their entrance when motion is reduced', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toContain('tape-slap-a');
    expect(css).toContain('animation-duration: 260ms');
    expect(css).toContain('cubic-bezier(.2, 1.3, .3, 1)');
    expect(css).toContain('brightness(.85)');
    expect(css).toContain('#FF4D4D');
    expect(css).toContain('inset: -8px');
    expect(css).toContain('rotate(-12deg)');
    expect(css).toContain('rotate(12deg)');
    expect(css).toContain('animation: sheet-drop');
    expect(css).toContain('top: calc(54px + env(safe-area-inset-top))');
    expect(css).toContain('.tt-chat-btn { position: fixed; z-index: 1025; top: calc(54px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right));');
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}/g)].map((m) => m[0]);
    const entrance = blocks.find((b) => b.includes('.caution-x') && b.includes('.shroud'));
    expect(entrance).toContain('animation: none');
    expect(entrance).not.toContain('display: none');
    expect(css).not.toMatch(/@media[^{]*max-width[^{]*\{[^}]*(caution-x|\.shroud|police-lights|\.rip|\.tod|shot-holes)/);
    expect(css).toContain('animation: tod-key');
    const tod = blocks.find((b) => b.includes('.tod'));
    expect(tod).toContain('animation: none');
    expect(tod).toContain('opacity: 1');
    expect(tod).not.toContain('display: none');
    expect(css).toContain('animation: police-red');
    expect(css).toContain('animation: police-blue');
    const dim = blocks.find((b) => b.includes('police-lights') || b.includes('police-red'));
    expect(dim).toBeUndefined();
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain("endReason === 'shotOut' && !shotRecapAck");
    expect(table).toContain('setShotRecapAck(true)');
    expect(table).toContain('ran the rest');
    expect(table).not.toContain('Run it — cleared hands');
    const recapSrc = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');
    expect(recapSrc).toContain("haptic([30, 60, 30, 60, 30, 60, 30, 90, 60], 'shot-card')");
    expect(recapSrc).not.toContain('BlastMarks');
    expect(recapSrc).not.toContain('PELLETS');
    const tape = readFileSync(new URL('../public/shot/tape.png', import.meta.url));
    const hole = readFileSync(new URL('../public/shot/hole.png', import.meta.url));
    expect(tape.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(hole.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(tape.length).toBeGreaterThan(8000);
    expect(hole.length).toBeGreaterThan(4000);
  });
});
