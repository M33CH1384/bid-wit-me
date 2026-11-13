/**
 * Eye zoom (owner, 2026-11-07): a SEPARATE Settings toggle from Motion view,
 * OFF by default, shipped as an opt-in experiment. While it is on at a table,
 * the front camera reads — ON THE PHONE ONLY — whether the player is looking
 * at their CARDS (eyes down) or at the TABLE (eyes level), and eases the
 * shared viewAdjust zoom: cards -> wide (the table opens up, the full hand
 * fan front and center), table -> close. Gaze NEVER writes tilt.
 *
 * PRIVACY, hard rule: gaze is computed on-device. No frame is recorded,
 * stored, uploaded or sent anywhere; there are no network calls for gaze;
 * frames are discarded after each reading. The camera stream is local-only
 * and is closed whenever the feature is not actively running (toggle off,
 * a sheet/modal over the table, the app backgrounded, a calibration, or a
 * touch/Motion input inside its cooldown).
 *
 * The classification is deliberately COARSE — two zones read from the iris
 * centre's vertical position inside the eye, with a middle band that
 * changes nothing, thresholds derived from a per-player two-look
 * calibration (never a universal constant), a 700 ms dwell before any
 * switch, and the reverse switch needing its own full dwell.
 *
 * Pure math + stores + a driver class — no three, no React — like
 * motionView.ts. The camera/MediaPipe session lives in eyeGazeSession.ts,
 * reached ONLY through a dynamic import when the driver actually starts,
 * so a player who never enables Eye zoom never downloads any of it.
 */
import {
  clampViewAdjust, getViewAdjustState, beginViewAdjustGesture, updateViewAdjustLive,
  endViewAdjustGesture,
} from './viewAdjust';
import { importChunk } from './chunkLoad';

/* ------------------------------------------------------------- constants
 * Every feel knob for the feature lives here, named, so one-line retunes
 * after the owner's phone verdict never hunt through logic. */

/** How often the camera is sampled for a gaze reading, ms (~10 Hz). */
export const EYE_SAMPLE_INTERVAL_MS = 100;
/** Capture width asked of the camera, px: frames are read at most this wide. */
export const EYE_FRAME_WIDTH = 256;
/** A gaze zone must be held this long before the zoom switches, ms. */
export const EYE_DWELL_MS = 700;
/** Face unreadable for longer than this = "face lost" (position holds), ms. */
export const EYE_FACE_LOST_MS = 2000;
/** Zone switches ease the zoom over this long, ms. */
export const EYE_EASE_MS = 600;
/** CARDS zone zoom target: wide — the table opens up, the fan front and center. */
export const EYE_ZOOM_CARDS_TARGET = 0.9;
/** TABLE zone zoom target: close on the table. */
export const EYE_ZOOM_TABLE_TARGET = 1.15;
/** A touch drag/pinch pauses gaze for this long after it ends, ms. */
export const EYE_EXTERNAL_COOLDOWN_MS = 5000;
/** Each calibration look is sampled for this long, ms. */
export const EYE_CAL_STEP_MS = 1000;
/** A calibration look needs at least this many readable samples to count. */
export const EYE_CAL_MIN_SAMPLES = 5;
/** After a look is captured, the "Got it" confirm shows for this long before
 *  the next step paints, ms. The beat advances only to a WAITING step —
 *  since the 2026-11-08 ready gate, nothing is ever measured on time alone:
 *  each step's sampling starts on the player's own tap. */
export const EYE_CAL_GOT_IT_MS = 900;
/** The two calibration looks must differ by at least this much gaze travel,
 *  or the pair is degenerate (the player barely moved their eyes). */
