import { BufferAttribute, type BufferGeometry, ExtrudeGeometry, Path, Shape, ShapeGeometry } from 'three';
import { CH, CR, CT, CW, FELT, RAIL } from './layout';

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
  front.translate(0, 0, CT / 2 + 0.0002);
  const back = new ShapeGeometry(shape, 4);
  remapUV(back, CW, CH, true);
  back.rotateY(Math.PI);
  back.translate(0, 0, -CT / 2 - 0.0002);
  cardGeo = { body, front, back };
  return cardGeo;
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
