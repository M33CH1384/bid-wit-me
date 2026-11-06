import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';

/** Card size in world units (poker ratio 2.5 × 3.5) and exaggerated stock thickness so the edge reads in 3D. */
export const CW = 0.25;
export const CH = 0.35;
export const CT = 0.004;
export const CR = 0.022;
/**
 * How far the face plane sits in front of the extruded front cap, in card-local units.
 * iPhone Safari's 16-bit depth fights at about 0.0003 world units once the card is a metre
 * from the camera. 0.0002 local is about 0.00008 world on a phone fan, so the cap and the
 * pips quantize to the same depth and the cream cap wins. 0.0025 local clears a few of
 * those steps at the smallest fan scale, and stays under a pixel on screen.
 */
export const FACE_CAP_GAP = 0.0025;
/**
 * Camera-space gap between neighbouring fan cards. Smaller depth is closer.
 * A near-bias larger than this step pulls one card in front of the next and hides its rank.
 */
export const HAND_DEPTH_STEP = 0.006;
/**
 * How far a playable card comes toward the camera.
 * It stays under one fan step, so the card to its right — already one step closer —
 * keeps the overlap. A bigger pull put the whole lifted suit in front of the next
 * cards and hid them.
 */
export const PLAY_DEPTH = HAND_DEPTH_STEP * 0.35;
/**
 * A raised card comes forward of those playable neighbours too, so its whole face
 * wins the depth test. Four steps past the play bias clears the cards it overlaps.
 */
export const SELECT_DEPTH = PLAY_DEPTH + 4 * HAND_DEPTH_STEP;

/** Felt half-extents and rail width. */
export const FELT = { hx: 1.5, hz: 1.78, r: 0.95 };
export const RAIL = 0.2;

export type SeatPos = 'bottom' | 'left' | 'top' | 'right';

export interface Xform {
  p: [number, number, number];
  q: [number, number, number, number];
  s: number;
}

export function xf(p: [number, number, number], e: [number, number, number], s = 1, order: 'YXZ' | 'XYZ' = 'YXZ'): Xform {
  const q = new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2], order));
  return { p, q: [q.x, q.y, q.z, q.w], s };
}

/** Where each seat "is" on the table (unit direction from the centre) for 4 or 3 players. */
export function seatDir(pos: SeatPos, n: number): Vector3 {
  if (n === 3 && pos === 'left') return new Vector3(-0.86, 0, -0.5).normalize();
  if (n === 3 && pos === 'right') return new Vector3(0.86, 0, -0.5).normalize();
  switch (pos) {
    case 'bottom': return new Vector3(0, 0, 1);
    case 'top': return new Vector3(0, 0, -1);
    case 'left': return new Vector3(-1, 0, 0);
    case 'right': return new Vector3(1, 0, 0);
  }
}

/** Point on the felt edge (just inside the rail) in direction d. */
export function edgePoint(d: Vector3, inset = 0): Vector3 {
  // approximate the rounded rectangle with a superellipse-ish clamp
  const sx = (FELT.hx - inset) / Math.max(Math.abs(d.x), 1e-6);
  const sz = (FELT.hz - inset) / Math.max(Math.abs(d.z), 1e-6);
  const s = Math.min(sx, sz);
  const p = d.clone().multiplyScalar(s);
  // pull diagonal points in for the rounded corners
  const diag = Math.abs(d.x) > 0.2 && Math.abs(d.z) > 0.2;
  return diag ? p.multiplyScalar(0.86) : p;
}

const yawOf = (d: Vector3) => Math.atan2(d.x, d.z);

/**
 * Fan rest pose (owner, 2026-10-28; state/gating in fanRest.ts): how far a
 * resting fan drops and how much its spread closes, at channel amount 1.
 * The pose is two channels: DROP lowers, PINCH tightens (a fraction of
 * the open spread/roll removed). The human fan's drop is in card heights
 * on the camera plane; the opponent fan's drop is in world units. Both
 * channels at 0 reproduce the open pose EXACTLY, and a caller that
 * passes only a drop amount gets pinch = drop (the original combined
 * pose) — sitting portrait passes pinch 0 explicitly: lower, no narrow.
 */
export const FAN_REST_DROP_CH = 0.42;
export const FAN_REST_TIGHTEN = 0.36;
/** Opponent fan centre height (open pose). Dropped 0.30 → 0.25
 *  (owner 2026-10-30: Queenie's fan cut across her chin/neck at the
 *  partner seat): at 0.30 the fan's top edge reaches y≈0.45, the
 *  chin line of the shorter seated figures; at 0.25 the fan is held
 *  at chest height with the head clear above it. Everything that
 *  derives from this transform (the figures' grips and head-clearance
 *  gates, deal flights) follows the fan down together. Round 2
 *  (owner 2026-10-30 13:16: the partner's face "still protruding
 *  through the cards"): 0.25 → 0.165 — at 0.25 the shortest cast
 *  member's chin still met the fan's top edge in screen space from
 *  the sitting camera even with the world-space gate satisfied;
 *  the fan now sits at sternum height, the way a held fan rides
 *  when the holder peers over it. The rest drop eased 0.11 → 0.09
 *  with it so the lowered fan's bottom edge keeps its clearance
 *  over the rail. */
/* Round 4 (owner 2026-11-05): the lowering rounds overshot — "the
 * opponents cards sit on the table instead of 'behind' it as if a
 * player were holding them", and the partner's fan vanished behind
 * her torso. At BASE_Y 0.162 the open fan's bottom edge grazed the
 * felt (+0.013) and the rested fan's bottom edge sat BELOW the felt
 * plane (−0.077) with its grip line under the table (−0.17 at rest):
 * beyond honest arm reach from a seated figure, so the placement
 * reach settle dragged figures forward into the hunch the owner
 * photographed. Face clearance was never the fan's job — the figure
 * solve's head/chin gate (world + screen) owns it, and it now runs
 * against the full 13-card fan even when placement mounts before the
 * deal. The fan goes back UP and OUT to a held anchor: BASE_Y
 * 0.162 → 0.26 (open bottom edge +0.109 over the felt, grip line
 * above it), REST_DROP 0.09 → 0.07 (rested bottom edge +0.039 — a
 * lowered fan still clears the felt), BASE_OUT 0.02 → 0.10 with
 * REST_OUT 0.15 → 0.08 (the rested fan keeps ~its Round-3 spot, the
 * open fan's body now sits past the felt's far edge line toward the
 * holder), BASE_OUT_SIDE 0.12 → 0.16. The flight-corner law that
 * floored BASE_Y only binds downward — raising grows the slam
 * corner's clearance from ~0.0026 to ~0.10. Anchors pinned by
 * test/fan-held-anchor.test.ts. */
export const OPP_FAN_BASE_Y = 0.26;
export const OPP_FAN_REST_DROP = 0.07;
export const OPP_FAN_REST_OUT = 0.08;
export const OPP_FAN_REST_TIGHTEN = 0.45;
/** Round 3 (owner 2026-11-01, Mac screenshot: the partner's face
 *  covered by her fan at the north seat): BASE_Y 0.165 -> 0.162 and
 *  the open fan's seatward offset 0.12 -> 0.02 (BASE_OUT) at the
 *  top/bottom seats — the held fan rides lower and further over the
 *  felt, the way a player leans in over the table; REST_OUT 0.05 ->
 *  0.15 keeps the RESTED fan at its exact Round-2 spot
 *  (0.02 + 0.15 = 0.12 + 0.05), so only the open (acting) fan moved.
 *  The SIDE seats keep their Round-2 offsets (BASE_OUT_SIDE /
 *  REST_OUT_SIDE): their profile faces already clear their fans
 *  (the owner's same screenshot), and the inboard move measurably
 *  stole the side book piles' new clearance (3D SAT sweep). Tilt
 *  was measured and rejected as a lever: tipping the top edge down
 *  swings it toward the head plane by the same amount — a wash in
 *  the sightline. BASE_Y's floor is set by the card flights' corner
 *  law, not the face: below it the launch pose's lowest corner dips
 *  under the felt plane and the flight must lift the card at t=0 (a
 *  visible pop; flight-pose.test.ts and run-slam.test.ts pin the
 *  endpoints exact). The binding case is the slam's offset fan cards
 *  (opponentFan('top', 4, 1, 5)): corner +0.0056 at 0.165, so the
 *  base can fall 0.003 and no further — at 0.162 that corner clears
 *  by ~0.0026 and the centre-card flight corner by ~0.012; the rest
 *  of the sightline gain comes from FIGURE_SCALE (1.33). */
