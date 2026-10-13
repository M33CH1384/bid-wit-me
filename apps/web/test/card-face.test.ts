import { describe, expect, it } from 'vitest';
import { retainFrontTexture, showResumeHand3D, shownFaceIds, trickFacesShown } from '../src/three/cardFace';

/**
 * The painter walks the hand one card per frame and starts over when its key changes.
 * Selecting a card rerenders the fan. That render must not put the BWM back on a card
 * whose face has already been dealt.
 */
describe('dealt faces survive a selection', () => {
  const hand = ['10H', 'KH', '4S', 'AS', '2C'] as const;

  function paint(prev: ReadonlySet<string>, cards: readonly string[], nFaces: number, trick: readonly string[] = []) {
    const order = [...cards, ...trick];
    return shownFaceIds(prev, order.slice(0, nFaces), new Set(order));
  }

  function sides(shown: ReadonlySet<string>, cards: readonly string[]) {
    return cards.map((id) => (shown.has(id) ? 'face' as const : 'back' as const));
  }

  it('selecting a card never changes the other cards face/back state', () => {
    const dealt = paint(new Set(), hand, hand.length);
    const before = sides(dealt, hand);
    expect(before).toEqual(['face', 'face', 'face', 'face', 'face']);

    for (const picked of hand) {
      // The painter restarts on the selection render and this frame only names the tapped card.
      const reported = paint(dealt, hand, 1, []);
      const onlyTapped = shownFaceIds(dealt, [picked], new Set(hand));
      for (const next of [reported, onlyTapped]) {
        hand.forEach((id, i) => {
          if (id === picked) return;
          expect(sides(next, hand)[i]).toBe(before[i]);
        });
      }
      // A full reset (nFaces back to 0) still keeps every dealt face.
      expect(sides(paint(dealt, hand, 0), hand)).toEqual(before);
    }
  });

  it('keeps a dealt face when the front texture prop drops to null', () => {
    const face = { id: '10H' };
    const other = { id: 'KH' };
    const back = { id: 'bwm' };
    // The tapped card and every other card retain the texture they already showed.
    expect(retainFrontTexture(null, face)).toBe(face);
    expect(retainFrontTexture(null, other)).toBe(other);
    expect(retainFrontTexture(null, face)).not.toBe(back);
    expect(retainFrontTexture(face, null)).toBe(face);
  });

  it('shows trick cards face-up even when the hand painter has not reached them', () => {
    const hand = ['AS', 'KS', 'QS'] as const;
    const trick = ['2C', '3D'];
    const here = new Set<string>([...hand, ...trick]);
    // The painter reset to 0 when the trick changed: nothing in this frame is "painted" yet.
    const shown = trickFacesShown(new Set(hand), [], here, trick);
    for (const id of trick) expect(shown.has(id)).toBe(true);
    for (const id of hand) expect(shown.has(id)).toBe(true);
    // A card that left the table does not keep a face.
    expect(trickFacesShown(shown, [], new Set(hand), []).has('2C')).toBe(false);
  });

  it('hides the 3D hand fan until a resumed hand has faces, so it does not stack on the felt fan', () => {
    expect(showResumeHand3D(true, 13, 0)).toBe(false);
    expect(showResumeHand3D(true, 13, 12)).toBe(false);
    expect(showResumeHand3D(true, 13, 13)).toBe(true);
    expect(showResumeHand3D(false, 13, 0)).toBe(true);
    expect(showResumeHand3D(true, 0, 0)).toBe(true);
  });

  it('leaves a card on its back until that card has been dealt', () => {
    const here = new Set<string>(hand);
    const partial = shownFaceIds(new Set(), ['10H'], here);
    expect(partial.has('10H')).toBe(true);
    expect(partial.has('KH')).toBe(false);
    expect(partial.has('4S')).toBe(false);
    const selected = shownFaceIds(partial, ['10H'], here);
    expect(selected.has('KH')).toBe(false);
    expect(selected.has('4S')).toBe(false);
    expect(selected.has('10H')).toBe(true);
  });
});
