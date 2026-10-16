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
 * Longest run, in CSS pixels, where `id` is the card drawn on top. The run is taken along a line
 * parallel to the card's top edge, 20% of the way down, which is where a held fan shows each card.
 * Quads are bottom-left, bottom-right, top-right, top-left. A fully covered card is 0.
 */
export function visibleStripPx(cards: readonly HandHitCard[], id: string, samples = 96): number {
  const card = cards.find((c) => c.id === id);
  if (!card || card.poly.length < 4) return 0;
  const [bl, br, tr, tl] = card.poly as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const f = 0.2;
  const a = { x: tl.x + (bl.x - tl.x) * f, y: tl.y + (bl.y - tl.y) * f };
  const b = { x: tr.x + (br.x - tr.x) * f, y: tr.y + (br.y - tr.y) * f };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return 0;
  let run = 0;
  let best = 0;
  const d = len / samples;
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    if (pickHandCard(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, cards) === id) {
      run += d;
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
