/**
 * Adjustable table view (owner, 2026-10-29): the player tilts the 3D table
 * camera toward/away from the felt and dollies in/out a touch, the position
 * shows on screen while adjusting, and it saves. Pure math + a tiny store —
 * no three, no React — so the entry graph never sees this file's weight and
 * every rule is testable without a canvas.
 *
 * The offset composes ON TOP of the stock framing (three/layout cameraFor,
 * plus the Porch people framing where it applies): CameraRig renders
 * applyViewAdjustToSpec(baseSpec, adj) and Cards refits the human fan from
 * the stock spec to that same adjusted spec, so the hand keeps its solved
 * screen layout at any tilt/zoom while the room moves behind it.
 */

/** Tilt bounds, degrees around the base framing. +tilt aims DOWN toward the
 *  felt (see the cards more face-on); −tilt lifts the aim toward the far side. */
export const VIEW_TILT_MIN = -15;
export const VIEW_TILT_MAX = 15;
/** Zoom bounds as a dolly multiplier: 1 = stock distance, >1 = closer. */
export const VIEW_ZOOM_MIN = 0.85;
export const VIEW_ZOOM_MAX = 1.3;

export interface ViewAdjust { tilt: number; zoom: number }
export const DEFAULT_VIEW_ADJUST: ViewAdjust = { tilt: 0, zoom: 1 };

/** Drag sensitivity: a ~210px drag sweeps the full 30° tilt range. */
export const VIEW_TILT_PX_PER_DEG = 7;
/** A press only becomes a view drag past this many CSS pixels (a tap stays a tap). */
export const VIEW_DRAG_THRESHOLD_PX = 10;
/** Double-tap reset: the second press lands within this window of the first release... */
export const VIEW_DOUBLE_TAP_MS = 320;
/** ...and within this many pixels of the first tap. */
export const VIEW_DOUBLE_TAP_SLOP_PX = 32;
/** The readout chip lingers this long after the last adjustment. */
export const VIEW_READOUT_LINGER_MS = 2000;

const clampN = (v: number, lo: number, hi: number, dflt: number) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

export function clampViewAdjust(a: ViewAdjust): ViewAdjust {
  return {
    tilt: clampN(a?.tilt, VIEW_TILT_MIN, VIEW_TILT_MAX, 0),
    zoom: clampN(a?.zoom, VIEW_ZOOM_MIN, VIEW_ZOOM_MAX, 1),
  };
}

/** Settings-boundary sanitizer: anything unusable becomes the default view. */
export function normalizeViewAdjust(raw: unknown): ViewAdjust {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VIEW_ADJUST };
  const r = raw as { tilt?: unknown; zoom?: unknown };
  return clampViewAdjust({ tilt: r.tilt as number, zoom: r.zoom as number });
}

export function viewAdjustEquals(a: ViewAdjust, b: ViewAdjust): boolean {
  return a.tilt === b.tilt && a.zoom === b.zoom;
}
export function isDefaultViewAdjust(a: ViewAdjust): boolean {
  return a.tilt === 0 && a.zoom === 1;
}

export interface CamSpecLike { pos: readonly number[]; look: readonly number[]; fov: number }

/**
 * The adjusted spec for a base spec. Tilt rotates the aim around the camera
 * position in the YZ plane — the same rotation layout.pitchAimDown applies
 * for the Sitting extra pitch, so positive tilt pitches down toward the felt.
 * Zoom dollies the position along the view axis toward the aim (distance ÷
 * zoom); the aim and fov never move, so nothing reframes sideways.
 */