export const OPP_FAN_BASE_OUT = 0.10;
export const OPP_FAN_BASE_OUT_SIDE = 0.16;
export const OPP_FAN_REST_OUT_SIDE = 0.05;

const clampRest = (rest: number | undefined): number => (Number.isFinite(rest) && rest! > 0 ? Math.min(1, rest!) : 0);

/** Opponent's held fan: upright cards near the rail, backs toward the table centre.
 *  `rest` is the DROP channel (0..1, off-turn only — scope in fanRest.ts:
 *  Sitting at any aspect, Standing in landscape): it lowers the whole fan
 *  toward the seat's edge and settles it outward. `pinch` is the TIGHTEN
 *  channel: it closes the fan's spread; it defaults to the drop amount
 *  (the original combined pose), and sitting portrait passes 0 — the fan
 *  lowers at its open width. 0/0 = today's fan. */
export function opponentFan(pos: SeatPos, n: number, i: number, count: number, rest = 0, pinch = rest): Xform {
  const r = clampRest(rest);
  const pc = clampRest(pinch);
  const d = seatDir(pos, n);
  const side = pos === 'left' || pos === 'right';
  const base = edgePoint(d, side ? 0.3 : 0.05).add(new Vector3(0, OPP_FAN_BASE_Y - OPP_FAN_REST_DROP * r, 0)).add(d.clone().multiplyScalar(side ? OPP_FAN_BASE_OUT_SIDE + OPP_FAN_REST_OUT_SIDE * r : OPP_FAN_BASE_OUT + OPP_FAN_REST_OUT * r));
  const yaw = yawOf(d);
  const off = i - (count - 1) / 2;
  const spread = 0.038 * (1 - OPP_FAN_REST_TIGHTEN * pc);
  const tangent = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // local +x of a card facing outward
  const p = base.clone().add(tangent.multiplyScalar(off * spread)).add(new Vector3(0, -Math.abs(off) * off * 0 - off * off * 0.0016, 0)).add(d.clone().multiplyScalar(i * 0.0016));
  // face toward the owner (outward), tilted back, fanned by roll
  return xf([p.x, p.y, p.z], [0.55, yaw, -off * 0.075 * (1 - OPP_FAN_REST_TIGHTEN * pc)], 1);
}

/** Trick-card scale: big enough that rank + suit read clearly on a phone. */
export const TRICK_SCALE = 2.25; // +25% on the 1.8 that #166 shrank to (Demetrius: still bigger, physically). Spacing in trickSpot derives from the scaled w/h, so the plus layout grows with the cards.
const TRICK_LEAN = 0.38; // tilt toward the camera so the faces aren't foreshortened

/**
 * Card's spot in the middle of the table when played by this seat: a non-overlapping "plus" layout
 * (each card toward its player), face up, almost square to the table edge, leaned up toward the camera.
 */
export function trickSpot(pos: SeatPos, n: number, order: number, jitter: number, scale = TRICK_SCALE, land?: { dx: number; dz: number; spin: number }): Xform {
  const d = seatDir(pos, n);
  const w = CW * scale, h = CH * scale;
  // non-overlapping plus: top/bottom stacked by card height, sides beside them by a full card width,
  // so every card's corner index stays visible whatever the play order
  const off = Math.abs(d.x) > 0.5
    ? new Vector3(Math.sign(d.x) * (w + 0.06), 0, 0.02)
    : new Vector3(0, 0, Math.sign(d.z) * (h / 2 + 0.05 + h * Math.sin(TRICK_LEAN) * 0.42)); // the lean lifts the near card's top edge toward the far one
  if (n === 3 && pos !== 'bottom') off.set(Math.sign(d.x) * (w / 2 + 0.04), 0, -(h / 2 + 0.01));
  // Physics landing (Tips off): a small slide and an in-plane spin on top of the fixed spot. The card's
  // local +y is the far edge (-z), so a felt spin s is -s about the card normal.
  // A landed card lies flat on the felt (no lean, no tilt): only the spin about the vertical axis.
  if (land) return flatRest(off.x + land.dx, off.z + 0.04 + land.dz, land.spin, order, scale);
  // Tips on: the fixed per-seat spot, also flat on the felt (a hair of spin from the jitter, like a real toss).
  return flatRest(off.x, off.z + 0.04, jitter * 0.05, order, scale);
}

/** Felt height a landed card rests at, and the per-card step that keeps overlapping cards from z-fighting. */
export const FELT_REST_Y = 0.02; // raised from 0.012 — card corners still clipped during throw landing; needs more clearance for tilt (Demetrius 2026-10-19)
export const STACK_DY = 0.003;
/**
 * A card lying flat on the felt, face up: zero pitch and roll, only a spin about the vertical axis
 * (positive spin turns it counter-clockwise seen from above). `order` stacks later cards a hair higher.
 */
export function flatRest(x: number, z: number, spin: number, order: number, scale = TRICK_SCALE): Xform {
  return xf([x, FELT_REST_Y + order * STACK_DY, z], [-Math.PI / 2, 0, -spin], scale, 'XYZ');
}

/**
 * Won-trick books: a ROW of flattened book stacks along each player's own
 * table RIM (the rail band from the real table geometry: FELT + RAIL), one
 * slot per won trick. Demetrius (#240 follow-up): instead of one vertical
 * tower per player, lay the books SIDE BY SIDE along the edge like a woven
 * train track / railroad ties --
 *   odd books (1st, 3rd, 5th...) stand VERTICAL (portrait: long edge
 *     front-to-back, matching the player's facing),
 *   even books (2nd, 4th...) lie HORIZONTAL (rotated 90 degrees),
 *   adjacent books overlap slightly (BOOK_STEP is well under a card width).
 * Slots are precomputed for a full hand of books (13 in a 4-player hand, 17
 * in a 3-player hand at a tighter step), anchored at a fixed start point on the rim path, so a book
 * never moves when later books arrive; the gather animation lands each new
 * book straight into its slot with its odd/even orientation.
 *
 * Flattening (kept from #240): within a book, the per-card rise is the
 * compressed PILE_STEP profile -- a book rises at most ~0.005, never the
 * old staircased tower (~0.23 for a full hand). Every book in the row has
 * the same flat profile; card thickness in hand and in play is unchanged.
 * Book counts stay readable: one visible book per trick in the row, plus
 * the existing tricksWon/book displays.
 */
