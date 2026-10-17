import { type HandHitCard } from './three/handHit';

type Pt = { x: number; y: number };

function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > y) !== (b.y > y) && x < a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)) inn = !inn;
  }
  return inn;
}

/** True when any point of the rectangle lies inside a card (sampled every 3px). */
export function rectHitsCards(r: { left: number; top: number; right: number; bottom: number }, hits: readonly HandHitCard[]): boolean {
  for (let y = r.top; y <= r.bottom; y += 3) for (let x = r.left; x <= r.right; x += 3) if (hits.some((h) => inside(h.poly, x, y))) return true;
  return false;
}

/**
 * The open space inside a curved fan, under the middle card and between the two legs.
 * Picks the highest `minH`-tall band in that hole that is `minW` wide, with 4px clear of every card.
 * Returns null when there is no hand or the hole is too small.
 */
export function archSpot(hits: readonly HandHitCard[], screenW: number, screenH: number, minW = 76, minH = 34): { x: number; top: number; w: number } | null {
  if (hits.length < 3) return null;
  const cx = screenW / 2;
  const hit = (x: number, y: number) => hits.some((h) => inside(h.poly, x, y));
  let edge = -1;
  for (let y = 0; y < screenH; y += 2) if (hit(cx, y)) edge = y;
  if (edge < 0) return null;
  for (let top = edge + 4; top + minH <= screenH - 4; top += 4) {
    let left = 0, right = screenW;
    for (let y = top; y <= top + minH; y += 4) {
      let l = cx, r = cx;
      while (l > 0 && !hit(l, y)) l -= 2;
      while (r < screenW && !hit(r, y)) r += 2;
      left = Math.max(left, l + 4);
      right = Math.min(right, r - 4);
    }
    const w = Math.floor(right - left);
    // the highest band that fits: inside the arch, as close under the cards as it can be
    if (w >= minW) return { x: Math.round((left + right) / 2), top, w };
  }
  return null;
}