export function applyViewAdjustToSpec<T extends CamSpecLike>(spec: T, adj: ViewAdjust): T {
  const a = clampViewAdjust(adj);
  if (isDefaultViewAdjust(a)) return spec;
  const [px, py, pz] = [spec.pos[0]!, spec.pos[1]!, spec.pos[2]!];
  let lx = spec.look[0]!, ly = spec.look[1]!, lz = spec.look[2]!;
  if (a.tilt !== 0) {
    const r = (a.tilt * Math.PI) / 180;
    const dy = ly - py, dz = lz - pz;
    ly = py + dy * Math.cos(r) + dz * Math.sin(r);
    lz = pz + dz * Math.cos(r) - dy * Math.sin(r);
  }
  let nx = px, ny = py, nz = pz;
  if (a.zoom !== 1) {
    const k = 1 / a.zoom;
    nx = lx + (px - lx) * k; ny = ly + (py - ly) * k; nz = lz + (pz - lz) * k;
  }
  return { ...spec, pos: [nx, ny, nz], look: [lx, ly, lz] };
}

/** Pitch of a spec's view axis below horizontal, in degrees. Test/diagnostic helper. */
export function specPitchDeg(spec: CamSpecLike): number {
  const dy = spec.pos[1]! - spec.look[1]!;
  const dz = spec.pos[2]! - spec.look[2]!;
  return (Math.atan2(dy, dz) * 180) / Math.PI;
}

/** Tilt after a vertical drag: finger UP (dyPx < 0) tilts toward the table. */
export function tiltForDragY(startTilt: number, dyPx: number): number {
  return clampViewAdjust({ tilt: startTilt - dyPx / VIEW_TILT_PX_PER_DEG, zoom: 1 }).tilt;
}

export function pinchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Zoom after a pinch: fingers spreading (dist > startDist) dollies in. */
export function zoomForPinchDist(startZoom: number, startDist: number, dist: number): number {
  if (!(startDist > 0) || !(dist > 0)) return clampViewAdjust({ tilt: 0, zoom: startZoom }).zoom;
  return clampViewAdjust({ tilt: 0, zoom: startZoom * (dist / startDist) }).zoom;
}

/** Zoom after a wheel tick: wheel up (deltaY < 0) dollies in. */
export function zoomForWheelDelta(startZoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY)) return clampViewAdjust({ tilt: 0, zoom: startZoom }).zoom;
  return clampViewAdjust({ tilt: 0, zoom: startZoom * Math.exp(-deltaY * 0.0016) }).zoom;
}

/** The readout chip's line, e.g. "Tilt 8° · Zoom 112%". */
export function viewAdjustLabel(a: ViewAdjust): string {
  const t = Math.round(clampViewAdjust(a).tilt);
  const z = Math.round(clampViewAdjust(a).zoom * 100);
  return `Tilt ${t}° · Zoom ${z}%`;
}

/* ------------------------------------------------------------------ store */

/**
 * The live view-adjust state. Table seeds it from the saved settings before
 * the Scene mounts, the gesture layer drives it during a drag, CameraRig and
 * Cards subscribe to it, and Table persists through the commit channel —
 * commits fire ONLY at gesture end (or reset), never per pointermove, so a
 * drag never re-renders the app's settings tree.
 */
export interface ViewAdjustState { adj: ViewAdjust; adjusting: boolean }

let state: ViewAdjustState = { adj: { ...DEFAULT_VIEW_ADJUST }, adjusting: false };
/** The last value handed to the persist channel (or loaded by a seed). A
 *  gesture commits iff its resting value differs from THIS — never from the
 *  live state, which the drag itself has already moved to the final value
 *  (comparing against it would silently drop the save whenever the last
 *  live update landed before the release). */
let lastCommitted: ViewAdjust = { ...DEFAULT_VIEW_ADJUST };
const listeners = new Set<() => void>();
const commitListeners = new Set<(adj: ViewAdjust) => void>();
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: ViewAdjustState): void {
  if (next.adj === state.adj && next.adjusting === state.adjusting) return;
  state = next;
  for (const fn of [...listeners]) fn();
}
function clearLinger(): void {
  if (lingerTimer !== null) { clearTimeout(lingerTimer); lingerTimer = null; }
}
function startLinger(): void {
  clearLinger();
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    emit({ adj: state.adj, adjusting: false });
  }, VIEW_READOUT_LINGER_MS);
}