export const EYE_CAL_MIN_SEPARATION = 0.08;
/** Inside the calibrated span, readings at/above table + span*this = CARDS zone. */
export const EYE_ZONE_CARDS_FRACTION = 0.6;
/** Inside the calibrated span, readings at/below table + span*this = TABLE zone. */
export const EYE_ZONE_TABLE_FRACTION = 0.4;
/** Driver housekeeping tick (ease advance + cooldown expiry), ms. */
export const EYE_DRIVER_TICK_MS = 50;
/** An eye whose lid opening is smaller than this (normalized coords) is unusable. */
export const EYE_MIN_EYE_OPEN = 0.004;
/** A face narrower than this (outer-corner distance, normalized) is too far to read. */
export const EYE_MIN_FACE_WIDTH = 0.05;
/** Head-pitch support gate: the nose's proportional drop between the eye
 *  line and the chin must sit inside this band for a reading to count.
 *  Pitch SUPPORTS validity only — it never classifies a zone. */
export const EYE_PITCH_MIN = 0.15;
export const EYE_PITCH_MAX = 0.85;

/* --------------------------------------------------------------- gaze math */

// Refined-mesh landmark indices (478-point model with iris refinement).
const LM = {
  leftOuter: 33, leftInner: 133, leftTop: 159, leftBottom: 145, leftIris: 468,
  rightInner: 362, rightOuter: 263, rightTop: 386, rightBottom: 374, rightIris: 473,
  nose: 1, chin: 152,
} as const;

export interface GazeReading { gazeV: number; pitch: number }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function eyeRatio(pts: readonly { x: number; y: number }[], top: number, bottom: number, iris: number): number | null {
  const t = pts[top], b = pts[bottom], i = pts[iris];
  if (!t || !b || !i || !finite(t.y) || !finite(b.y) || !finite(i.y)) return null;
  const h = b.y - t.y;
  if (h < EYE_MIN_EYE_OPEN) return null; // closed, or too small to read
  return (i.y - t.y) / h;
}

/**
 * One gaze reading from a 478-point landmark frame, or null when there is
 * no readable face. gazeV is the iris centre's height inside the eye —
 * ~0 = looking up, ~0.5 = level, ~1 = looking down — averaged over the
 * usable eyes. Head pitch is computed alongside and used ONLY as a
 * validity gate (a face turned far away produces iris numbers that mean
 * nothing); it never decides a zone.
 */
export function gazeVerticalFromLandmarks(pts: readonly { x: number; y: number }[]): GazeReading | null {
  if (!pts || pts.length < 478) return null;
  const lo = pts[LM.leftOuter], ro = pts[LM.rightOuter];
  if (!lo || !ro || !finite(lo.x) || !finite(lo.y) || !finite(ro.x) || !finite(ro.y)) return null;
  if (Math.hypot(ro.x - lo.x, ro.y - lo.y) < EYE_MIN_FACE_WIDTH) return null;
  const lt = pts[LM.leftTop], rt = pts[LM.rightTop], nose = pts[LM.nose], chin = pts[LM.chin];
  if (!lt || !rt || !nose || !chin || !finite(lt.y) || !finite(rt.y) || !finite(nose.y) || !finite(chin.y)) return null;
  const eyeLineY = (lt.y + rt.y) / 2;
  const span = chin.y - eyeLineY;
  if (span < 0.05) return null;
  const pitch = (nose.y - eyeLineY) / span;
  if (pitch < EYE_PITCH_MIN || pitch > EYE_PITCH_MAX) return null;
  const ratios: number[] = [];
  const l = eyeRatio(pts, LM.leftTop, LM.leftBottom, LM.leftIris);
  if (l !== null) ratios.push(l);
  const r = eyeRatio(pts, LM.rightTop, LM.rightBottom, LM.rightIris);
  if (r !== null) ratios.push(r);
  if (!ratios.length) return null;
  return { gazeV: ratios.reduce((a, b) => a + b, 0) / ratios.length, pitch };
}

/* ------------------------------------------------------------ calibration */

export interface EyeGazeCalibration { cards: number; table: number }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The per-player threshold from the two calibration looks. Junk samples
 * are ignored; a look with too few real samples, or a pair whose medians
 * barely differ (the player didn't really move their eyes — or read them
 * reversed), is rejected outright rather than stored as a bad threshold.
 */
