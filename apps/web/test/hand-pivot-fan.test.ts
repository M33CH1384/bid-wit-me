import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CW, TRICK_SCALE, makeCamera, trickSpot, MIN_STRIP_PX, cardScreenQuad, fanCssPx, fanLayout, handFan, phoneHandFan } from '../src/three/layout';
import { raiseSpreadPx } from '../src/three/handLift';
import { visibleStripPx, type HandHitCard } from '../src/three/handHit';

const W = 390, H = 844, A = W / H;

function quads(n: number, sel: number): HandHitCard[] {
  const o = { ...phoneHandFan(), minStripPx: MIN_STRIP_PX, pxW: W, ...(sel >= 0 ? { spread: 0.4 } : {}) };
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
      // at least as big as the far trick card on the felt (Demetrius: hand >= trick cards)
      const cam = makeCamera(w / h);
      const t = trickSpot('top', 4, 0, 0);
      const half = (CW * TRICK_SCALE) / 2;
      const px = (x: number) => ((new Vector3(x, t.p[1], t.p[2]).project(cam).x + 1) / 2) * w;
      expect(fanCssPx(L, w).width).toBeGreaterThanOrEqual(px(t.p[0] + half) - px(t.p[0] - half));
    });
  }
  it('keeps the card size the same when a card is raised', () => {
    const base = { ...phoneHandFan(), minStripPx: MIN_STRIP_PX, pxW: W };
    expect(fanLayout(A, 13, 0, { ...base, spread: 0.4 }).cw).toBeCloseTo(fanLayout(A, 13, 0, base).cw, 6);
  });
  for (const n of [6, 8, 13, 17]) {
    it(`every card keeps a 28px strip at ${n} cards, resting and with the middle card raised`, () => {
      for (const sel of [-1, Math.floor(n / 2)]) {
        const cards = quads(n, sel);
        for (const c of cards) expect(visibleStripPx(cards, c.id), `${n}/${sel}/${c.id}`).toBeGreaterThanOrEqual(MIN_STRIP_PX);
        for (const c of cards) for (const p of c.poly) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(W); }
      }
    });
  }
});