export function getViewAdjustState(): ViewAdjustState { return state; }
export function subscribeViewAdjust(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/** Persist channel: fired once per finished gesture / reset, with the final value. */
export function onViewAdjustCommit(fn: (adj: ViewAdjust) => void): () => void {
  commitListeners.add(fn);
  return () => { commitListeners.delete(fn); };
}

/** Load a saved value (mount, or an external settings change). Never commits. */
export function seedViewAdjust(adj: ViewAdjust): void {
  const a = clampViewAdjust(adj);
  lastCommitted = a; // a seed IS the persisted value
  if (viewAdjustEquals(a, state.adj)) return;
  clearLinger();
  emit({ adj: a, adjusting: false });
}

/** A gesture is touching the view: the chip shows from the first real move. */
export function beginViewAdjustGesture(): void {
  clearLinger();
  emit({ adj: state.adj, adjusting: true });
}

/** Live value during a gesture. Reference-stable when the value is unchanged. */
export function updateViewAdjustLive(adj: ViewAdjust): void {
  const a = clampViewAdjust(adj);
  if (viewAdjustEquals(a, state.adj)) return;
  emit({ adj: a, adjusting: state.adjusting });
}

function fireCommit(adj: ViewAdjust): void {
  lastCommitted = adj;
  for (const fn of [...commitListeners]) fn(adj);
}

/** Gesture end: the value saves, and the chip lingers so the player can read it. */
export function endViewAdjustGesture(adj: ViewAdjust): void {
  const a = clampViewAdjust(adj);
  emit({ adj: a, adjusting: true });
  startLinger();
  if (!viewAdjustEquals(a, lastCommitted)) fireCommit(a);
}

/** Double-tap reset: back to the stock framing, saved like any other position. */
export function resetViewAdjust(): void {
  const a = { ...DEFAULT_VIEW_ADJUST };
  emit({ adj: a, adjusting: true });
  startLinger();
  if (!viewAdjustEquals(a, lastCommitted)) fireCommit(a);
}

/** Test hook: restore the pristine store. */
export function __resetViewAdjustStore(): void {
  clearLinger();
  state = { adj: { ...DEFAULT_VIEW_ADJUST }, adjusting: false };
  lastCommitted = { ...DEFAULT_VIEW_ADJUST };
  listeners.clear();
  commitListeners.clear();
}

/* ------------------------------------------------------- gesture tracker */

/**
 * The pointer state machine, pure so it is fully testable. The DOM layer
 * decides per pointerdown whether the press began on the open table
 * (`onTable`) — canvas target, not on a fan card, not on any UI — and feeds
 * events in; the tracker decides what they mean:
 *
 * - one table pointer, dragged vertically past the threshold → tilt (live);
 * - a second table pointer → pinch (zoom only, tilt frozen at pinch start);
 *   when a pinch ends, the remaining pointer is dead until it lifts, so the
 *   view never jumps from a half-released pinch;
 * - a press that never passes the threshold is a tap: it changes nothing,
 *   and two taps in quick succession on the table reset the view;
 * - cancel (pointercancel, rotation, blur) ends the gesture at its current
 *   value and commits it — the saved offset is never corrupted or lost.
 */
export type ViewGestureEvents = {
  onBegin(): void;
  onLive(adj: ViewAdjust): void;
  onEnd(adj: ViewAdjust): void;
  onReset(): void;
};

interface TrackedPointer { x: number; y: number; startX: number; startY: number }

export class ViewGestureTracker {
  private pointers = new Map<number, TrackedPointer>();
  private mode: 'idle' | 'pending' | 'drag' | 'pinch' | 'dead' = 'idle';
  private startAdj: ViewAdjust = { ...DEFAULT_VIEW_ADJUST };
  private currentAdj: ViewAdjust = { ...DEFAULT_VIEW_ADJUST };
  private pinchStartDist = 0;
  private pinchStartAdj: ViewAdjust = { ...DEFAULT_VIEW_ADJUST };
  private lastTap: { at: number; x: number; y: number } | null = null;

  constructor(private events: ViewGestureEvents) {}

  get active(): boolean { return this.mode === 'drag' || this.mode === 'pinch'; }
  get current(): ViewAdjust { return this.currentAdj; }

  down(id: number, x: number, y: number, onTable: boolean, adj: ViewAdjust, now: number): void {
    if (!onTable) return; // a UI/card press is never tracked; an ongoing gesture is untouched
    if (this.mode === 'dead') { this.pointers.set(id, { x, y, startX: x, startY: y }); return; }
    if (this.pointers.has(id)) return;
    if (this.pointers.size === 0) {
      this.pointers.set(id, { x, y, startX: x, startY: y });
      this.mode = 'pending';
      this.startAdj = clampViewAdjust(adj);
      this.currentAdj = this.startAdj;
      return;
    }
    if (this.pointers.size === 1 && (this.mode === 'pending' || this.mode === 'drag')) {
      const first = [...this.pointers.values()][0]!;
      this.pointers.set(id, { x, y, startX: x, startY: y });
      this.pinchStartDist = pinchDistance(first, { x, y });
      this.pinchStartAdj = this.currentAdj;
      if (this.mode === 'pending') this.events.onBegin();
      this.mode = 'pinch';
    }
    // A third pointer is ignored entirely.
  }

  move(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    p.x = x; p.y = y;
    if (this.mode === 'pending') {
      if (Math.hypot(x - p.startX, y - p.startY) < VIEW_DRAG_THRESHOLD_PX) return;
      this.mode = 'drag';
      this.events.onBegin();
      this.applyDrag(p);
      return;
    }
    if (this.mode === 'drag') { this.applyDrag(p); return; }
    if (this.mode === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const zoom = zoomForPinchDist(this.pinchStartAdj.zoom, this.pinchStartDist, pinchDistance(a, b));
      this.currentAdj = { tilt: this.pinchStartAdj.tilt, zoom };
      this.events.onLive(this.currentAdj);
    }
  }

  private applyDrag(p: TrackedPointer): void {
    this.currentAdj = { tilt: tiltForDragY(this.startAdj.tilt, p.y - p.startY), zoom: this.startAdj.zoom };
    this.events.onLive(this.currentAdj);
  }

  up(id: number, x: number, y: number, now: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    if (this.mode === 'pending') {
      this.mode = 'idle';
      // It was a tap. Two in quick succession, close together, reset the view.
      if (this.lastTap && now - this.lastTap.at <= VIEW_DOUBLE_TAP_MS && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) <= VIEW_DOUBLE_TAP_SLOP_PX) {
        this.lastTap = null;
        this.events.onReset();
      } else {
        this.lastTap = { at: now, x, y };
      }
      return;
    }
    if (this.mode === 'drag') {
      this.mode = this.pointers.size > 0 ? 'dead' : 'idle';
      this.events.onEnd(this.currentAdj);
      return;
    }
    if (this.mode === 'pinch') {
      this.mode = this.pointers.size > 0 ? 'dead' : 'idle';
      this.events.onEnd(this.currentAdj);
      return;
    }
    if (this.mode === 'dead' && this.pointers.size === 0) this.mode = 'idle';
  }

  /** One pointer cancelled by the OS: end at the current value, like a release. */
  cancelPointer(id: number): void {
    if (!this.pointers.has(id)) return;
    this.pointers.delete(id);
    if (this.mode === 'drag' || this.mode === 'pinch') {
      this.mode = this.pointers.size > 0 ? 'dead' : 'idle';
      this.events.onEnd(this.currentAdj);
      return;
    }
    if (this.mode === 'pending') this.mode = 'idle';
    if (this.mode === 'dead' && this.pointers.size === 0) this.mode = 'idle';
  }

  /** Rotation / posture change / panel takeover mid-gesture: commit where we are. */
  cancelAll(): void {
    const wasLive = this.mode === 'drag' || this.mode === 'pinch';
    this.pointers.clear();
    this.mode = 'idle';
    if (wasLive) this.events.onEnd(this.currentAdj);
  }
}