export function computeCalibration(cardsSamples: number[], tableSamples: number[]): EyeGazeCalibration | null {
  const cards = (cardsSamples ?? []).filter(finite);
  const table = (tableSamples ?? []).filter(finite);
  if (cards.length < EYE_CAL_MIN_SAMPLES || table.length < EYE_CAL_MIN_SAMPLES) return null;
  const cal = { cards: median(cards), table: median(table) };
  if (cal.cards - cal.table < EYE_CAL_MIN_SEPARATION) return null;
  return cal;
}

/** Settings-boundary sanitizer: anything unusable becomes "no calibration". */
export function normalizeEyeZoomCalibration(raw: unknown): EyeGazeCalibration | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { cards?: unknown; table?: unknown };
  if (!finite(r.cards) || !finite(r.table)) return null;
  const cal = {
    cards: Math.min(1, Math.max(0, r.cards)),
    table: Math.min(1, Math.max(0, r.table)),
  };
  if (cal.cards - cal.table < EYE_CAL_MIN_SEPARATION) return null;
  return cal;
}

/* ------------------------------------------------------------------ zones */

export type GazeZone = 'cards' | 'table' | 'middle';

/** Where a reading falls inside THIS player's calibrated span. */
export function zoneForGaze(gazeV: number, cal: EyeGazeCalibration): GazeZone {
  const span = cal.cards - cal.table;
  if (gazeV >= cal.table + span * EYE_ZONE_CARDS_FRACTION) return 'cards';
  if (gazeV <= cal.table + span * EYE_ZONE_TABLE_FRACTION) return 'table';
  return 'middle';
}

/**
 * The anti-flap state machine. A zone switch fires only after the SAME
 * candidate zone is read continuously for EYE_DWELL_MS; a middle-band or
 * face-lost reading clears the candidate (the current zone is untouched);
 * the reverse switch needs its own full dwell by the same construction.
 * Losing the face never switches anything — the position simply holds.
 */
export class GazeZoneMachine {
  zone: 'none' | 'cards' | 'table' = 'none';
  private candidate: 'cards' | 'table' | null = null;
  private candidateSince = 0;
  private lastValidAt: number | null = null;

  constructor(private cal: EyeGazeCalibration) {}

  /** Feed one reading (null = no readable face). Returns the zone switched
   *  TO on the reading that completes a dwell, otherwise null. */
  feed(gazeV: number | null, nowMs: number): 'cards' | 'table' | null {
    if (gazeV === null || !finite(gazeV)) {
      this.candidate = null;
      return null;
    }
    this.lastValidAt = nowMs;
    const z = zoneForGaze(gazeV, this.cal);
    if (z === 'middle' || z === this.zone) {
      this.candidate = null;
      return null;
    }
    if (this.candidate !== z) {
      this.candidate = z;
      this.candidateSince = nowMs;
      return null;
    }
    if (nowMs - this.candidateSince >= EYE_DWELL_MS) {
      this.zone = z;
      this.candidate = null;
      return z;
    }
    return null;
  }

  isFaceLost(nowMs: number): boolean {
    return this.lastValidAt !== null && nowMs - this.lastValidAt > EYE_FACE_LOST_MS;
  }

  reset(): void {
    this.zone = 'none';
    this.candidate = null;
    this.lastValidAt = null;
  }
}

/* ------------------------------------------------------- camera probe */

export type EyeEnableResult = 'granted' | 'denied' | 'absent';

export interface EyeCameraEnv { mediaDevices?: unknown }

interface MediaDevicesLike {
  getUserMedia?: (c: unknown) => Promise<{ getTracks: () => { stop: () => void }[] }>;
}

/**
 * The enable probe for the Settings toggle, called FROM the toggle tap:
 * a real front-camera stream must open (and is stopped again immediately —
 * the table's driver opens its own when it runs). No API or no camera at
 * all -> 'absent'; a refusal -> 'denied'; anything unexpected fails closed
 * as 'denied'. The env is injectable for tests; a present key wins over
 * the navigator global.
 */
