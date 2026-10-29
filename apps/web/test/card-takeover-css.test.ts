/**
 * LEVEL-UP CARD TAKEOVER — the CSS contract (owner, 2026-10-29).
 * The behavioral pins live in card-takeover.test.ts (happy-dom); these
 * source pins guard the presentation the owner specified, in the same
 * read-the-stylesheet style as the other CSS contracts: the held card
 * leans TOWARD the player and rotates RIGHT, the hero size is
 * viewport-bound (height-bound in short landscape, everything in view),
 * the card presents alone (no profile below-column), and the motion is
 * transform/opacity only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = css.slice(css.indexOf('.rw-takeover {'), css.indexOf('/* Daily-bonus receipt'));

describe('card takeover CSS contract', () => {
  it('the stylesheet carries the takeover', () => {
    expect(block.length).toBeGreaterThan(200);
  });

  it('the held card leans TOWARD the viewer and rotates RIGHT', () => {
    // top edge coming at the player = negative rotateX; a rightward
    // rotation = positive (clockwise) rotate
    expect(block).toMatch(/rotateX\(-/);
    expect(block).toMatch(/rotate\(4deg\)|rotate\(3\.5deg\)|rotate\(5deg\)/);
  });

  it('the hero card is sized off the viewport — width in portrait, height-bound in landscape', () => {
    expect(block).toMatch(/--cardw:\s*min\(84vw, 52dvh/);
    expect(block).toMatch(/@media \(max-height: 520px\)/);
  });

  it('the takeover shows the card alone — the profile below-column stays out of it', () => {
    expect(block).toMatch(/\.rw-takeover \.pcard-below\s*\{\s*display: none/);
  });

  it('motion is transform/opacity only — no canvas, no layout animation', () => {
    expect(block).not.toMatch(/animation:[^;]*(width|height|top|left)/);
  });
});
