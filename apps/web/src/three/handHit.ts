/**
 * Hand taps use the quads the fan just published. Render and hit test share that list,
 * and it is replaced on every raise, remount, and resize.
 */

export interface HandHitCard {
  id: string;
  order: number;
  poly: { x: number; y: number }[];
}

let hits: HandHitCard[] = [];

export function publishHandHits(next: readonly HandHitCard[]): void {
  hits = next.map((c) => ({ id: c.id, order: c.order, poly: c.poly.map((p) => ({ x: p.x, y: p.y })) }));
  if (typeof window !== 'undefined') {
    (window as unknown as { __bwmHandHits?: HandHitCard[] }).__bwmHandHits = hits;
  }
}

export function publishedHandHits(): readonly HandHitCard[] {
  return hits;
}

export function pointInPoly(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  if (poly.length < 3 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > y) !== (b.y > y)) {
      const t = (y - a.y) / (b.y - a.y);
      if (x < a.x + (b.x - a.x) * t) inside = !inside;
    }
  }
  return inside;
}

/** The card drawn on top at this canvas CSS pixel. Empty when the point misses the fan. */
export function pickHandCard(x: number, y: number, cards: readonly HandHitCard[] = hits): string | null {
  let best: HandHitCard | null = null;
  for (const c of cards) {
    if (!pointInPoly(x, y, c.poly)) continue;
    if (!best || c.order > best.order) best = c;
  }
  return best?.id ?? null;
}
