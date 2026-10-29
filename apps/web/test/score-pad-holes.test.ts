/**
 * Persistent bullet holes on the score pad board (owner, 2026-10-29: "When a team
 * gets set the bullet hole should be persistent in the score card").
 *
 * The recap punches holes on its transient card; the pad board used to carry only
 * data attributes + a set-count text. These pins hold the pad to the persistence
 * contract: hole EXISTENCE derives from holeMarks(history) alone — exactly
 * min(3, shots) holes per side on every render, including a cold render with an
 * empty rememberHoles store (the relaunch / never-saw-the-recap case).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { ScorePad } from '../src/ScorePad';
import { clearTeamHoles } from '../src/shotMarks';

function toHandOver(mode: 'joker' | 'cutthroat'): GameState {
  const rules = mode === 'cutthroat' ? makeRules('cutthroat', { playerCount: 3, targetScore: 300 }) : makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, `padholes-${mode}`);
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

/** Replace history with numeric-bid hands. `sideShots[hand]` lists the sides set that hand. Hand 1 is index 0. */
function stamp(st: GameState, sideShots: number[][], opts: { shotOut?: boolean } = {}): GameState {
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
  return {
    ...st,
    rules: { ...st.rules, shotOut: opts.shotOut !== false },
    result: null,
    history,
    handNo: history.length,
    phase: 'handOver',
  };
}

function pad(st: GameState, names: string[]) {
  return renderToStaticMarkup(createElement(ScorePad, {
    st, names, onClose: () => {}, sideName: (side: number) => names[side] ?? `Side ${side}`,
  }));
}

/** The hole <img> attribute strings inside one side's pad-holes span (empty when the span is absent). */
function padHoleImgs(html: string, side: number): string[] {
  const m = html.match(new RegExp(`data-testid="pad-holes-${side}"[^>]*>([\\s\\S]*?)</span>`));
  if (!m) return [];
  return [...m[1]!.matchAll(/<img\b([^>]*)>/g)].map((x) => x[1] ?? '');
}

describe('score pad — persistent bullet holes', () => {
  const names = ['You', 'Hana', 'Mei', 'Jamal'];
  beforeEach(() => clearTeamHoles());

  it('no shots, no holes — and a brand-new game starts clean', () => {
    const html = pad(stamp(toHandOver('joker'), [[], []]), names);
    expect(html).not.toContain('pad-holes-');
    expect(html).not.toContain('/shot/hole.png');
    const fresh = pad(newGame(makeRules('joker', { targetScore: 500 }), 'padholes-new'), names);
    expect(fresh).not.toContain('pad-holes-');
    expect(fresh).not.toContain('/shot/hole.png');
  });

  it('one hole per shot, capped at three, on the side that took them', () => {
    const base = toHandOver('joker');
    const one = pad(stamp(base, [[], [1]]), names);
    expect(padHoleImgs(one, 1)).toHaveLength(1);
    expect(padHoleImgs(one, 0)).toHaveLength(0);
    expect(one).not.toContain('data-testid="pad-holes-0"');

    clearTeamHoles();
    const two = pad(stamp(base, [[], [1], [1]]), names);
    expect(padHoleImgs(two, 1)).toHaveLength(2);

    clearTeamHoles();
    const three = pad(stamp(base, [[], [1], [1], [1]]), names);
    const threeImgs = padHoleImgs(three, 1);
    expect(threeImgs).toHaveLength(3);
    // the recap's slot rotations, in order — the pad speaks the same hole language
    expect(threeImgs[0]).toContain('--rot:-8deg');
    expect(threeImgs[1]).toContain('--rot:9deg');
    expect(threeImgs[2]).toContain('--rot:-6deg');
    for (const attrs of threeImgs) expect(attrs).toContain('/shot/hole.png');

    clearTeamHoles();
    const four = pad(stamp(base, [[], [1], [1], [1], [1]]), names);
    expect(four).toContain('data-holes="4"');
    expect(padHoleImgs(four, 1)).toHaveLength(3); // the 4th shot adds tally, not a hole
  });

  it('holes render identically on a cold store — the relaunch case, no recap ever watched', () => {
    const st = stamp(toHandOver('joker'), [[], [1], [1]]);
    // the pad is the FIRST surface rendered for this game: the store has never
    // been touched by a recap, so nothing but history can be feeding the holes
    const first = pad(st, names);
    expect(padHoleImgs(first, 1)).toHaveLength(2);
    // simulate a full relaunch mid-game: in-memory store gone, same history
    clearTeamHoles();
    const relaunched = pad(st, names);
    expect(padHoleImgs(relaunched, 1)).toHaveLength(2);
    const strip = (s: string) => s.replaceAll(' class="hole-in"', '');
    expect(strip(padHoleImgs(relaunched, 1).join('|'))).toBe(strip(padHoleImgs(first, 1).join('|')));
    expect(relaunched).toContain('data-holes="2"');
  });

  it('only the fresh hole may punch in, and only in the hand’s immediate aftermath', () => {
    const st = stamp(toHandOver('joker'), [[], [1]]);
    const aftermath = pad(st, names);
    const imgs = padHoleImgs(aftermath, 1);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain('class="hole-in"');
    // mid-game (the hand after, still unplayed-out): the hole is simply there
    clearTeamHoles();
    const midGame = pad({ ...st, phase: 'playing' }, names);
    const midImgs = padHoleImgs(midGame, 1);
    expect(midImgs).toHaveLength(1);
    expect(midImgs[0]).not.toContain('hole-in');
  });

  it('cutthroat: holes land on the individual player’s board', () => {
    const cutNames = ['You', 'Ace', 'Bea'];
    const st = stamp(toHandOver('cutthroat'), [[2], [], [2]]);
    const html = pad(st, cutNames);
    expect(padHoleImgs(html, 2)).toHaveLength(2);
    expect(padHoleImgs(html, 0)).toHaveLength(0);
    expect(padHoleImgs(html, 1)).toHaveLength(0);
    expect(html).not.toContain('data-testid="pad-holes-0"');
    expect(html).not.toContain('data-testid="pad-holes-1"');
  });

  it('the holes CSS lives in the shared theme region (both themes), pad-sized, with a landscape seat', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const neonAt = css.indexOf('html[data-theme="neon"]');
    const baseAt = css.indexOf('.pad-board-holes {');
    const imgAt = css.indexOf('.pad-board-holes img {');
    expect(baseAt).toBeGreaterThan(-1);
    expect(imgAt).toBeGreaterThan(-1);
    // shared region: before the Neon token block, so Classic gets the same holes
    expect(baseAt).toBeLessThan(neonAt);
    expect(imgAt).toBeLessThan(neonAt);
    expect(css).toContain('.pad-board-holes img { width: 20px; height: 20px;');
    expect(css).toContain('.score-pad.v2 .pad-board-holes { grid-column: 2; grid-row: 4; }');
    // the pad punch is its own keyframes (hole-punch carries the recap's centering translate)
    expect(css).toContain('@keyframes pad-hole-punch');
    expect(css).toContain('.pad-board-holes img.hole-in { animation: pad-hole-punch 120ms');
    // and it calms under reduced motion alongside the recap's punch
    expect(css).toContain('.shot-holes img.hole-in, .pad-board-holes img.hole-in');
  });
});
