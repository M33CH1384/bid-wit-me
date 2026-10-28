/**
 * Wave B CSS pins: the held timings of the rebuilt AnimFx systems (each
 * within ±10% of its shipped value — the CSS constants ARE the spec),
 * the recapfx swap (wire / photo finish / confetti rules retired from
 * animfx.css), theme-parity accents, and the §C scenario styles.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');

describe('wave B held timings (seconds, as shipped → as rebuilt)', () => {
  it('the rebuilt one-shots keep their shipped durations', () => {
    expect(css).toContain('animation: animfx-shock 1.1s'); // Run It shockwave 1.1 → 1.1
    expect(css).toContain('animation: animfx-bjring .9s'); // Big Joker slam .9 → .9
    expect(css).toContain('animation: animfx-bagdrop .95s'); // Bag Drop .95 → .95
    expect(css).toContain('animation: animfx-broom 2.35s'); // Boston Broom 2.35 → 2.35
    expect(css).toContain('animation: animfx-wheelspin 1.85s'); // Wheels 1.85 → 1.85
    expect(css).toContain('animation: animfx-surge 1.45s'); // Comeback Surge 1.45 → 1.45
    expect(css).toContain('animation: animfx-mp 1.7s'); // Match-Point period 1.7 → 1.7 (double heartbeat inside it)
    expect(css).toContain('animation: animfx-setbrick 1.45s'); // The Set 1.45 → 1.45
    expect(css).toContain('animation: animfx-firstbook 2.25s'); // First Book 2.25 → 2.25
    expect(css).toContain('animation: animfx-misdeal 1s'); // Misdeal 1.0 → 1.0
    expect(css).toContain('animation: animfx-beam .95s'); // In Sync .95 → .95
    expect(css).toContain('animation: animfx-savebeam .9s'); // The Save .9 → .9
    expect(css).toContain('animation: animfx-ember .88s'); // Spades Broken .88 → .88
    expect(css).toContain('animation: animfx-nilseal 1.3s'); // Nil Sealed bloom 1.3 → 1.3
    expect(css).toContain('animation: animfx-stamp 3s'); // Payback stamp 3 → 3
  });

  it('the board-edge wave fits inside the shot\'s 1000 ms (travel + burn)', () => {
    expect(css).toContain('animation: animfx-boardrun .68s');
  });
});

describe('wave B recapfx swap', () => {
  it('the superseded wire / photo-finish / confetti shot rules are gone from animfx.css', () => {
    expect(css).not.toContain('.animfx-wire {');
    expect(css).not.toContain('@keyframes animfx-wire');
    expect(css).not.toContain('.animfx-confetti');
    expect(css).not.toContain('@keyframes animfx-confetti-fall');
    expect(css).not.toContain('.animfx-stamp.photofinish');
  });
});

describe('wave B §C + parity styles', () => {
  it('all eight new scenarios have their styles', () => {
    for (const cls of [
      '.animfx-doublemoon', '.animfx-shush', '.animfx-ninelives', '.animfx-assassin',
      '.animfx-guillotine', '.animfx-textbook', '.animfx-mirrorframe', '.animfx-setbrick.cold',
      '.animfx-sealmark', '.bug-team.animfx-deadcontract', '.trash-callout.animfx-deflate',
    ]) expect(css).toContain(cls);
  });

  it('Neon swaps only the rebuilt accents\' palette (visuals only)', () => {
    expect(css).toContain('html[data-theme="neon"] .animfx-shock');
    expect(css).toContain('html[data-theme="neon"] .animfx-mirrorframe');
    expect(css).toContain('html[data-theme="neon"] .animfx-boardedge');
  });

  it('the reduced-motion backstop covers the new external hooks', () => {
    expect(css).toContain('.trash-callout.animfx-deflate');
    expect(css).toContain('.table-screen.animfx-tableshake');
  });
});