export const RAIL_TOP_Y = 0.1; // rail ring's top cap (railGeometry: 0.07 extrude + 0.05 bevel - 0.02 seat)
export const PILE_STEP = 0.0012;
export const PILE_STEP_LATE = 0.0002;
export const PILE_STEP_KNEE = 12;
/** Rim-path piles (owner 2026-11-01, two reports the same day: first the
 *  books "poking thru the players hands", then — after round 3 moved the
 *  rows down-table to inset 0.36/0.38 — "Now the collected books are in
 *  the way of the played cards instead of being on the edge of the
 *  table"). The two rules together leave no straight row anywhere: the
 *  rim strip's middle is each fan's swing zone (the open fan penetrates
 *  rim-depth books by 0.06–0.135 in the 3D SAT sweep), the landing zone
 *  (fixed trick spots, the Run It scatter and cascade) reaches to within
 *  ~0.16 of the felt edge, and a straight row long enough for 13 books
 *  runs off the rail's rounded corners. So the books now ride the rim
 *  itself: centres on the felt/rail seam (the rounded-rect felt
 *  boundary), in clusters that start just past each seat's fan swing
 *  and follow the rim from there (PILE_CLUSTERS). Verified by the
 *  four-zone sweep — hands (3D SAT vs open+rested fans, grips and the
 *  human hand fan, own and cross-seat, with slot k judged against the
 *  12-k cards each fan actually holds when book k lands), landing
 *  (plan vs the fixed spots, the sampled Run It scatter union and the
 *  cascade rows), rim (rounded-rect containment) and frame (the
 *  layout.test projection rule): every 4-player slot clears every
 *  zone with the books fully on the table. Two documented residuals:
 *  the left seat's late books (slots 6–12, toward the SW corner) ride
 *  the near-west rim the canonical portrait frame crops — they sit on
 *  the edge, clear of everything, but their outer edge can leave a
 *  narrow phone frame; and in 3-player games the left diagonal's row
 *  shares that near-west stretch from its first slot, and the extreme
 *  tail of the Run It scatter can pass under a west-rim book's rail
 *  overhang in plan (≤0.043, height-separated: book underside at rail
 *  height 0.10 vs card top ~0.03), which no rim placement on that
 *  straight can avoid. Slots stay precomputed and stable; the gather
 *  flight target derives from pileSpot, so flights follow the row. */
/** Where each seat's books sit on the rim path, as clusters of slots:
 *  `from` is the signed path offset of the cluster's first slot from the
 *  seat's rim axis point (positive = toward the seat's right-hand
 *  corner, the rim loop's forward direction), `dir` the direction the
 *  cluster grows, `count` its slots. Derived from the measured zones
 *  (see the design note above): every cluster starts just past its
 *  seat's fan swing; the top seat's second cluster fills TOWARD its
 *  axis, which is safe because slot k only fills after trick k+1, when
 *  every fan at the table is down to 12-k cards and the swing has
 *  shrunk past it. The two far corners are shared end-to-end: the top
 *  row's last west book and the left row's first north book meet at
 *  weave spacing (0.10) on the NW arc, likewise NE. */
interface PileCluster { from: number; dir: 1 | -1; count: number }
const PILE_CLUSTERS: Record<string, PileCluster[]> = {
  // the human's books flank his fan on the two near arcs (both in frame)
  'bottom:4': [{ from: 0.62, dir: 1, count: 7 }, { from: -0.62, dir: -1, count: 6 }],
  // north cluster on the west rim's frame-safe north stretch, the rest
  // toward its right-hand (SW) corner
  'left:4': [{ from: -0.61, dir: -1, count: 7 }, { from: 0.7, dir: 1, count: 6 }],
  // main row west along the north rim; late books east, filling toward
  // the axis as the fan empties
  'top:4': [{ from: 0.86, dir: 1, count: 8 }, { from: -0.78, dir: 1, count: 5 }],
  'right:4': [{ from: 0.78, dir: 1, count: 13 }],
  'bottom:3': [{ from: 0.62, dir: 1, count: 9 }, { from: -0.62, dir: -1, count: 8 }],
  // 3-player diagonals: one row each — left heads south down the west
  // rim, right heads north-west along the north rim
  'left:3': [{ from: 1.46, dir: 1, count: 17 }],
  'right:3': [{ from: 1.46, dir: 1, count: 17 }],
};

/** Rim-path arclength of a book slot: the seat's axis point plus the
 *  cluster offset for that slot. */
function pileSlotS(pos: SeatPos, n: number, trickIdx: number): number {
  const step = n === 3 ? BOOK_STEP_3P : BOOK_STEP;
  const clusters = PILE_CLUSTERS[`${pos}:${n}`] ?? PILE_CLUSTERS[`${pos}:4`]!;
  let k = trickIdx;
  for (const c of clusters) {
    if (k < c.count) return rimAxisS(pos, n) + c.from + k * c.dir * step;
    k -= c.count;
  }
  const last = clusters[clusters.length - 1]!;
  return rimAxisS(pos, n) + last.from + (last.count + k) * last.dir * step;
}

/** The felt boundary as a walkable loop: 4 straights + 4 corner arcs,
 *  traversed N→W→S→E (from the north axis point, west first) — the
 *  direction in which every seat's right-hand corner lies. */
type RimSeg =
  | { kind: 'line'; ax: number; az: number; bx: number; bz: number; len: number; s0: number }
  | { kind: 'arc'; cx: number; cz: number; r: number; a0: number; a1: number; len: number; s0: number };
const RIM_SEGS: RimSeg[] = (() => {
  const hx = FELT.hx, hz = FELT.hz, r = FELT.r;
  const out: RimSeg[] = [];
  let s0 = 0;
  const line = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    out.push({ kind: 'line', ax, az, bx, bz, len, s0 }); s0 += len;
  };
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    const len = Math.abs(a1 - a0) * r;
    out.push({ kind: 'arc', cx, cz, r, a0, a1, len, s0 }); s0 += len;
  };
  line(0, -hz, -(hx - r), -hz); // north straight, west half
  arc(-(hx - r), -(hz - r), -Math.PI / 2, -Math.PI); // NW corner
  line(-hx, -(hz - r), -hx, hz - r); // west straight
  arc(-(hx - r), hz - r, Math.PI, Math.PI / 2); // SW corner
  line(-(hx - r), hz, hx - r, hz); // south straight
  arc(hx - r, hz - r, Math.PI / 2, 0); // SE corner
  line(hx, hz - r, hx, -(hz - r)); // east straight
  arc(hx - r, -(hz - r), 0, -Math.PI / 2); // NE corner
  line(hx - r, -hz, 0, -hz); // north straight, east half
  return out;
})();
export const RIM_PATH_LEN = RIM_SEGS.reduce((a, s) => a + s.len, 0);

/** Point + frame at path distance sAbs along the rim loop. The outward
 *  normal (away from table centre) is (-tz, tx) for this direction. */
function rimFrameAt(sAbs: number): { p: Vector3; normal: Vector3 } {
  let s = ((sAbs % RIM_PATH_LEN) + RIM_PATH_LEN) % RIM_PATH_LEN;
  for (const seg of RIM_SEGS) {
    const local = Math.min(seg.len, Math.max(0, s - seg.s0));
    if (s <= seg.s0 + seg.len || seg === RIM_SEGS[RIM_SEGS.length - 1]) {
      if (seg.kind === 'line') {
        const t = seg.len ? local / seg.len : 0;
        const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
        const dl = Math.hypot(dx, dz) || 1;
        return {
          p: new Vector3(seg.ax + dx * t, 0, seg.az + dz * t),
          normal: new Vector3(-(dz / dl), 0, dx / dl),
        };
      }
      const dir = Math.sign(seg.a1 - seg.a0);
      const a = seg.a0 + (dir * local) / seg.r;
      const tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir;
      return {
        p: new Vector3(seg.cx + seg.r * Math.cos(a), 0, seg.cz + seg.r * Math.sin(a)),
        normal: new Vector3(-tz, 0, tx),
      };
    }
  }
  return { p: new Vector3(0, 0, -FELT.hz), normal: new Vector3(0, 0, -1) };
}

