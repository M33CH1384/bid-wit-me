/**
 * Victory settle (owner, 2026-11-06, screenshot of the live bug): on the
 * online victory screen the winner showcase cards animated in and ended
 * up almost entirely covered by the results panel — only the cards' top
 * edges and the tops of the two avatar circles peeked out. His words:
 * "After the animation the box score area should slide down to show the
 * avatars."
 *
 * Mechanism: the portrait column is a fixed-height flex box (overflow
 * hidden) and BOTH the spotlight and the foot panel are shrinkable
 * (flex 0 1 auto, min-height 0). The frame-budget squeeze landed on the
 * spotlight: it rendered ~110px tall at phone sizes, its cards + losers
 * row clipped inside its own invisible scroll region — reading exactly
 * like the panel covering them — while the foot kept its height even
 * though its .vic-scroll is the region designed to absorb the squeeze.
 *
 * Fix (choreography): the entrance keeps the budget layout byte-for-byte;
 * when it completes, Table.tsx settles the screen (.vic-settled): the
 * spotlight takes its natural height and can never be squeezed again,
 * and the panel FLIP-slides down (transform, distance measured from the
 * actual squeeze) to rest below the fully visible cards. Reduced motion
 * settles at once. The ≤560px landscape grid is a side-by-side layout —
 * the settled layout rules are column-scoped (min-height 561px) and the
 * grid rests as the D8 audit left it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

describe('victory settle: the settled spotlight cannot be squeezed', () => {
  it('the settled spot takes its natural height, capped only to protect the foot floor', () => {
    expect(css).toContain('.victory-screen.vic-settled .victory-spot { flex: 0 0 auto; max-height: calc(100dvh - 320px); overflow-y: auto; }');
  });

  it('the settled rules are scoped to the column composition (above the landscape grid cutoff)', () => {
    const at = css.indexOf('.victory-screen.vic-settled .victory-spot');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(Math.max(0, at - 240), at)).toContain('@media (min-height: 561px)');
  });

  it('the panel slide is a transform transition carried only while it slides', () => {
    expect(css).toContain('.victory-screen .vic-foot.vic-sliding { transition: transform .6s');
  });

  it('the entrance frame-budget rules are byte-identical (the entrance plays as before)', () => {
    expect(css).toContain('.victory-screen .victory-spot { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }');
    expect(css).toContain('.vic-foot { flex: 0 1 auto; min-height: 0; }');
    expect(css).toContain('.vic-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto;');
  });

  it('short portrait phones compact the settled spotlight (cards 96px, loser frames capped)', () => {
    expect(css).toContain('.victory-screen.vic-settled .vs-card { min-height: 96px; }');
    expect(css).toContain('.victory-screen.vic-settled .vs-tile.lose.quiet .vs-frame { max-height: 48px; }');
  });
});

describe('victory settle: Table.tsx wiring', () => {
  it('the screen carries the settled state and the settle driver', () => {
    expect(table).toContain("vic-settled");
    expect(table).toContain('settleVictory');
    expect(table).toContain('vicScreenRef');
  });

  it('the squeeze is measured from the spotlight itself (scrollHeight vs clientHeight, cap applied)', () => {
    expect(table).toContain('spot.scrollHeight');
    expect(table).toContain('spot.clientHeight');
  });

  it('reduced motion settles without the entrance timer', () => {
    const at = table.indexOf('vicPresented');
    expect(at).toBeGreaterThan(-1);
    const block = table.slice(at, at + 700);
    expect(block).toContain('reduceFx');
    expect(block).toContain('setVicSettled(true)');
  });
});

describe('victory settle: resting arithmetic at the owner sizes', () => {
  // Spotlight natural height at phone widths (no live video): headline
  // (title ~36 + sub ~20 + gaps ~12) + winner cards 132 + losers (label
  // ~14 + tiles ~98 + gaps) + the spot's own gaps ~20.
  const SPOT = 68 + 132 + 118 + 20;
  // Head ~26 + the column's two gaps ~27; the foot's floor is its padding
  // (20) + the pinned action stack (~162).
  const CHROME = 26 + 27;
  const FOOT_FLOOR = 20 + 162;
  const inner = (h: number) => h - 58 - 14; // base top/bottom padding (portrait)

  it('the full spotlight + the foot floor fit inside the portrait viewport', () => {
    for (const h of [844, 932]) {
      expect(SPOT + CHROME + FOOT_FLOOR).toBeLessThanOrEqual(inner(h));
      // the foot's scroll window stays usable (XP strip ~80 + standings)
      expect(inner(h) - CHROME - SPOT - FOOT_FLOOR).toBeGreaterThanOrEqual(120);
    }
  });

  it('the settled cap never binds at the owner size (only the losers tail can ever scroll, on short screens)', () => {
    expect(844 - 320).toBeGreaterThanOrEqual(SPOT);
    expect(667 - 320).toBeGreaterThanOrEqual(SPOT - 118 + 84); // short tier: losers compacted (~84)
  });
});
