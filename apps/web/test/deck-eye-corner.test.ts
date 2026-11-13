import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Deck tile eye corner (owner, 2026-11-08, with his setup screenshot):
 * "The eye button should be in the upper right corner of the card."
 * The eye (DeckGallery's .dg-eye) used to ride the cover's upper LEFT,
 * over the art's rank-index corner; it moves to the upper RIGHT with the
 * same 2px insets, the same 44×44 target, and the same z-order — a pure
 * mirror. The "Your deck" badge (.dg-inuse) held the upper right until
 * now, so the two corner elements trade corners in the same move: the
 * badge takes the upper left rather than sitting under the eye's chip
 * on the chosen tile. One shared rule serves every deck strip (bot
 * setup + online create) and both themes. These pins parse the shipped
 * CSS (the deck-tile-fit idiom) so the corners can't drift back.
 */
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = css.slice(css.indexOf('.deck-gallery {'), css.indexOf('.db-backdrop'));

const rule = (re: RegExp) => {
  const m = block.match(re);
  if (!m) throw new Error(`rule not found: ${re}`);
  return m[1]!;
};
const eye = rule(/\.dg-eye \{([^}]*)\}/);
const inuse = rule(/\.dg-inuse \{([^}]*)\}/);

describe('deck tile eye sits in the upper right corner (owner 2026-11-08)', () => {
  it('the eye is anchored top-right with the same 2px insets it had top-left', () => {
    expect(eye).toContain('top: 2px');
    expect(eye).toContain('right: 2px');
    expect(eye).not.toMatch(/(^|;)\s*left\s*:/);
  });

  it('the eye keeps its 44×44 target and its z-order above the cover art', () => {
    expect(eye).toContain('width: 44px');
    expect(eye).toContain('height: 44px');
    expect(eye).toContain('z-index: 2');
  });

  it('the "Your deck" badge takes the upper left, clear of the eye', () => {
    expect(inuse).toContain('top: 14px');
    expect(inuse).toContain('left: 14px');
    expect(inuse).not.toMatch(/(^|;)\s*right\s*:/);
  });

  it('one placement definition each — both themes share the corners', () => {
    expect(css.match(/\.dg-eye \{/g)).toHaveLength(1);
    expect(css.match(/^\.dg-inuse \{/gm)).toHaveLength(1);
  });
});