/** Arclength of the rim point facing the seat (the support point of the
 *  felt boundary in the seat's direction; ties on a straight resolve to
 *  the point nearest the seat's axis line). */
function rimAxisS(pos: SeatPos, n: number): number {
  const d = seatDir(pos, n);
  const cross = (ux: number, uz: number, vx: number, vz: number) => ux * vz - uz * vx;
  let bestS = 0, bestDot = -Infinity, bestPerp = Infinity;
  const consider = (x: number, z: number, s: number) => {
    const dot = x * d.x + z * d.z;
    const perp = Math.abs(cross(x, z, d.x, d.z));
    if (dot > bestDot + 1e-9 || (Math.abs(dot - bestDot) <= 1e-9 && perp < bestPerp)) {
      bestDot = dot; bestPerp = perp; bestS = s;
    }
  };
  for (const seg of RIM_SEGS) {
    if (seg.kind === 'line') {
      const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
      const along = dx * d.x + dz * d.z;
      if (Math.abs(along) < 1e-9) {
        const cd = cross(dx, dz, d.x, d.z);
        let t = cd !== 0 ? -cross(seg.ax, seg.az, d.x, d.z) / cd : 0;
        t = Math.min(1, Math.max(0, t));
        consider(seg.ax + dx * t, seg.az + dz * t, seg.s0 + t * seg.len);
      } else {
        const t = along > 0 ? 1 : 0;
        consider(seg.ax + dx * t, seg.az + dz * t, seg.s0 + t * seg.len);
      }
    } else {
      for (const a of [seg.a0, seg.a1]) {
        consider(seg.cx + seg.r * Math.cos(a), seg.cz + seg.r * Math.sin(a), seg.s0 + Math.abs(a - seg.a0) * seg.r);
      }
      let th = Math.atan2(d.z, d.x);
      const lo = Math.min(seg.a0, seg.a1), hi = Math.max(seg.a0, seg.a1);
      while (th < lo - Math.PI) th += 2 * Math.PI;
      while (th > hi + Math.PI) th -= 2 * Math.PI;
      if (th >= lo && th <= hi) {
        consider(seg.cx + seg.r * d.x, seg.cz + seg.r * d.z, seg.s0 + Math.abs(th - seg.a0) * seg.r);
      }
    }
  }
  return bestS;
}


/** Centre-to-centre distance along the rim between adjacent books. Under a
 * card's short width (0.23 at pile scale), so neighbours always overlap a
 * little -- the woven railroad-tie read. 13 books span ~2.3m this way,
 * inside the 3.0m felt width; 17-book (3-player) rows tighten to 0.135
 * (~1.7m, inside the same edge). A tighter step is also what keeps the\n * far slots of side-seat rows inside the phone frame (layout.test guards it). */
export const BOOK_STEP = 0.10;
export const BOOK_STEP_3P = 0.075;
export const BOOKS_PER_HAND = 13;

/** Compressed pile height for the (0-based) card index WITHIN one book. */
export function pileRise(globalIdx: number): number {
  const i = Math.max(0, globalIdx);
  return i <= PILE_STEP_KNEE ? i * PILE_STEP : PILE_STEP_KNEE * PILE_STEP + (i - PILE_STEP_KNEE) * PILE_STEP_LATE;
}

/** The start point of a seat's book row (slot 0's centre), on the rim
 * path — clear of the seat's fan, on the felt/rail seam. The full row
 * follows the rim from here (pileSpot, PILE_CLUSTERS); on screen
 * (layout.test guards the projections) and clear of every trick
 * landing (book-piles-edge.test.ts). */
export function pileEdgePoint(pos: SeatPos, n: number): Vector3 {
  return rimFrameAt(pileSlotS(pos, n, 0)).p;
}

/** Odd books (1st, 3rd, ...): vertical (long edge front-to-back). Even books: horizontal (rotated 90°). The alternating weave. Demetrius 2026-10-19. */
export const bookIsVertical = (trickIdx: number): boolean => trickIdx % 2 === 0;

export function pileSpot(pos: SeatPos, n: number, trickIdx: number, cardIdx: number, jitter: number): Xform {
  const frame = rimFrameAt(pileSlotS(pos, n, trickIdx));
  const c = frame.p;
  // Odd (vertical) books: long axis radial (front-to-back, across the
  // rim). Even (horizontal) books: rotated 90 degrees, long axis along
  // the rim. The frame is the rim's local frame, so the weave follows
  // the rim around the corners. The old single-stack yaw was the
  // horizontal one for everyone.
  const yaw = yawOf(frame.normal) + (bookIsVertical(trickIdx) ? 0 : Math.PI / 2);
  // Even (horizontal) books sit higher so they layer cleanly over odd (vertical) books in the weave. Demetrius 2026-10-19.
  const weaveLift = bookIsVertical(trickIdx) ? 0 : 0.008;
  return xf(
    [c.x + jitter * 0.008, RAIL_TOP_Y + FELT_REST_Y + pileRise(cardIdx) + weaveLift, c.z + jitter * 0.008],
    [Math.PI / 2, yaw + jitter * 0.06, 0],
    0.92,
  );
}

/** Dealer's deck spot (cards fly from here when dealing). */
export function deckSpot(pos: SeatPos, n: number): Xform {
  const d = seatDir(pos, n);
  const p = edgePoint(d, 0.45);
  return xf([p.x, 0.02, p.z], [Math.PI / 2, yawOf(d), 0], 1);
}

/** The King's gun (double or nothing, leg 2): the revolver he set down in
 *  the between-legs beat lies on the felt in front of his seat for the
 *  whole decider — beside the play, never on it. The spot sits inboard of
 *  his book row and his deck spot, shifted along the rim toward the
 *  corner on his left hand, muzzle pointing along the felt toward that
 *  corner and the grip back toward the play. KING_GUN_FOOTPRINT is the
 *  model's bounding rect (length along the muzzle, width across), centred
 *  on the spot — the layout tests SAT-check that rect against every trick
 *  landing, deck spot and book row, and inside the felt. */
export const KING_GUN_FOOTPRINT = { len: 0.62, wid: 0.23 };

export function kingGunSpot(pos: SeatPos, n: number): Xform {
  const d = seatDir(pos, n);
  // toward the corner on the seat's left hand (for the King's left seat,
  // the top corner — away from his book row's centre)
  const t = new Vector3(-d.z, 0, d.x);
  const c = edgePoint(d, 0.58).add(t.clone().multiplyScalar(0.72));
  const muzzle = d.clone().multiplyScalar(0.83).add(t.clone().multiplyScalar(0.56)).normalize();
  // the model is built muzzle-along-+X: world yaw that takes +X onto the
  // muzzle direction (a Y rotation maps +X to (cos yaw, 0, -sin yaw))
  const yaw = Math.atan2(-muzzle.z, muzzle.x);
  return xf([c.x, FELT_REST_Y, c.z], [0, yaw, 0], 1);
}

/** Turn-ring location on the felt. */
export function ringSpot(pos: SeatPos, n: number): Vector3 {
  return edgePoint(seatDir(pos, n), 0.36);
}

/** Seat badge anchor (above the opponent's cards). */
export function badgeSpot(pos: SeatPos, n: number): [number, number, number] {
  const d = seatDir(pos, n);
  const p = edgePoint(d, 0).add(d.clone().multiplyScalar(0.12));
  if (pos === 'left' || pos === 'right') return [p.x * 0.78, 0.62, p.z - 0.55];
  // top seat: centered over the partner's cards — Demetrius 2026-10-19 (plate must sit above and
  // centered over the cards in portrait, never overlapping them)
  return [p.x, 0.42, p.z];
}

