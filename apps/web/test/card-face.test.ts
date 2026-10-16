import { describe, expect, it } from 'vitest';
import { cardShowsFace, feltHandVisible, handLatched, latchHand, presentHand, resetHandLatch, retainFrontTexture, showResumeHand3D, shownFaceIds, trickFacesShown, visibleFaceIds } from '../src/three/cardFace';

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

  it('shows faces for cards other seats played, not only the local hand', () => {
    const mine = ['AS', 'KS', 'QS'] as const;
    const trick = ['QH', 'JD', '2C'];
    // The painter only walked the local hand. The bots' plays were never dealt here.
    const shown = trickFacesShown(new Set(mine), [...mine], new Set(mine), trick);
    for (const id of trick) expect(cardShowsFace(id, shown, trick)).toBe(true);
    for (const id of mine) expect(cardShowsFace(id, shown, trick)).toBe(true);
    // A rebuild cleared the set and only handed back the cards still in the local hand.
    const rebuilt = trickFacesShown(new Set(), [], new Set(mine), trick);
    for (const id of trick) {
      expect(rebuilt.has(id)).toBe(true);
      expect(cardShowsFace(id, new Set(), trick)).toBe(true);
    }
  });

  it('keeps other seats face-up across two tricks, including a resize of the second', () => {
    const mine = ['AS', 'KS', 'QS', 'JS'] as const;
    const trick1 = ['QH', 'JD', '2C', 'AH'];
    const trick2 = ['10H', '9D', '8C', 'KH'];
    let shown = trickFacesShown(new Set(mine), [...mine], new Set([...mine, ...trick1]), trick1);
    for (const id of trick1) expect(cardShowsFace(id, shown, trick1)).toBe(true);
    // Trick 1 left the table. Those backs must not be what trick 2 paints.
    shown = trickFacesShown(shown, [], new Set(mine), []);
    for (const id of trick1) expect(cardShowsFace(id, shown, [])).toBe(false);
    // Trick 2: the painter only has the local hand. The bots' new cards still show.
    shown = trickFacesShown(shown, [], new Set(mine), trick2);
    for (const id of trick2) expect(cardShowsFace(id, shown, trick2)).toBe(true);
    const rebuilt = trickFacesShown(new Set(), [], new Set(mine), trick2);
    for (const id of trick2) {
      expect(rebuilt.has(id)).toBe(true);
      expect(cardShowsFace(id, new Set(), trick2)).toBe(true);
    }
  });

  it('a bot Run it! slam is face-up for a seat that never held those cards, and for a spectator', () => {
    const viewer = visibleFaceIds(new Set(['AS', 'KS']), [], ['AS', 'KS'], [], ['BJ', 'LJ']);
    expect(viewer.has('BJ')).toBe(true);
    expect(viewer.has('LJ')).toBe(true);
    expect(viewer.has('AS')).toBe(true);
    const spectator = visibleFaceIds(new Set(), [], [], [], ['BJ', 'LJ', '3D']);
    expect([...spectator].sort()).toEqual(['3D', 'BJ', 'LJ']);
    // A rebuild that cleared the painter set still shows the slam, the same way a trick card stays up.
    for (const id of ['BJ', 'LJ']) expect(cardShowsFace(id, new Set(), ['BJ', 'LJ'])).toBe(true);
  });

  it('a human claimer\'s slam cards stay face-up after they leave the hand', () => {
    const shown = visibleFaceIds(new Set(['BJ', 'LJ', '3H']), [], ['3H'], [], ['BJ', 'LJ']);
    expect(shown.has('BJ')).toBe(true);
    expect(shown.has('LJ')).toBe(true);
    expect(shown.has('3H')).toBe(true);
    expect(cardShowsFace('BJ', shown, ['BJ', 'LJ'])).toBe(true);
    expect(cardShowsFace('3H', shown, ['BJ', 'LJ'])).toBe(true);
  });

  it('keeps trick cards face-up when a resize rebuilds the painter mid-trick', () => {
    const hand = ['AS', 'KS', 'QS'] as const;
    const trick = ['10S', '4S', '2C'];
    // Painter restarted: nothing remembered, nothing painted this frame, and the only
    // ids it was given are the cards still in the hand. The lead and the rest of the trick stay up.
    const shown = trickFacesShown(new Set(), [], new Set(hand), trick);
    for (const id of trick) {
      expect(shown.has(id)).toBe(true);
      expect(cardShowsFace(id, new Set(), trick)).toBe(true);
    }
    for (const id of hand) {
      expect(shown.has(id)).toBe(false);
      expect(cardShowsFace(id, shown, trick)).toBe(false);
    }
    // Once the hand walk resumes, dealt faces come back and the trick stays up.
    const walked = trickFacesShown(shown, hand, new Set([...hand, ...trick]), trick);
    for (const id of [...hand, ...trick]) expect(cardShowsFace(id, walked, trick)).toBe(true);
    // A card that left the trick does not keep a face.
    expect(trickFacesShown(shown, [], new Set(hand), []).has('10S')).toBe(false);
    expect(cardShowsFace('10S', new Set(), [])).toBe(false);
  });

  it('keeps the 3D fan off the felt fan until a resumed hand has faces, then does not take it down again', () => {
    expect(showResumeHand3D(true, 13, 0)).toBe(false);
    expect(showResumeHand3D(true, 13, 12)).toBe(false);
    expect(showResumeHand3D(true, 13, 13)).toBe(true);
    // A tap or trick change restarts the painter at 0. The fan that is already up stays up.
    expect(showResumeHand3D(true, 13, 0, true)).toBe(true);
    expect(showResumeHand3D(true, 10, 0, true)).toBe(true);
    expect(showResumeHand3D(false, 13, 0)).toBe(true);
    expect(showResumeHand3D(true, 0, 0)).toBe(true);
  });

  it('shows a reloaded mid-game hand immediately, and a tap never blanks it', () => {
    // Online reload: intro is over, nothing is latched, no face has painted. The felt fan is the hand.
    const reloaded = presentHand({ cardCount: 10, resume: true, latched: false, facesReady: 0 });
    expect(reloaded).toEqual({ webgl: false, felt: true, visible: 10 });
    expect(feltHandVisible(10, true, false)).toBe(true);

    // The painter finishes and the 3D fan takes over.
    const ready = presentHand({ cardCount: 10, resume: true, latched: false, facesReady: 10 });
    expect(ready).toEqual({ webgl: true, felt: false, visible: 10 });

    // The next tap resets the painter. The hand stays on the 3D fan; it does not swap back to felt or disappear.
    const tapped = presentHand({ cardCount: 10, resume: true, latched: true, facesReady: 0 });
    expect(tapped).toEqual({ webgl: true, felt: false, visible: 10 });
    expect(feltHandVisible(10, true, true)).toBe(false);
  });

  it('counts a visible card for every card in state', () => {
    for (const cardCount of [1, 10, 13, 17]) {
      const waiting = presentHand({ cardCount, resume: true, latched: false, facesReady: 0 });
      const live = presentHand({ cardCount, resume: true, latched: true, facesReady: 0 });
      const dealing = presentHand({ cardCount, resume: false, latched: false, facesReady: 0 });
      for (const fans of [waiting, live, dealing]) {
        expect(fans.visible).toBe(cardCount);
        expect(fans.webgl || fans.felt).toBe(true);
        expect(fans.webgl && fans.felt).toBe(false);
      }
    }
    expect(presentHand({ cardCount: 0, resume: true, latched: false, facesReady: 0 })).toEqual({ webgl: false, felt: false, visible: 0 });
    // A fresh deal is the 3D fan, so the flat fan does not stack on it.
    expect(feltHandVisible(13, false, false)).toBe(false);
  });

  it('keeps the 3D latch for the hand that was drawn, including after the group remounts', () => {
    resetHandLatch();
    expect(handLatched(2)).toBe(false);
    latchHand(2);
    expect(handLatched(2)).toBe(true);
    expect(handLatched(3)).toBe(false);
    expect(showResumeHand3D(true, 10, 0, handLatched(2))).toBe(true);
    resetHandLatch();
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
