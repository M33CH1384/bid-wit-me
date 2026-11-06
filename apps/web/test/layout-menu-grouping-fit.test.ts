/**
 * Finding G (responsive audit 2026-11-05, W4 Phase 2): the in-game (☰)
 * menu hierarchy. Phase 1 found one flat list/grid: Help and Score pad
 * (the two mid-hand reaches) visually identical to Graphics and to each
 * per-player voice mute; the three voice controls split across two
 * landscape grid rows with a dead cell; voice names wrapping and
 * inflating rows; landscape rows floored at minmax(40px, auto) — under
 * the 44px tap floor; the portrait menu the only overlay in the sweep
 * with no max-height/scroll bound; Leave separated + danger-ringed only
 * in landscape, a plain last row in portrait.
 *
 * Fix (presentation only — every label, testid and handler preserved;
 * the Leave confirmation flow is untouched): prominent Help + Score
 * rows; a DISPLAY group (Graphics / View / Turn Up); a VOICES group of
 * compact per-player chips under one heading (the heading carries the
 * "voices" wording the chips used to repeat; the full
 * "{name} voice: on|muted" wording survives as each chip's aria-label
 * and the full name as its title, with the visible name ellipsized on
 * one line); Social full-width; Leave separated by a divider and
 * danger-styled full-width in BOTH orientations; every row floored at
 * 44px; the portrait menu gains the max-height + internal scroll the
 * landscape tier already had.
 *
 * These pins parse the shipped TSX + CSS (the house fit-test idiom);
 * rendered geometry is verified separately on the Chromium rig
 * (captures/w4).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tsx = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const menu = tsx.slice(tsx.indexOf('data-testid="game-menu"'), tsx.indexOf('data-testid="menu-leave"') + 700);

/** The base (portrait/default) .game-menu rule body. */
const baseMenu = (() => {
  const i = css.indexOf('\n.game-menu {');
  return css.slice(i, css.indexOf('}', i));
})();

/** The short-landscape menu block (the S1 tier that re-lays the menu),
 *  anchored on its panel-width constant so comments inside the block
 *  cannot shift the slice. */
const landMenu = (() => {
  const anchor = css.indexOf('min(640px, 75vw)');
  const start = css.lastIndexOf('@media', anchor);
  return css.slice(start, css.indexOf('\n}\n', anchor));
})();

describe('Finding G: game-menu grouping (Phase 2)', () => {
  it('keeps every testid, label and handler from the flat menu', () => {
    for (const id of ['help', 'scorepad-button', 'view-toggle', 'turnup-toggle', 'menu-leave']) {
      expect(menu, id).toContain(`data-testid="${id}"`);
    }
    expect(menu).toContain('voice-mute-${seat}');
    expect(menu).toContain('Help: tips &amp; book counting');
    expect(menu).toContain('Score pad &amp; house rules');
    expect(menu).toContain('Graphics:');
    expect(menu).toContain('View:');
    expect(menu).toContain('Turn up:');
    expect(menu).toContain('Leave table');
    // Leave still runs the shared gesture machine (confirmation untouched)
    expect(menu).toContain("runLeaveMenu(e, 'leave')");
    expect(tsx).toContain("runLeaveMenu(e, 'scrim')");
  });

  it('orders the menu as prominent pair, DISPLAY group, VOICES group, Social, Leave', () => {
    const at = (s: string) => menu.indexOf(s);
    expect(at('menu-primary')).toBeGreaterThan(-1);
    expect(at('data-testid="help"')).toBeGreaterThan(at('menu-primary'));
    expect(at('data-testid="scorepad-button"')).toBeGreaterThan(at('data-testid="help"'));
    expect(at('menu-group-head')).toBeGreaterThan(at('data-testid="scorepad-button"'));
    expect(at('Graphics:')).toBeGreaterThan(at('data-testid="scorepad-button"'));
    expect(at('data-testid="view-toggle"')).toBeGreaterThan(at('Graphics:'));
    expect(at('data-testid="turnup-toggle"')).toBeGreaterThan(at('data-testid="view-toggle"'));
    expect(at('menu-voices')).toBeGreaterThan(at('data-testid="turnup-toggle"'));
    expect(at('voice-mute-')).toBeGreaterThan(at('menu-voices'));
    expect(at('menu-social')).toBeGreaterThan(at('voice-mute-'));
    expect(at('data-testid="menu-leave"')).toBeGreaterThan(at('menu-social'));
    // two group headings: DISPLAY and VOICES
    expect(menu.match(/menu-group-head/g)!.length).toBeGreaterThanOrEqual(2);
    expect(menu).toContain('>Display<');
    expect(menu.toUpperCase()).toContain('VOICES');
  });

  it('voice chips are compact: heading carries the wording, full label survives accessibly', () => {
    // the chip's accessible name keeps the original "{name} voice: on|muted"
    expect(menu).toMatch(/aria-label=\{`[^`]*voice: /);
    // the full name stays inspectable (title) even when the visible name ellipsizes
    expect(menu).toContain('title={names[seat]}');
    expect(menu).toContain('voice-chip-name');
    expect(menu).toContain('voice-chip-state');
  });

  it('portrait menu is height-bound with internal scroll (was the only unbounded overlay)', () => {
    expect(baseMenu).toContain('max-height:');
    expect(baseMenu).toContain('100dvh');
    expect(baseMenu).toContain('overflow-y: auto');
  });

  it('every menu row is floored at 44px in both orientations', () => {
    expect(css).toMatch(/\.game-menu \.menu-act \{[^}]*min-height: 44px/);
    // the old sub-44 landscape row floor is gone
    expect(landMenu).not.toContain('minmax(40px');
    expect(landMenu).not.toContain('minmax(40px, auto)');
  });

  it('Leave is separated and danger-styled in the base (portrait) rules too', () => {
    expect(menu).toContain('menu-divider');
    // the base .danger rule (before the landscape tier) gains the ring +
    // centring landscape already had — portrait no longer gets colour alone
    const landAt = css.lastIndexOf('@media', css.indexOf('min(640px, 75vw)'));
    const baseCss = css.slice(0, landAt);
    const i = baseCss.indexOf('.game-menu > button.danger');
    const body = baseCss.slice(i, baseCss.indexOf('}', i));
    expect(body).toContain('box-shadow: inset 0 0 0 1.5px #ff4d6d');
    expect(body).toContain('text-align: center');
    expect(body).toContain('color: #ff4d6d');
  });

  it('landscape lays out by group: prominent pair in 2, group items in 3, no dead cell', () => {
    expect(landMenu).toContain('.menu-primary');
    expect(landMenu).toMatch(/\.menu-primary \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(landMenu).toMatch(/\.menu-group-items \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(landMenu).toContain('.menu-social');
    expect(landMenu).toContain('grid-column: 1 / -1');
  });

  it('voice names ellipsize on one line instead of wrapping and inflating the row', () => {
    const chipName = css.slice(css.indexOf('.voice-chip-name {'), css.indexOf('}', css.indexOf('.voice-chip-name {')));
    expect(chipName).toContain('text-overflow: ellipsis');
    expect(chipName).toContain('white-space: nowrap');
    expect(chipName).toContain('min-width: 0');
    expect(chipName).toContain('overflow: hidden');
  });
});