/* ------------------------------------------------------------- camera */

export interface CamSpec { pos: [number, number, number]; look: [number, number, number]; fov: number }

/** Camera from the human seat looking across the table; framing adapts to portrait/landscape.
 *  The camera is ALWAYS this canonical south view: at online tables the
 *  per-seat vantage comes from rotating the room layer to the viewer's
 *  seat (Scene's roomYaw, turnState.roomYawForViewerSeat), never from
 *  moving the camera — so every framing fit below holds for all seats. */
/** Demetrius (Sat 7:03am): Sitting needed MORE downward tilt — pitch the seated aim down
 *  exactly this many extra degrees toward the felt, position and fov untouched, so the
 *  trick cards read more face-on. Applied to every Sitting spec (portrait + short landscape). */
export const SITTING_EXTRA_PITCH_DEG = 7;
/** Rotate a camera aim down by SITTING_EXTRA_PITCH_DEG around its position (YZ plane). */
export function pitchAimDown(pos: readonly number[], look: readonly number[]): [number, number, number] {
  const a = (SITTING_EXTRA_PITCH_DEG * Math.PI) / 180;
  const dy = look[1]! - pos[1]!; const dz = look[2]! - pos[2]!;
  return [look[0]!, pos[1]! + dy * Math.cos(a) + dz * Math.sin(a), pos[2]! + dz * Math.cos(a) - dy * Math.sin(a)];
}

export function cameraFor(aspect: number, short = false, view: 'standing' | 'sitting' = 'standing'): CamSpec {
  // A 0×0 canvas (iPhone chrome, first frame) is 0 or NaN. That fov never recovers on its own.
  if (!(Number.isFinite(aspect) && aspect > 0.05 && aspect < 20)) aspect = 9 / 16;
  if (short) return shortLandscapeCamera(aspect, view);
  const t = Math.min(1, Math.max(0, (aspect - 0.5) / (1.6 - 0.5))); // 0 = tall phone, 1 = wide desktop
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const pos: [number, number, number] = [0, lerp(4.5, 3.45), lerp(3.75, 3.4)];
  const look: [number, number, number] = [0, 0, lerp(0.38, 0.08)];
  if (view === 'sitting') {
    // Sitting: low, over-the-table, in-the-chair angle — lower AND closer in than the first cut,
    // so the cards lying on the felt (the trick in front of you) face you more directly, read
    // larger, and foreshorten less, while the fan solver still fits the whole hand on a phone
    // (it fits against this very camera, and the sitting-hand e2e guards 390/393px; hand
    // visibility still wins if the two ever fight). Standing is untouched.
    pos[1] *= 0.44; pos[2] *= 0.80; look[2] += 0.30;
    const tilted = pitchAimDown(pos, look); look[0] = tilted[0]; look[1] = tilted[1]; look[2] = tilted[2];
  }
  const dist = Math.hypot(pos[1] - look[1], pos[2] - look[2]);
  // fit the table width (with rail) horizontally, and keep at least a minimum vertical fov
  const halfW = FELT.hx + RAIL + lerp(-0.08, 0.1);
  const vFit = 2 * Math.atan(Math.tan(Math.atan(halfW / dist)) / aspect) * (180 / Math.PI);
  const fov = Math.min(84, Math.max(lerp(56, 45.5), vFit) + (view === 'sitting' ? 11 : 0));
  return { pos, look, fov };
}

/**
 * Phone landscape: little height, lots of width. A lower, more frontal camera (less foreshortening of the far half)
 * framed so the felt fills the height between the one-line scorebug and the hand, leaving the sides for name plates.
 * The zoom is aspect-aware: wide phones (2.2+) get a closer framing; narrow landscape keeps the wider fov so the
 * side plates stay in frame.
 */
function shortLandscapeCamera(aspect: number, view: 'standing' | 'sitting' = 'standing'): CamSpec {
  const wide = Math.min(1, Math.max(0, (aspect - 1.3) / (2.4 - 1.3))); // 0 at 1.3, 1 at 2.4+
  const lerp = (a: number, b: number) => a + (b - a) * wide;
  if (view === 'sitting') { const spec: CamSpec = { pos: [0, 1.95, 3.45], look: [0, 0, -0.25], fov: lerp(52, 44) }; spec.look = pitchAimDown(spec.pos, spec.look); return spec; } // seated: low, across the felt + the +7° tilt, wide enough for the fan; aimed at the far half so the partner's hand clears the scorebug
  return { pos: [0, 3.1, 3.5], look: [0, 0, 0.22], fov: lerp(42, 40) };
}

export function makeCamera(aspect: number, short = false, view: 'standing' | 'sitting' = 'standing'): PerspectiveCamera {
  const s = cameraFor(aspect, short, view);
  const cam = new PerspectiveCamera(s.fov, aspect, 0.05, 60);
  cam.position.set(...s.pos);
  cam.lookAt(new Vector3(...s.look));
  cam.updateMatrixWorld(true);
  return cam;
}

/** Sitting<->Standing camera move: 0.7s ease-out. Pure so tests can assert intermediate poses.
 *  Wall-clock based (not frame dt): in frameloop="demand" the first dt after an idle table can be
 *  seconds long, which used to consume the whole tween in one frame — the snap Demetrius saw. */
export const CAMERA_VIEW_TWEEN_MS = 700;
export function cameraPoseAt(from: readonly number[], to: readonly number[], fromLook: readonly number[], toLook: readonly number[], elapsedMs: number, durMs = CAMERA_VIEW_TWEEN_MS): { pos: number[]; look: number[]; t: number } {
  const t = durMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / durMs));
  const k = 1 - Math.pow(1 - t, 3);
  const mix = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + (b[i]! - v) * k);
  return { pos: mix(from, to), look: mix(fromLook, toLook), t };
}

export interface FanLayout {
  s: number;
  cw: number;
  ch: number;
  step: number;
  maxRoll: number;
  curveK: number;
  viewW: number;
  viewH: number;
  /** CSS pixels reserved on each side of a raised card. 0 when nothing is raised. */
  raiseOpen: number;
  /** Pivot fan only: distance from the pivot (below the screen) to each card's centre, in plane units. 0 = flat arc. */
  pivotR?: number;
  /** Pivot fan only: angle between neighbouring cards, in radians. */
  dTheta?: number;
}

/** Widest strip we ask for. A 13-card fan on a 390px phone can hold this. */
export const MIN_STRIP_PX = 28;

/**
 * Strip the fan can actually keep. 28px when the row has room (13 cards at 390).
 * A longer row compresses, and still leaves a tappable edge.
 */
export function stripFloorPx(count: number, screenW: number, edgeFrac = 0.02): number {
  const w = Number.isFinite(screenW) && screenW >= 32 ? screenW : 390;
  const n = count >= 1 ? count : 1;
  const usable = w * (1 - 2 * edgeFrac);
  const fit = usable / n;
  return Math.min(MIN_STRIP_PX, Math.max(16, fit));
}

/**
 * Extra centre-gap, in CSS pixels, so a card painted on top of both neighbours
 * still leaves `minStrip` of the next card. The next card covers that neighbour
 * from the other side, so the open has to replace what both of them hide.
 */
export function raiseOpenPx(cardWidthPx: number, stepPx: number, minStripPx: number): number {
  if (!(cardWidthPx > 0) || !(minStripPx > 0)) return 0;
  const step = Number.isFinite(stepPx) && stepPx > 0 ? stepPx : 0;
  const need = minStripPx - (2 * step - cardWidthPx);
  return Math.max(0, need);
}