export async function enableEyeCamera(env: EyeCameraEnv = {}): Promise<EyeEnableResult> {
  const has = Object.prototype.hasOwnProperty.call(env, 'mediaDevices');
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as { mediaDevices?: unknown };
  const md = (has ? env.mediaDevices : nav.mediaDevices) as MediaDevicesLike | undefined;
  if (!md || typeof md.getUserMedia !== 'function') return 'absent';
  try {
    const stream = await md.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    for (const t of stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
    return 'granted';
  } catch (e) {
    const name = (e as { name?: string } | null | undefined)?.name;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'absent';
    return 'denied';
  }
}

/* ----------------------------------------------------------------- stores */

/** The toggle's runtime mirror. Table seeds it from settings next to the
 *  motion seed (the same lifecycle), Scene's driver subscribes. */
let eyeEnabled = false;
const eyeEnabledListeners = new Set<() => void>();
export function getEyeZoomEnabled(): boolean { return eyeEnabled; }
export function subscribeEyeZoomEnabled(fn: () => void): () => void {
  eyeEnabledListeners.add(fn);
  return () => { eyeEnabledListeners.delete(fn); };
}
export function seedEyeZoomEnabled(on: boolean): void {
  const v = on === true;
  if (v === eyeEnabled) return;
  eyeEnabled = v;
  for (const fn of [...eyeEnabledListeners]) fn();
}

/** The stored calibration's runtime mirror (Table seeds it from settings). */
let eyeCal: EyeGazeCalibration | null = null;
const eyeCalListeners = new Set<() => void>();
export function getEyeZoomCalibration(): EyeGazeCalibration | null { return eyeCal; }
export function subscribeEyeZoomCalibration(fn: () => void): () => void {
  eyeCalListeners.add(fn);
  return () => { eyeCalListeners.delete(fn); };
}
export function seedEyeZoomCalibration(cal: EyeGazeCalibration | null): void {
  const v = normalizeEyeZoomCalibration(cal);
  if (v === eyeCal) return;
  if (v && eyeCal && v.cards === eyeCal.cards && v.table === eyeCal.table) return;
  eyeCal = v;
  for (const fn of [...eyeCalListeners]) fn();
}

/** "Run calibration" asked from the Settings row: the next mounted table
 *  (or the one already under the sheet) opens the two-step overlay. */
let eyeCalRequested = false;
const eyeCalReqListeners = new Set<() => void>();
export function getEyeCalibrationRequested(): boolean { return eyeCalRequested; }
export function subscribeEyeCalibrationRequested(fn: () => void): () => void {
  eyeCalReqListeners.add(fn);
  return () => { eyeCalReqListeners.delete(fn); };
}
function setEyeCalRequested(v: boolean): void {
  if (v === eyeCalRequested) return;
  eyeCalRequested = v;
  for (const fn of [...eyeCalReqListeners]) fn();
}
export function requestEyeCalibration(): void { setEyeCalRequested(true); }
export function clearEyeCalibrationRequest(): void { setEyeCalRequested(false); }

/** True while the calibration overlay owns the camera (the driver rests). */
let eyeCalibrating = false;
const eyeCalibratingListeners = new Set<() => void>();
export function getEyeCalibrating(): boolean { return eyeCalibrating; }
export function subscribeEyeCalibrating(fn: () => void): () => void {
  eyeCalibratingListeners.add(fn);
  return () => { eyeCalibratingListeners.delete(fn); };
}
export function setEyeCalibrating(on: boolean): void {
  const v = on === true;
  if (v === eyeCalibrating) return;
  eyeCalibrating = v;
  for (const fn of [...eyeCalibratingListeners]) fn();
}

/** A plain-words runtime note from the driver (e.g. the camera stopped),
 *  shown on the Settings row — the row the player can act on. */
let eyeNote: string | null = null;
const eyeNoteListeners = new Set<() => void>();
export function getEyeZoomNote(): string | null { return eyeNote; }
export function subscribeEyeZoomNote(fn: () => void): () => void {
  eyeNoteListeners.add(fn);
  return () => { eyeNoteListeners.delete(fn); };
}
export function setEyeZoomNote(note: string | null): void {
  if (note === eyeNote) return;
  eyeNote = note;
  for (const fn of [...eyeNoteListeners]) fn();
}

/** Test hook: restore the pristine module state. */
export function __resetEyeZoomStore(): void {
  if (eyeEnabled) { eyeEnabled = false; for (const fn of [...eyeEnabledListeners]) fn(); }
  if (eyeCal) { eyeCal = null; for (const fn of [...eyeCalListeners]) fn(); }
  if (eyeCalRequested) { eyeCalRequested = false; for (const fn of [...eyeCalReqListeners]) fn(); }
  if (eyeCalibrating) { eyeCalibrating = false; for (const fn of [...eyeCalibratingListeners]) fn(); }
  if (eyeNote) { eyeNote = null; for (const fn of [...eyeNoteListeners]) fn(); }
}

/* ----------------------------------------------------------------- driver */

export interface EyeGazeSessionLike {
  start(onReading: (gazeV: number | null) => void): Promise<void>;
  stop(): void;
}

export interface EyeZoomDriverDeps {
  /** Injectable for tests; the default dynamically imports eyeGazeSession.ts. */
  sessionFactory?: () => EyeGazeSessionLike | Promise<EyeGazeSessionLike>;
  now?: () => number;
  onSessionError?: (err: unknown) => void;
}

async function defaultSessionFactory(): Promise<EyeGazeSessionLike> {
  // importChunk-guarded (house rule): a stale chunk after a deploy heals
  // instead of failing the camera start; a hard failure still rejects,
  // and the driver fails closed with its plain note.
  const m = await importChunk(() => import('./eyeGazeSession'));
  return m.createEyeGazeSession();
}

const smoothstep = (p: number) => p * p * (3 - 2 * p);

/**
 * The gaze driver. It exists per table view (mounted by Scene like the
 * motion driver) and runs the camera session ONLY while everything says
 * go: toggle on, calibrated, nothing suspended (sheet / panel / recap /
 * backgrounded / calibrating / a touch in progress), and no external-input
 * cooldown running. Session start/stop ride the running() edges, so the
 * camera is physically closed under every pause. A failed start is
 * reported once and never retried until the next state change (no spin).
 *
 * Zone switches ease ONLY the zoom, through the viewAdjust store's own
 * gesture channel — tilt is read live on every write and passed through,
 * so a simultaneous Motion-view lean is never fought.
 */
export class EyeZoomDriver {
  private sessionFactory: () => EyeGazeSessionLike | Promise<EyeGazeSessionLike>;
  private nowFn: () => number;
  private onSessionError?: (err: unknown) => void;
  private enabled = false;
  private calibration: EyeGazeCalibration | null = null;
  private suspend = new Set<string>();
  private cooldownUntil = -Infinity;
  private disposed = false;
  private errored = false;

  private session: EyeGazeSessionLike | null = null;
  private starting = false;
  private generation = 0;
  private machine: GazeZoneMachine | null = null;
  private ease: { from: number; to: number; startAt: number } | null = null;
  private gestureOpen = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: EyeZoomDriverDeps = {}) {
    this.sessionFactory = deps.sessionFactory ?? defaultSessionFactory;
    this.nowFn = deps.now ?? (() => Date.now());
    this.onSessionError = deps.onSessionError;
  }

  isSessionActive(): boolean { return this.session !== null; }

  private running(): boolean {
    return this.enabled && this.calibration !== null && this.suspend.size === 0
      && !this.disposed && !this.errored && this.nowFn() >= this.cooldownUntil;
  }

  setEnabled(on: boolean): void {
    const v = on === true;
    if (v === this.enabled) return;
    this.enabled = v;
    this.errored = false;
    if (v) this.startTick(); else this.stopTick();
    this.syncSession();
  }

  setCalibration(cal: EyeGazeCalibration | null): void {
    const v = normalizeEyeZoomCalibration(cal);
    const same = (v === null && this.calibration === null)
      || (v !== null && this.calibration !== null && v.cards === this.calibration.cards && v.table === this.calibration.table);
    if (same) return;
    this.calibration = v;
    this.errored = false;
    this.machine = null;
    this.syncSession();
  }

  setSuspended(reason: string, on: boolean): void {
    const has = this.suspend.has(reason);
    if (on === has) return;
    if (on) this.suspend.add(reason); else this.suspend.delete(reason);
    if (!on) this.errored = false; // a lifted pause is a fresh chance to start
    this.syncSession();
  }

  /** Touch input lands here: gaze rests for the cooldown (the camera
   *  closes), then resumes on its own. */
  noteExternalInput(): void {
    this.cooldownUntil = this.nowFn() + EYE_EXTERNAL_COOLDOWN_MS;
    this.errored = false;
    this.syncSession();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.stopTick();
    this.cancelEase();
    this.stopSession();
  }

  /** running() edges drive the session: rising -> fresh machine + camera
   *  start; falling -> camera closed and any ease settled where it rests. */
  private syncSession(): void {
    if (this.running()) {
      if (!this.session && !this.starting) void this.startSession();
    } else {
      this.cancelEase();
      this.stopSession();
    }
  }

  private async startSession(): Promise<void> {
    const gen = ++this.generation;
    this.starting = true;
    try {
      const s = await this.sessionFactory();
      if (gen !== this.generation || this.disposed) return;
      if (!this.running()) return;
      this.session = s;
      this.machine = this.calibration ? new GazeZoneMachine(this.calibration) : null;
      await s.start((gazeV) => this.onReading(gazeV));
      if (gen !== this.generation || this.disposed) return;
      if (!this.running()) this.stopSession(); // a pause landed mid-start
    } catch (e) {
      if (gen !== this.generation || this.disposed) return;
      this.session = null;
      this.errored = true;
      try { this.onSessionError?.(e); } catch { /* never throw */ }
    } finally {
      if (gen === this.generation) this.starting = false;
    }
  }

  private stopSession(): void {
    this.generation++;
    const s = this.session;
    this.session = null;
    this.machine = null;
    if (s) { try { s.stop(); } catch { /* never throw */ } }
  }

  private onReading(gazeV: number | null): void {
    if (!this.session || !this.running() || !this.machine) return;
    const switched = this.machine.feed(gazeV, this.nowFn());
    if (!switched) return;
    const target = switched === 'cards' ? EYE_ZOOM_CARDS_TARGET : EYE_ZOOM_TABLE_TARGET;
    const cur = clampViewAdjust(getViewAdjustState().adj).zoom;
    if (target === cur) return;
    this.ease = { from: cur, to: target, startAt: this.nowFn() };
    if (!this.gestureOpen) {
      beginViewAdjustGesture();
      this.gestureOpen = true;
    }
  }

  private onTick = (): void => {
    if (this.disposed) return;
    // Cooldown expiry is the one transition time alone can cause.
    if (this.enabled && !this.session && !this.starting) this.syncSession();
    if (!this.ease) return;
    if (!this.running()) { this.cancelEase(); return; }
    const now = this.nowFn();
    const p = Math.min(1, Math.max(0, (now - this.ease.startAt) / EYE_EASE_MS));
    const cur = getViewAdjustState().adj;
    const zoom = this.ease.from + (this.ease.to - this.ease.from) * smoothstep(p);
    updateViewAdjustLive({ tilt: cur.tilt, zoom });
    if (p >= 1) {
      this.ease = null;
      this.closeGesture();
    }
  };

  private cancelEase(): void {
    if (!this.ease) return;
    this.ease = null;
    this.closeGesture(); // settles + commits exactly where the view rests
  }

  private closeGesture(): void {
    if (!this.gestureOpen) return;
    this.gestureOpen = false;
    endViewAdjustGesture(getViewAdjustState().adj);
  }

  private startTick(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(this.onTick, EYE_DRIVER_TICK_MS);
  }

  private stopTick(): void {
    if (this.tickTimer !== null) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }
}
