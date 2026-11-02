/**
 * Stage framing for the 3D story figures (pure; no three — unit-tested). The stage is measured from the live DOM:
 * the figure band runs from the bottom of the cast row to the top of the dialogue card, so the card never covers a
 * face in any orientation. All three figures get the SAME height (equal head size), Dee in the middle (seat 2).
 * Framing is chest-up with headroom: the head top sits HEADROOM of the band below its top, and VISIBLE_SPAN of the
 * figure's height (head + shoulders + chest) fills the rest of the band; the legs run on behind the card.
 */
export type StageSlot = 'left' | 'dee' | 'right';
export interface BandRect { stageW: number; stageH: number; top: number; bottom: number }
export interface SlotFrame { slot: StageSlot; cx: number; headTop: number; height: number }

/** Fraction of a figure's full height shown in the band (head to mid-chest). */
export const VISIBLE_SPAN = 0.36;
/** Gap above the head, as a fraction of the band height. */
export const HEADROOM = 0.08;
/** Shoulder width as a fraction of figure height (width guard so three figures never overlap). */
export const SHOULDER_SPAN = 0.24;

export function frameStage(b: BandRect): SlotFrame[] {
  const bandH = Math.max(1, b.bottom - b.top);
  const byHeight = (bandH * (1 - HEADROOM)) / VISIBLE_SPAN;
  const byWidth = (b.stageW / 3) * 0.92 / SHOULDER_SPAN;
  const height = Math.min(byHeight, byWidth);
  const headTop = b.top + bandH * HEADROOM;
  // seats spread across the stage; on a narrow portrait stage they pull in slightly so shoulders stay inside
  const spread = Math.min(b.stageW / 3, height * SHOULDER_SPAN * 1.15);
  const mid = b.stageW / 2;
  return [
    { slot: 'left', cx: mid - spread, headTop, height },
    { slot: 'dee', cx: mid, headTop, height },
    { slot: 'right', cx: mid + spread, headTop, height },
  ];
}

/** The band from live DOM rects (stage-relative). Falls back to the top 60% of the stage when a rect is missing. */
export function bandFromRects(stage: { left: number; top: number; width: number; height: number },
  castBottom: number | null, cardTop: number | null): BandRect {
  const top = castBottom !== null ? Math.max(0, castBottom - stage.top) : 0;
  const rawBottom = cardTop !== null ? cardTop - stage.top : stage.height * 0.6;
  const bottom = Math.min(stage.height, Math.max(top + 40, rawBottom));
  return { stageW: stage.width, stageH: stage.height, top, bottom };
}

/** The band height at which a stage this wide is exactly filled chest-up (width-limited figures). On a narrow
 *  portrait stage a taller band would only shrink the figures to full-body, so the layout asks for this much. */
export function bandForWidth(stageW: number): number {
  const height = (stageW / 3) * 0.92 / SHOULDER_SPAN;
  return Math.round((height * VISIBLE_SPAN) / (1 - HEADROOM));
}