/**
 * Solve the human fan so it always fits the camera frustum width at the hand's depth (D = 1 in camera space):
 * the outermost cards — including their roll, the perspective growth from the tilt and a lifted card — stay inside
 * the view with `margin` on both sides (margin = max(6% of width, iOS safe-area inset)). Card scale shrinks only
 * when even a tight overlap (rank index still visible) can't fit.
 */
export interface FanOpts {
  /** Camera view the fan is anchored to. The hand is screen-anchored, so it MUST be laid out with
   *  the live view's camera — anchoring to Standing while Sitting renders pushed the fan off-screen
   *  on real iPhone Safari (the old probe shared the wrong camera, so WebKit tests missed it). */
  view?: 'standing' | 'sitting';
  /** Fraction of the width kept clear on each side (e.g. for the HUD corners in landscape). */
  reserveFrac?: number;
  /** Fraction of the height kept clear at the bottom (iOS home indicator). */
  bottomFrac?: number;
  /** Target card height as a fraction of the view height. */
  heightFrac?: number;
  /**
   * Side margin as a fraction of the view width. Omitted: the 6% floor (or the safe-area / HUD reserve).
   * A phone portrait hand uses a smaller floor so the cards can be larger and still land on screen.
   */
  edgeFrac?: number;
  /** Cap on the end-card roll, in radians. Omitted: 0.32. */
  rollCap?: number;
  short?: boolean;
  /**
   * Fraction of a card width kept clear on each side of a raised card.
   * The solver shrinks the fan so that gap still fits on the screen.
   * When `pxW` is set, the reserved gap is at least this fraction and at least
   * enough that the neighbour's visible strip stays `minStripPx`.
   */
  spread?: number;
  /** Minimum visible strip of each card, in CSS pixels. Needs `pxW`. */
  minStripPx?: number;
  /** Viewport width the strip is measured against. */
  pxW?: number;
  /**
   * Who comes forward. `play` is a playable card (PLAY_DEPTH). `selected` is the raised card
   * (SELECT_DEPTH), in front of the neighbours it overlaps. Omitted: rest.
   */
  layer?: 'rest' | 'play' | 'selected';
  /**
   * Extra camera-near bias for a playable card (see LEGAL_NEAR). Subtracted from depth only.
   * Screen x/y stay put, so the outline, which is built from those plane coordinates, does not slide.
   */
  near?: number;
  /**
   * Pivot fan: cards rotate about a point this many card heights below each card's centre,
   * like a hand of cards held in a fist. The tappable strip is measured near the top of the
   * card, where the fan opens widest, so the cards can be much larger than in a flat row.
   * Needs `pxW` and `minStripPx`.
   */
  pivot?: number;
  /** Pixels added over the strip floor (headroom for a lifted card). */
  stripPad?: number;
  /**
   * Fan rest DROP amount 0..1 (owner 2026-10-28, fanRest.ts): 0 = the
   * normal raised height, 1 = fully lowered. Applied in handCardPlane
   * as a pose ON TOP of the solved layout — the solver, card scale and
   * depth stack never see it, so open and rest share one fit. Callers
   * only pass a non-zero amount for a seat that is not the one to act,
   * in the scopes fanRest.ts gates (Sitting at any aspect, Standing in
   * landscape).
   */
  rest?: number;
  /**
   * Fan rest PINCH amount 0..1 (owner 2026-10-28, fanRest.ts): 0 = the
   * normal open spread, 1 = fully tightened (x and roll closed by
   * FAN_REST_TIGHTEN). When omitted it follows `rest` — the original
   * combined pose. Sitting portrait passes 0 explicitly: the fan
   * lowers without narrowing.
   */
  pinch?: number;
}

/** Where the strip is measured, as a fraction of the card height below its top edge. */
export const STRIP_LINE_FRAC = 0.2;

function pivotFanLayout(aspect: number, count: number, safeFrac: number, o: FanOpts): FanLayout | null {
  const pivot = o.pivot ?? 0;
  const pxW = Number.isFinite(o.pxW) && o.pxW! >= 32 ? o.pxW! : 0;
  if (!(pivot > 0) || !pxW || !(o.minStripPx! > 0)) return null;
  const cam = makeCamera(aspect, o.short, o.view);
  const viewH = 2 * Math.tan((cam.fov * Math.PI) / 360);
  const viewW = viewH * aspect;
  const k = pxW / viewW;
  const edge = o.edgeFrac ?? 0.06;
  const halfAvail = viewW / 2 - viewW * (o.edgeFrac ?? Math.max(0.06, safeFrac + 0.025, o.reserveFrac ?? 0));
  const halfN = Math.max(0, (count - 1) / 2);
  // A few pixels over the floor: a lifted playable card slides its tilted edge sideways over the next strip.
  const strip = Math.min(o.minStripPx!, Math.max(16, (pxW * (1 - 2 * edge)) / Math.max(1, count)) * 1.6) + (o.stripPad ?? 4);
  const spread = Number.isFinite(o.spread) && o.spread! > 0;
  let s = Math.min(viewH * (o.heightFrac ?? 0.16), viewW * 0.25 * 1.4 * 1.5) / CH;
  let out: FanLayout | null = null;
  for (let it = 0; it < 80; it++) {
    const cw = CW * s;
    const ch = CH * s;
    const R = pivot * ch;
    const rLine = R + ch * (0.5 - STRIP_LINE_FRAC);
    // Never wrap the fan past ~95° a side: edge cards would turn away and leave the screen.
    const dTheta = halfN > 0 ? Math.min(0.5, strip / k / rLine, 2.35 / halfN) : 0;
    const tMax = halfN * dTheta;
    const outer = R * Math.sin(tMax) + (cw / 2) * Math.cos(tMax * PIVOT_ROLL_FOLLOW) + (ch / 2) * Math.sin(tMax * PIVOT_ROLL_FOLLOW);
    const step = rLine * dTheta;
    // The raised layout reserves room for its opening; the resting fan uses the full width.
    const open = raiseOpenPx(cw * k, step * k, strip) * RAISE_OPEN_BOOST; // bigger cards: the raised card covers more of its neighbour, so the reserved gap grows too
    out = { s, cw, ch, step, maxRoll: tMax, curveK: 0, viewW, viewH, raiseOpen: spread ? open : 0, pivotR: R, dTheta };
    // Only the raised layout reserves its opening; the resting fan uses the full width.
    if ((halfAvail - outer) * k >= (spread ? open : 0) + 1) break;
    s *= 0.97;
  }
  return out;
}

