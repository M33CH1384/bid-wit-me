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

/**
 * Longest horizontal run, in CSS pixels, where `id` is the card drawn on top.
 * A fully covered card is 0. The run is taken through the middle of that card.
 */
export function visibleStripPx(cards: readonly HandHitCard[], id: string, samples = 64): number {
  const card = cards.find((c) => c.id === id);
  if (!card || card.poly.length < 3) return 0;
  const xs = card.poly.map((p) => p.x);
  const ys = card.poly.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  if (!(x1 > x0) || !Number.isFinite(y)) return 0;
  const dx = (x1 - x0) / samples;
  let run = 0;
  let best = 0;
  for (let s = 0; s <= samples; s++) {
    const x = x0 + dx * s;
    if (pickHandCard(x, y, cards) === id) {
      run += dx;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
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
