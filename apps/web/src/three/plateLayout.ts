/**
 * Joint plate layout for the three upper seat plates (partner top-centre,
 * opponents left/right) — the DOM badges three/Scene.tsx positions from the
 * 3D seat anchors.
 *
 * WHY ONE JOINT SOLVE (owner bug 2026-10-30: "Depending on my tilt my
 * partner's plate jumps up and down repeatedly"): the plates used to be
 * placed by three independent per-plate callbacks that read each other's
 * LIVE DOM rects, plus a dataset.moved flag the side plates set when they
 * had to dodge the partner plate — and the partner plate snapped up under
 * the scorebug whenever that flag was set. The partner's clamped resting
 * position sits exactly on the side plates' hit threshold (the clamp
 * `minSideTop - 6 - ph/2` lands the partner's bottom edge precisely where
 * the side's hit test `cy0 - ph/2 - 6 < tp.bottom` flips), so the tiniest
 * measurement epsilon (sub-pixel rect rounding at phone DPRs) flipped the
 * hit on every layout pass across a whole tilt band: side hits -> moved ->
 * partner snaps up -> side clears -> partner drops back -> hits again. A
 * period-2 limit cycle, up to ~114px at tilt -14.5 on the real camera
 * math (diagnosis sim, 2026-10-30), while the side plates themselves
 * barely moved — their winning dodge is their natural spot.
 *
 * The fix: solve all three plates ONCE from inputs that never include a
 * previously-applied plate position — projected anchors, measured plate
 * SIZES and relative offsets (bubble/tag overhangs), the static top bar,
 * trick slots and HUD rects. Cross-plate obstacles are the other plates'
 * NATURAL (pre-snap) rects; the partner plate is then clamped/snapped
 * against the SOLVED side positions. This module is a pure function of
 * its inputs (no DOM, no three), so applying its output cannot change
 * its next output: the layout reaches its fixed point in a single pass
 * at every tilt/zoom. test/plate-jitter.test.ts sweeps the tilt range
 * and pins that convergence.
 */

export interface PlateRect { left: number; right: number; top: number; bottom: number }

/** Partner (top seat) geometry, all derived at its NATURAL position
 *  (projected anchor clamped under the top bar, before side interaction). */
export interface TopPlateGeom {
  cx: number; cy: number; // natural centre
  minY: number; // bar + 8 + up — the highest centre the plate may take
  ph: number; // clamp height (plate ∪ bubble height, as the old branch measured)
  body: PlateRect; // plate body rect at the natural position
  union: PlateRect; // body ∪ video bubble at the natural position
  bubble: PlateRect | null; // video bubble rect at the natural position
}

export interface SidePlateGeom {
  side: 'left' | 'right';
  ax: number; // edge anchor x (left edge for the left plate, right edge for the right)
  y: number; // projected anchor y
  pw: number; ph: number; // measured size (at the plate's current class state)
  up: number; // how far above the centre anything reaches (the TO PLAY tag)
  wideW: number; // cached wide width — narrow decisions are made at wide width
  narrowW: number | null; // cached narrow width, once a narrow frame was measured
  body: PlateRect; // plate body rect at the NATURAL position (cy0)
  bubble: PlateRect | null; // video bubble rect at the natural position
}

export interface PlateSolveInput {
  width: number; height: number;
  barFloor: number; // top bar bottom (trump strip / scorebug), fallback included
  slots: PlateRect[]; // trick-slot rects (pure projection of the live camera)
  hud: PlateRect[]; // static HUD rects the plates must not cover
  top: TopPlateGeom | null;
  sides: SidePlateGeom[];
}

export interface SideSolve {
  x: number; cy: number;
  moved: boolean; // the plate had to dodge (the old layout's dataset.moved)
  wantNarrow: boolean; // the plate wants its narrow composition at this geometry
  cy0: number; // natural centre before dodging
  cands: [number, number, number][]; // [x, cy, cost] per candidate when moved (debug mirror)
}

export interface PlateSolve {
  top: { cx: number; cy: number } | null;
  sides: Record<'left' | 'right', SideSolve | undefined>;
}