export function fanLayout(aspect: number, count: number, safeFrac = 0, o: FanOpts = {}): FanLayout {
  if (!(Number.isFinite(aspect) && aspect > 0.05 && aspect < 20)) aspect = 9 / 16;
  if (!(count >= 1)) count = 1;
  const pivoted = pivotFanLayout(aspect, count, safeFrac, o);
  if (pivoted) return pivoted;
  const cam = makeCamera(aspect, o.short, o.view);
  const D = 1;
  const viewH = 2 * Math.tan((cam.fov * Math.PI) / 360) * D;
  const viewW = viewH * aspect;
  const baseMargin = viewW * (o.edgeFrac ?? Math.max(0.06, safeFrac + 0.025, o.reserveFrac ?? 0));
  const persp = 1.0; // cards are parallel to the image plane → no perspective growth
  const halfN = Math.max(0, (count - 1) / 2);
  const maxRoll = count > 1 ? Math.min(o.rollCap ?? 0.32, 0.03 * count) : 0;
  const spread = Number.isFinite(o.spread) && o.spread! > 0 ? o.spread! : 0;
  const pxW = Number.isFinite(o.pxW) && o.pxW! >= 32 ? o.pxW! : 0;
  const edge = o.edgeFrac ?? 0.06;
  const stripWant = pxW > 0 && o.minStripPx && o.minStripPx > 0 ? stripFloorPx(count, pxW, edge) : 0;
  // A 28px strip on a narrow card is most of the face. The 0.62 cap hid that strip
  // under the next card once the hand grew past four.
  const stepCap = stripWant > 0 ? 0.94 : 0.62;
  const heightS = Math.min(viewH * (o.heightFrac ?? 0.16), viewW * 0.25 * 1.4) / CH;
  const solve = (reserve: number, pixelStrip: boolean, maxS = heightS) => {
    const halfAvail = viewW / 2 - baseMargin - reserve;
    let ss = maxS;
    let st = 0;
    if (pixelStrip && pxW > 0 && viewW > 0) {
      let bestS = ss;
      let bestStep = 0;
      let bestPx = -1;
      for (let k = 0; k < 70; k++) {
        const cw = CW * ss;
        const ch = CH * ss;
        const outer = (cw / 2) * Math.cos(maxRoll) + (ch / 2) * Math.sin(maxRoll);
        const room = halfAvail / persp - outer;
        st = halfN > 0 ? Math.min(cw * stepCap, Math.max(0, room) / halfN) : 0;
        const exposedPx = st * (pxW / viewW);
        if (exposedPx > bestPx) { bestPx = exposedPx; bestS = ss; bestStep = st; }
        if (halfN === 0 || exposedPx + 0.25 >= stripWant) break;
        // Past here the step is the card-width cap, so shrinking only hides more of each card.
        if (halfN > 0 && room / halfN >= cw * stepCap && exposedPx < bestPx - 0.3) break;
        ss *= 0.96;
      }
      return { s: bestS, step: bestStep };
    }
    for (let k = 0; k < 40; k++) {
      const cw = CW * ss, ch = CH * ss;
      const outer = (cw / 2) * Math.cos(maxRoll) + (ch / 2) * Math.sin(maxRoll);
      const room = halfAvail / persp - outer;
      st = halfN > 0 ? Math.min(cw * 0.62, Math.max(0, room) / halfN) : 0;
      if (halfN === 0 ? room >= 0 : st >= cw * 0.3) break;
      ss *= 0.96;
    }
    return { s: ss, step: st };
  };
  let solved = solve(0, stripWant > 0);
  let raiseOpen = 0;
  if (spread > 0 && stripWant > 0 && pxW > 0 && viewW > 0) {
    const k = pxW / viewW;
    const marginOf = (ss: number, st: number) => {
      const cw = CW * ss;
      const ch = CH * ss;
      const outer = (cw / 2) * Math.cos(maxRoll) + (ch / 2) * Math.sin(maxRoll);
      return pxW / 2 - (halfN * Math.max(0, st) + outer) * k;
    };
    let cap = heightS;
    let open = 0;
    // The row slides into its margin when that covers the neighbour. A wide card
    // on a full row has no margin, so the card shrinks until the gap fits and
    // the strip is still there. Reserving the gap by tightening the step made
    // the overlap worse.
    for (let pass = 0; pass < 24; pass++) {
      solved = solve(0, true, cap);
      open = raiseOpenPx(CW * solved.s * k, Math.max(0, solved.step) * k, stripWant);
      if (marginOf(solved.s, solved.step) >= open + 1) break;
      cap *= 0.94;
    }
    raiseOpen = Math.max(0, open);
  } else if (spread > 0) {
    let reserve = 0;
    for (let pass = 0; pass < 4; pass++) {
      solved = solve(reserve, false);
      reserve = spread * CW * solved.s;
    }
    raiseOpen = pxW > 0 && viewW > 0 ? reserve * (pxW / viewW) : 0;
  }
  const s = solved.s;
  const step = solved.step;
  // the arc follows the cards' roll: at the ends its slope equals the end card's tilt, like a fan held in a hand.
  // (A fixed curve with a separately-scaled roll left the end cards kinked against the arc: the "skewed" right-most card.)
  const xo = halfN * Math.max(0, step);
  const curveK = xo > 0 ? Math.tan(maxRoll) / (2 * xo) : 0;
  return { s, cw: CW * s, ch: CH * s, step: Math.max(0, step), maxRoll, curveK, viewW, viewH, raiseOpen };
}

/**
 * Phone portrait hand. Taller than the 0.16 default, with a tighter side margin, so a full
 * fan is easier to tap. The fit loop still shrinks a 13- or 17-card hand onto the screen.
 * 44px of exposed width is the target when the count leaves room for it.
 */
export const PHONE_HAND_HEIGHT = 0.55; // +25% over the old 0.38 (bigger hand ask); the pivot fit loop still shrinks a full 13-card fan onto the screen
export const PHONE_HAND_EDGE = 0.02; // slightly wider side margin: at 360px the bigger fan otherwise spans 98.9% (guard is <=98%)
export const PHONE_HAND_ROLL = 0.2;
/** Phone fan pivot, in card heights below each card's centre. Smaller is a rounder arc. */
export const PHONE_HAND_PIVOT = 1.12;
/** Cards under-roll the pivot arc a little (78%): edge faces stay flatter, so their tappable
 *  strips stay wide even with the bigger cards; positions still follow the arc exactly. */
export const PIVOT_ROLL_FOLLOW = 0.66;
/** Extra raised-gap reserve for the phone pivot fan (the bigger cards need a wider opening). */
export const RAISE_OPEN_BOOST = 1.4; // rounder/taller arc (was 1.4): lets the +25% bigger cards still fit the width without shrinking back
/** Headroom over the 28px strip floor. The e2e still measures >= 28px with a card raised. */
export const PHONE_HAND_STRIP_PAD = 4;
/** Phone portrait strip target: wider than the global floor so a raised card still leaves a tappable strip. */
export const PHONE_HAND_STRIP_PX = 40; // bigger cards, same promise: tappable strips stay >= ~42px measured at 390px
/** The fan rises off the bottom edge into the near rail, so the arch underneath it can hold your plate. */
export const PHONE_HAND_RISE = 0.05;
export const HAND_EXPOSED_PX = 44;

export function phoneHandFan(): FanOpts {
  return { heightFrac: PHONE_HAND_HEIGHT, edgeFrac: PHONE_HAND_EDGE, rollCap: PHONE_HAND_ROLL, pivot: PHONE_HAND_PIVOT, stripPad: PHONE_HAND_STRIP_PAD, bottomFrac: PHONE_HAND_RISE };
}

/** Card width, card height, and the strip of each card that is not covered by the next, in CSS pixels. */
export function fanCssPx(layout: FanLayout, screenW: number): { width: number; height: number; exposed: number } {
  const w = Number.isFinite(screenW) && screenW >= 32 ? screenW : 0;
  const k = layout.viewW > 0 ? w / layout.viewW : 0;
  return { width: layout.cw * k, height: layout.ch * k, exposed: layout.step * k };
}

/** Where a hand card sits on the depth-1 camera plane (the shape that actually projects to the screen). */
export interface HandCardPlane {
  x: number;
  y: number;
  roll: number;
  /** Camera-space distance used only for z-order. Projection is depth-compensated, so this never changes the picture. */
  depth: number;
  s: number;
}

/**
 * Camera-plane pose of one card in the human fan. `x` / `y` / `roll` are what you see; `depth` only stacks the cards.
 * Shared by the card mesh and the playable-group outline so the highlight can't drift from the fan.
 */
