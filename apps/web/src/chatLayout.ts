/** Chat starts open only on a wide desktop. Phones and narrow windows keep it collapsed. */
export function chatStartsOpen(width: number, height: number): boolean {
  return width >= 1280 && height >= 700;
}

export interface Box { x: number; y: number; w: number; h: number }
export interface Rect { left: number; top: number; right: number; bottom: number }

/** Top edge of an over-cut banner ('SIT DOWN!' and the rest). Above the trick when the trump bar leaves room, otherwise just below the cards. */
export function overcutBannerTop(trick: Box[], viewH: number, bannerH = 64): number {
  if (!trick.length) return Math.round(viewH * 0.16);
  const top = Math.min(...trick.map((t) => t.y));
  const bottom = Math.max(...trick.map((t) => t.y + t.h));
  const above = top - bannerH - 10;
  if (above >= 96) return Math.round(above);
  return Math.round(bottom + 10);
}

/** A trash-talk bubble beside the speaker's plate, off the trick and the rest of the felt obstacles. */
export function placeCallout(
  plate: Rect | null,
  seat: string,
  size: { w: number; h: number },
  view: { w: number; h: number },
  obstacles: Rect[],
): { left: number; top: number } {
  const { w, h } = size;
  const clamp = (x: number, y: number) => ({
    left: Math.max(8, Math.min(x, view.w - w - 8)),
    top: Math.max(78, Math.min(y, view.h - h - 8)),
  });
  const hits = (p: { left: number; top: number }) => obstacles.some((r) => p.left < r.right && p.left + w > r.left && p.top < r.bottom && p.top + h > r.top);
  const spots: { left: number; top: number }[] = [];
  if (plate) {
    const cx = (plate.left + plate.right) / 2;
    if (seat === 'left' || seat === 'right') {
      spots.push(clamp(plate.left, plate.top - h - 8), clamp(plate.right - w, plate.top - h - 8));
    } else if (seat === 'top') {
      spots.push(clamp(cx - w / 2, plate.bottom + 8), clamp(plate.left, plate.top - h - 8));
    } else {
      spots.push(clamp(plate.left, plate.top - h - 8), clamp(8, plate.top - h - 8));
    }
  }
  spots.push(clamp(8, 86), clamp(view.w - w - 8, 86));
  return spots.find((p) => !hits(p)) ?? spots[0]!;
}