const area = (a: PlateRect, b: PlateRect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** A side plate's natural centre: its projected anchor, floored under the top bar. */
export function plateCy0(y: number, barFloor: number, up: number): number {
  return Math.max(y, barFloor + 8 + up);
}

export function solvePlates(input: PlateSolveInput): PlateSolve {
  const { width, height, barFloor, slots, hud, top } = input;
  const sidesOut = {} as Record<'left' | 'right', SideSolve | undefined>;

  const solveSide = (s: SidePlateGeom): SideSolve => {
    const { side, ax } = s;
    const y = s.y;
    const up = s.up;
    const cy0 = Math.max(y, barFloor + 8 + up);
    const hits = (w: number, h: number, cy: number) => {
      const l = side === 'left' ? ax : ax - w, r = l + w;
      return slots.filter((t) => r + 6 > t.left && l - 6 < t.right && cy + h / 2 + 6 > t.top && cy - h / 2 - 6 < t.bottom);
    };
    // Narrow is decided at the WIDE width against the trick slots only (the
    // old rule), so the decision never depends on the plate's current class —
    // and the width the placement uses is the width its own decision implies.
    const wantNarrow = hits(s.wideW, s.ph, cy0).length > 0;
    const pw = wantNarrow ? (s.narrowW ?? s.pw) : s.pw;
    const ph = s.ph;
    // The partner's plate is a hard obstacle too, not just the trick slots:
    // in portrait the side anchors project INTO the band the partner plate is
    // pinned to under the scorebug, and three plates cannot share that band.
    // The obstacle is the partner's NATURAL rect — never the rect a previous
    // pass applied, which was the feedback that oscillated.
    const tp = top?.union;
    let topHit = false;
    if (tp) {
      const l = side === 'left' ? ax : ax - pw, r = l + pw;
      topHit = r + 6 > tp.left && l - 6 < tp.right && cy0 + ph / 2 + 6 > tp.top && cy0 - ph / 2 - 6 < tp.bottom;
    }
    if (!hits(pw, ph, cy0).length && !topHit) return { x: ax, cy: cy0, moved: false, wantNarrow, cy0, cands: [] };
    // Everything else the plate must not cover, all at natural/solved
    // positions (never last pass's applied rects). The other plates weigh
    // like trick slots; the rest of the HUD keeps its old weight.
    const other = input.sides.find((o) => o.side !== side);
    const plateRects: PlateRect[] = [];
    if (top) { plateRects.push(top.body); if (top.bubble) plateRects.push(top.bubble); }
    if (other) { plateRects.push(other.body); if (other.bubble) plateRects.push(other.bubble); }
    const cost = (px: number, cy: number) => {
      const l = side === 'left' ? px : px - pw;
      const box = { left: l - 6, right: l + pw + 6, top: cy - ph / 2 - 6, bottom: cy + ph / 2 + 6 };
      const real = { left: l, right: l + pw, top: cy - ph / 2, bottom: cy + ph / 2 };
      const off = cy - ph / 2 < barFloor + 4 || cy + ph / 2 > height - 4 ? 1e9 : 0;
      // a real overlap costs far more than only crowding the 6 px breathing room
      return off + slots.reduce((a, t) => a + area(real, t) * 400 + area(box, t) * 10, 0)
        + plateRects.reduce((a, r) => a + area(real, r) * 400 + area(box, r) * 10, 0)
        + hud.reduce((a, r) => a + area(real, r) * 40 + area(box, r), 0);
    };
    const inward = (cy: number) => {
      let px = ax;
      for (const r of [...plateRects, ...hud]) if (r.top < cy + ph / 2 + 6 && r.bottom > cy - ph / 2 - 6) px = side === 'left' ? Math.max(px, r.right < width / 2 ? r.right + 6 : px) : Math.min(px, r.left > width / 2 ? r.left - 6 : px);
      // never past the middle: a seat's plate stays on that seat's side of the table
      return side === 'left' ? Math.min(px, width / 2 - pw) : Math.max(px, width / 2 + pw);
    };
    // candidates: the natural spot, then — when a trick slot is in the way — just above the
    // trick zone, just below it, and below it but slid in from the edge (clear of the controls)
    const hit = hits(pw, ph, cy0);
    const cands: [number, number][] = [[ax, cy0]];
    if (hit.length) {
      const up2 = Math.min(...hit.map((t) => t.top)) - 6 - ph / 2;
      let down = Math.max(...hit.map((t) => t.bottom)) + 6 + ph / 2;
      for (let k = 0; k < 4; k++) { const more = hits(pw, ph, down); if (!more.length) break; down = Math.max(...more.map((t) => t.bottom)) + 6 + ph / 2; }
      cands.push([ax, up2], [ax, down], [inward(down), down], [inward(up2), up2]);
    }
    // right under the partner's plate (top band): the stagger step when the side plate's
    // natural spot collides with the partner plate above the trick zone
    if (tp) {
      cands.push([ax, tp.bottom + 6 + ph / 2]);
      // tucked under the plate body when this plate is clear of the (round) bubble sideways
      if (top && top.bubble) {
        const tpr = top.body, tbr = top.bubble;
        const l = side === 'left' ? ax : ax - pw, r = l + pw;
        if (r + 6 <= tbr.left || l - 6 >= tbr.right) cands.push([ax, tpr.bottom + 6 + ph / 2]);
      }
    }
    let best = cands[0]!, bc = Infinity;
    const scored = cands.map((c) => {
      const k = cost(c[0], c[1]);
      if (k < bc) { bc = k; best = c; }
      return [c[0], c[1], k] as [number, number, number];
    });
    return { x: best[0], cy: best[1], moved: true, wantNarrow, cy0, cands: scored };
  };

  for (const s of input.sides) sidesOut[s.side] = solveSide(s);

  // The partner plate goes last, against the SOLVED side positions: it
  // stays clear of the side plates below it, and if a side plate had to
  // move out of the trick zone it stays as high as it can, so the two
  // don't chase each other (the side plate may be tucked right under it).
  let topOut: PlateSolve['top'] = null;
  if (top) {
    let cy = top.cy;
    const solvedSides = input.sides
      .map((s) => ({ s, out: sidesOut[s.side] }))
      .filter((p): p is { s: SidePlateGeom; out: SideSolve } => !!p.out);
    const tops = solvedSides.map(({ s, out }) => out.cy - s.ph / 2).filter((t) => t > 0);
    if (tops.length) cy = Math.max(top.minY, Math.min(cy, Math.min(...tops) - 6 - top.ph / 2));
    if (solvedSides.some(({ out }) => out.moved)) cy = top.minY;
    topOut = { cx: top.cx, cy };
  }
  return { top: topOut, sides: sidesOut };
}
