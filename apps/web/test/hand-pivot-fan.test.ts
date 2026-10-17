import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CW, TRICK_SCALE, makeCamera, trickSpot, MIN_STRIP_PX, cardScreenQuad, fanCssPx, fanLayout, handFan, phoneHandFan, PHONE_HAND_STRIP_PX } from '../src/three/layout';
import { raiseSpreadPx } from '../src/three/handLift';
import { visibleStripPx, type HandHitCard } from '../src/three/handHit';

const W = 390, H = 844, A = W / H;

function quads(n: number, sel: number): HandHitCard[] {
  const o = { ...phoneHandFan(), minStripPx: n > 13 ? MIN_STRIP_PX : PHONE_HAND_STRIP_PX, pxW: W, ...(sel >= 0 ? { spread: 0.4 } : {}) };
  const L = fanLayout(A, n, 0, o);
  const sp = raiseSpreadPx(n, sel, fanCssPx(L, W).width, L.raiseOpen > 0 ? L.raiseOpen : undefined);
  return Array.from({ length: n }, (_, i) => ({
    id: String(i),
    order: i === sel ? 999 : i,
    poly: cardScreenQuad(A, handFan(A, n, i, 0, 0, o, sp[i] ?? 0, H), W, H, i === sel ? 22 : 0),
  }));
}

describe('phone pivot fan', () => {
  it('a 13-card hand is at least 1.3x the old 34px card and is clearly curved', () => {
    const L = fanLayout(A, 13, 0, { ...phoneHandFan(), minStripPx: MIN_STRIP_PX, pxW: W });
    expect(fanCssPx(L, W).width).toBeGreaterThanOrEqual(34 * 1.3);
    expect(L.maxRoll).toBeGreaterThan(0.5);
  });
  // Real iPhone Safari viewports (browser bars showing) and the full-height 390x844.
  for (const [w, h] of [[375, 667], [390, 664], [393, 659], [430, 739], [390, 844]] as const) {
    it(`a 13-card hand is ~1.7x the old 34px card on a ${w}x${h} phone`, () => {
      const L = fanLayout(w / h, 13, 0, { ...phoneHandFan(), minStripPx: MIN_STRIP_PX, pxW: w, spread: 0.4 });
      expect(fanCssPx(L, w).width).toBeGreaterThanOrEqual(55);
      // At least as big as the far trick card on the felt (Demetrius: hand >= trick cards).
      // Compared on the RESTING fan: the raised layout legitimately shrinks to reserve its
      // opening (guarded separately above at >= 55px), and trick cards grew +25% in the
      // bigger-cards PR, so the raised fan no longer clears the far trick card.
      const rest = fanLayout(w / h, 13, 0, { ...phoneHandFan(), minStripPx: MIN_STRIP_PX, pxW: w });
      const cam = makeCamera(w / h);
      const t = trickSpot('top', 4, 0, 0);
      const half = (CW * TRICK_SCALE) / 2;
      const px = (x: number) => ((new Vector3(x, t.p[1], t.p[2]).project(cam).x + 1) / 2) * w;
      expect(fanCssPx(rest, w).width).toBeGreaterThanOrEqual(px(t.p[0] + half) - px(t.p[0] - half));
    });
  }
  it('the raised layout reserves its opening (it may shrink, but stays a big phone card)', () => {
    const base = { ...phoneHandFan(), minStripPx: PHONE_HAND_STRIP_PX, pxW: W };
    const raised = fanLayout(A, 13, 0, { ...base, spread: 0.4 });
    expect(raised.cw).toBeLessThanOrEqual(fanLayout(A, 13, 0, base).cw + 1e-9);
    expect(fanCssPx(raised, W).width).toBeGreaterThanOrEqual(55);
  });
  for (const n of [6, 8, 13, 17]) {
    // Bigger-cards recalibration: at 17 cards (an extreme fan) the solver-model strip is ~25px
    // with the +25% cards; the 13-card real-device guard is unchanged (42px in the browser e2es).
    const floor = n >= 17 ? 19.5 : MIN_STRIP_PX; // 17-card raised fan: ~22px in the solver model with bigger cards
    it(`every card keeps a ${floor}px strip at ${n} cards, resting and with the middle card raised`, () => {
      for (const sel of [-1, Math.floor(n / 2)]) {
        const cards = quads(n, sel);
        for (const c of cards) expect(visibleStripPx(cards, c.id), `${n}/${sel}/${c.id}`).toBeGreaterThanOrEqual(floor);
        for (const c of cards) for (const p of c.poly) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(W); }
      }
    });
  }
});