export function handCardPlane(aspect: number, count: number, i: number, lift: number, safeFrac = 0, o: FanOpts = {}, gapPx = 0, screenH = 844): HandCardPlane {
  const L = fanLayout(aspect, count, safeFrac, o);
  const halfN = (count - 1) / 2;
  const off = i - halfN;
  // `gapPx` opens the fan beside a legal run, in CSS pixels. Depth and roll stay on the index.
  // Dividing by max(1, screenH) turned an 8px subset gap into screen-heights on a 0-height canvas, and 0/NaN poisoned x.
  const sh = Number.isFinite(screenH) && screenH >= 32 ? screenH : 0;
  const gap = Number.isFinite(gapPx) ? gapPx : 0;
  const gapX = sh > 0 ? (gap / sh) * L.viewH : 0;
  let x: number;
  let roll: number;
  let curve: number;
  let lowest: number;
  if (L.pivotR && L.pivotR > 0) {
    // Pivot fan: each card turns about one point below the hand, so the tops open wider than the bottoms.
    // A gap (raise spread, legal-run gap) opens the fan along its arc, measured on the strip line.
    const rLine = L.pivotR + L.ch * (0.5 - STRIP_LINE_FRAC);
    const t = off * (L.dTheta ?? 0) + gapX / rLine;
    x = L.pivotR * Math.sin(t);
    roll = -t * PIVOT_ROLL_FOLLOW;
    curve = L.pivotR * (1 - Math.cos(t));
    lowest = L.pivotR * (1 - Math.cos(L.maxRoll)) + (L.ch / 2) * Math.cos(L.maxRoll * PIVOT_ROLL_FOLLOW) + (L.cw / 2) * Math.sin(L.maxRoll * PIVOT_ROLL_FOLLOW);
  } else {
    // Desktop fan: a gap (raise spread) slides a block sideways along the strip line.
    // The arc curve and roll stay on the card's UNSHIFTED index position: curving from the
    // shifted x sank the left block down the parabola while its roll lagged the arc slope,
    // so a selected card's neighbours peeled away steep, low and kinked (phone's pivot fan
    // opens along its arc instead, which is why only desktop showed it).
    const baseX = off * L.step;
    x = baseX + gapX;
    roll = halfN > 0 ? -(off / halfN) * L.maxRoll : 0;
    curve = baseX * baseX * L.curveK;
    // the outermost (most rolled, most curved-down) card's lowest corner sits exactly on the bottom margin
    const xo = halfN * L.step;
    lowest = xo * xo * L.curveK + (L.ch / 2) * Math.cos(L.maxRoll) + (L.cw / 2) * Math.sin(L.maxRoll);
  }
  // Fan rest (fanRest.ts), two channels: PINCH compresses the fan toward
  // its centre (x and roll close by FAN_REST_TIGHTEN); DROP lowers every
  // card by the same amount, so each card — centre and ends alike — sits
  // lower at rest than open. Pinch defaults to the drop amount when the
  // caller doesn't split them (sitting portrait passes pinch 0: the fan
  // lowers at its open width).
  const rest = clampRest(o.rest);
  const pinchAmt = clampRest(o.pinch ?? o.rest);
  if (pinchAmt > 0) {
    const tighten = 1 - FAN_REST_TIGHTEN * pinchAmt;
    x *= tighten;
    roll *= tighten;
  }
  const y = -L.viewH / 2 + L.viewH * (0.015 + (o.bottomFrac ?? 0)) + lowest - curve + lift * L.ch - rest * FAN_REST_DROP_CH * L.ch;
  // A higher index is closer by HAND_DEPTH_STEP. Playable cards, and a raised card even more,
  // come forward of the neighbours they overlap so the depth buffer matches the draw order.
  // Phones with a 16-bit depth buffer (iPhone Safari) z-fight at ~0.0003 here; the step stays well above that.
  const layer = o.layer ?? 'rest';
  const boost = layer === 'selected' ? SELECT_DEPTH : layer === 'play' ? PLAY_DEPTH : 0;
  const near = Number.isFinite(o.near) && o.near! > 0 ? o.near! : 0;
  const depth = 1 - (i + 1) * HAND_DEPTH_STEP - boost - near;
  return { x, y, roll, depth, s: L.s };
}

/**
 * The human hand, laid out in *screen space*: every card sits on a plane parallel to the image plane (no tilt), so
 * perspective projects it as an exact, undistorted copy. Cards are stacked a hair nearer the camera left→right for a
 * stable z-order (each card on top of the one to its left), and both position and scale are multiplied by that depth
 * so every card projects at exactly the same size and spacing — a perfectly symmetric fan. Only the lifted card moves.
 */
export function handFan(aspect: number, count: number, i: number, lift: number, safeFrac = 0, o: FanOpts = {}, gapPx = 0, screenH = 844): Xform {
  const cam = makeCamera(aspect, o.short, o.view);
  const c = handCardPlane(aspect, count, i, lift, safeFrac, o, gapPx, screenH);
  const { depth } = c;
  const local = new Matrix4().compose(
    new Vector3(c.x * depth, c.y * depth, -depth),
    new Quaternion().setFromEuler(new Euler(0, 0, c.roll, 'XYZ')),
    new Vector3(c.s * depth, c.s * depth, c.s * depth),
  );
  const world = cam.matrixWorld.clone().multiply(local);
  const p = new Vector3(), q = new Quaternion(), sc = new Vector3();
  world.decompose(p, q, sc);
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s: sc.x };
}

/**
 * Canvas CSS pixels of one card's drawn corners. `liftPx` is the screen-up raise
 * (the inner wrapper). The same quad is what the hand hit test uses.
 */
export function cardScreenQuad(aspect: number, t: Xform, screenW: number, screenH: number, liftPx = 0, short = false, view: 'standing' | 'sitting' = 'standing'): { x: number; y: number }[] {
  const cam = makeCamera(aspect, short, view);
  cam.updateProjectionMatrix();
  const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
  const w = Number.isFinite(screenW) && screenW >= 32 ? screenW : 0;
  const h = Number.isFinite(screenH) && screenH >= 32 ? screenH : 0;
  const up = Number.isFinite(liftPx) ? liftPx : 0;
  return ([[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]] as const).map(([cx, cy]) => {
    const v = new Vector3(cx, cy, 0).applyMatrix4(m).project(cam);
    return { x: (v.x + 1) * 0.5 * w, y: (1 - v.y) * 0.5 * h - up };
  });
}

/** Screen-space (NDC) corner positions of a card transform (for symmetry/fit tests). */
export function ndcCorners(aspect: number, t: Xform): [number, number][] {
  const cam = makeCamera(aspect);
  cam.updateProjectionMatrix();
  const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
  return ([[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]] as const).map(([cx, cy]) => {
    const v = new Vector3(cx, cy, 0).applyMatrix4(m).project(cam);
    return [v.x, v.y];
  });
}

/** Screen-space (NDC) x-extent of a set of card transforms, for fit checks in tests. */
export function ndcExtentX(aspect: number, xs: Xform[]): [number, number] {
  const cam = makeCamera(aspect);
  cam.updateProjectionMatrix();
  let lo = Infinity, hi = -Infinity;
  for (const t of xs) {
    const m = new Matrix4().compose(new Vector3(...t.p), new Quaternion(...t.q), new Vector3(t.s, t.s, t.s));
    for (const [cx, cy] of [[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [-CW / 2, CH / 2], [CW / 2, CH / 2]] as const) {
      const v = new Vector3(cx, cy, 0).applyMatrix4(m).project(cam);
      lo = Math.min(lo, v.x); hi = Math.max(hi, v.x);
    }
  }
  return [lo, hi];
}

/** Deterministic small jitter in [-1, 1] from a string. */
export function jitterOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 2 ** 32) * 2 - 1;
}
