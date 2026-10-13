import { BufferAttribute, type BufferGeometry, ExtrudeGeometry, Path, Shape, ShapeGeometry } from 'three';
import { OUTLINE_AHEAD, OUTLINE_PX } from './handLift';
import { CH, CR, CT, CW, FACE_CAP_GAP, FELT, RAIL } from './layout';

/**
 * Phone fan cards are about 16% of an 844px screen tall. The stroke is OUTLINE_PX CSS pixels
 * in that fan, in card-local units, so it scales with the card and stays a hairline on the edge.
 */
const PHONE_CARD_PX = 0.16 * 844;

/** Thickness of the per-card outline, in card-local units. The ring starts on the card perimeter. */
export function cardOutlineStroke(): number {
  return (OUTLINE_PX / PHONE_CARD_PX) * CH;
}

function rr(shape: Shape | Path, w: number, h: number, r: number, cx = 0, cy = 0, reverse = false) {
  const x = cx - w / 2, y = cy - h / 2;
  if (!reverse) {
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  } else {
    shape.moveTo(x + r, y);
    shape.quadraticCurveTo(x, y, x, y + r); shape.lineTo(x, y + h - r);
    shape.quadraticCurveTo(x, y + h, x + r, y + h); shape.lineTo(x + w - r, y + h);
    shape.quadraticCurveTo(x + w, y + h, x + w, y + h - r); shape.lineTo(x + w, y + r);
    shape.quadraticCurveTo(x + w, y, x + w - r, y); shape.lineTo(x + r, y);
  }
}

/** Rounded-rectangle shape with circular-ish corners (absarc gives smoother table corners). */
function roundedShape(hx: number, hz: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hx, hz - r);
  s.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hx + r, hz);
  s.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hz + r);
  s.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function remapUV(g: BufferGeometry, w: number, h: number, mirror = false) {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) + w / 2) / w;
    uv[i * 2] = mirror ? 1 - u : u;
    uv[i * 2 + 1] = (pos.getY(i) + h / 2) / h;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
}

let cardGeo: { body: BufferGeometry; front: BufferGeometry; back: BufferGeometry } | null = null;
export function cardGeometry() {
  if (cardGeo) return cardGeo;
  const shape = new Shape();
  rr(shape, CW, CH, CR);
  const body = new ExtrudeGeometry(shape, { depth: CT, bevelEnabled: false, curveSegments: 4 });
  body.translate(0, 0, -CT / 2);
  const front = new ShapeGeometry(shape, 4);
  remapUV(front, CW, CH);
  front.translate(0, 0, CT / 2 + FACE_CAP_GAP);
  const back = new ShapeGeometry(shape, 4);
  remapUV(back, CW, CH, true);
  back.rotateY(Math.PI);
  back.translate(0, 0, -CT / 2 - FACE_CAP_GAP);
  cardGeo = { body, front, back };
  return cardGeo;
}

let outlineGeo: BufferGeometry | null = null;
/**
 * A ring on the card's own rounded rectangle. The hole is the face, tucked a fraction under it
 * so the gold meets the edge with no light gap. The mesh is a child of the card, so the fan roll
 * turns the outline with the card. It is not a rectangle around the hand.
 * OUTLINE_AHEAD lifts the whole ring off the face plane. Coplanar with the polygon-offset face,
 * the ring fails the depth test on iPhone's 16-bit buffer and the highlight never appears.
 */
export function cardOutlineGeometry(): BufferGeometry {
  if (outlineGeo) return outlineGeo;
  const stroke = cardOutlineStroke();
  const tuck = stroke * 0.35;
  const outer = new Shape();
  rr(outer, CW + stroke * 2, CH + stroke * 2, CR + stroke);
  const hole = new Path();
  rr(hole, CW - tuck * 2, CH - tuck * 2, Math.max(0.001, CR - tuck), 0, 0, true);
  outer.holes.push(hole);
  const g = new ShapeGeometry(outer, 4);
  g.translate(0, 0, CT / 2 + FACE_CAP_GAP + OUTLINE_AHEAD);
  outlineGeo = g;
  return g;
}

/** Felt surface (flat, y = 0). UVs in world units. */
export function feltGeometry(): BufferGeometry {
  const g = new ShapeGeometry(roundedShape(FELT.hx, FELT.hz, FELT.r), 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Padded wooden rail around the felt (bevelled ring). */
export function railGeometry(): BufferGeometry {
  const outer = roundedShape(FELT.hx + RAIL, FELT.hz + RAIL, FELT.r + RAIL);
  // holes must wind opposite to the outline
  outer.holes.push(new Path(roundedShape(FELT.hx, FELT.hz, FELT.r).getPoints(48).reverse()));
  const g = new ExtrudeGeometry(outer, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5, curveSegments: 32 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.02, 0);
  return g;
}

/** Table apron / body under the rail. */
export function bodyGeometry(): BufferGeometry {
  const s = roundedShape(FELT.hx + RAIL + 0.02, FELT.hz + RAIL + 0.02, FELT.r + RAIL);
  const g = new ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 32 });
  g.rotateX(Math.PI / 2);
  g.translate(0, -0.035, 0); // keep the bevelled top cap below the felt
  return g;
}
