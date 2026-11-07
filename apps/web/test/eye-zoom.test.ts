/**
 * @vitest-environment happy-dom
 *
 * EYE ZOOM (owner, 2026-11-07): a SEPARATE Settings toggle from Motion view,
 * OFF by default. The front camera reads — on the phone only, frames never
 * stored or sent — whether the player is looking at their CARDS (eyes down)
 * or at the TABLE (eyes level), and eases the shared viewAdjust zoom:
 * cards -> wide (0.90), table -> close (1.15). Gaze never writes tilt.
 *
 * Pins below are the contract:
 *  - the classifier is COARSE: iris vertical position inside the eye, a
 *    middle band that changes nothing, and a per-player calibration the
 *    thresholds are derived from (never a universal constant);
 *  - a zone switch needs a full 700 ms DWELL, the reverse switch its own;
 *  - a touch drag/pinch pauses gaze for 5 s after it ends;
 *  - OFF means no session, no stream, no library — byte-identical to today;
 *  - every feel constant is named in eyeZoom.ts for one-line retunes.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EYE_CAL_MIN_SAMPLES, EYE_CAL_MIN_SEPARATION, EYE_DWELL_MS, EYE_EASE_MS,
  EYE_EXTERNAL_COOLDOWN_MS, EYE_FACE_LOST_MS, EYE_ZOOM_CARDS_TARGET, EYE_ZOOM_TABLE_TARGET,
  EyeZoomDriver, GazeZoneMachine, computeCalibration, enableEyeCamera, gazeVerticalFromLandmarks,
  getEyeZoomCalibration, getEyeZoomEnabled, getEyeZoomNote, normalizeEyeZoomCalibration,
  requestEyeCalibration, getEyeCalibrationRequested, clearEyeCalibrationRequest,
  seedEyeZoomCalibration, seedEyeZoomEnabled, setEyeZoomNote, zoneForGaze,
  __resetEyeZoomStore, type EyeGazeCalibration, type EyeGazeSessionLike,
} from '../src/eyeZoom';
import {
  __resetViewAdjustStore, getViewAdjustState, onViewAdjustCommit, seedViewAdjust, updateViewAdjustLive,
} from '../src/viewAdjust';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { fx } from '../src/fx';
import EyeZoomRow from '../src/EyeZoomRow';
import EyeZoomCalibrate from '../src/EyeZoomCalibrate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 20000 });

const CAL: EyeGazeCalibration = { cards: 0.8, table: 0.4 };

/* ------------------------------------------------- synthetic face builder */

/** A 478-point refined-mesh face with a chosen iris height ratio per eye.
 *  ratio 0 = iris at the top lid (looking up), 1 = at the bottom lid (down). */
function makeFace(opts: {
  ratio?: number; ratioR?: number; eyeH?: number; eyeHR?: number; pitch?: number; faceW?: number;
} = {}): { x: number; y: number }[] {
  const eyeH = opts.eyeH ?? 0.02;
  const eyeHR = opts.eyeHR ?? eyeH;
  const ratio = opts.ratio ?? 0.5;
  const ratioR = opts.ratioR ?? ratio;
  const pitch = opts.pitch ?? 0.45;
  const faceW = opts.faceW ?? 0.28;
  const pts: { x: number; y: number }[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const cxL = 0.5 - faceW / 2 + 0.06, cxR = 0.5 + faceW / 2 - 0.06;
  const topY = 0.45, chinY = 0.75;
  const set = (i: number, x: number, y: number) => { pts[i] = { x, y }; };
  // left eye: outer 33, inner 133, top 159, bottom 145, iris 468
  set(33, 0.5 - faceW / 2, topY + eyeH / 2); set(133, cxL + 0.06, topY + eyeH / 2);
  set(159, cxL, topY); set(145, cxL, topY + eyeH); set(468, cxL, topY + eyeH * ratio);
  // right eye: inner 362, outer 263, top 386, bottom 374, iris 473
  set(362, cxR - 0.06, topY + eyeHR / 2); set(263, 0.5 + faceW / 2, topY + eyeHR / 2);
  set(386, cxR, topY); set(374, cxR, topY + eyeHR); set(473, cxR, topY + eyeHR * ratioR);
  // nose tip 1, chin 152 (head-pitch support geometry)
  set(1, 0.5, topY + pitch * (chinY - topY)); set(152, 0.5, chinY);
  set(10, 0.5, 0.3); // forehead
  return pts;
}

/* ------------------------------------------------------------ gaze math */

describe('gazeVerticalFromLandmarks (iris height inside the eye)', () => {
  it('reads the iris ratio: level eyes ~0.5, eyes down high, eyes up low', () => {
    expect(gazeVerticalFromLandmarks(makeFace({ ratio: 0.5 }))!.gazeV).toBeCloseTo(0.5, 6);
    expect(gazeVerticalFromLandmarks(makeFace({ ratio: 0.85 }))!.gazeV).toBeCloseTo(0.85, 6);
    expect(gazeVerticalFromLandmarks(makeFace({ ratio: 0.15 }))!.gazeV).toBeCloseTo(0.15, 6);
  });

  it('averages the two eyes, and survives one unusable eye', () => {
    const both = gazeVerticalFromLandmarks(makeFace({ ratio: 0.4, ratioR: 0.6 }));
    expect(both!.gazeV).toBeCloseTo(0.5, 6);
    const oneClosed = gazeVerticalFromLandmarks(makeFace({ ratio: 0.8, eyeHR: 0.0005 }));
    expect(oneClosed!.gazeV).toBeCloseTo(0.8, 6);
  });

  it('closed eyes, a turned-away face, a far face, or junk input read as NO face', () => {
    expect(gazeVerticalFromLandmarks(makeFace({ eyeH: 0.0005 }))).toBeNull();
    expect(gazeVerticalFromLandmarks(makeFace({ pitch: 0.02 }))).toBeNull();
    expect(gazeVerticalFromLandmarks(makeFace({ pitch: 0.97 }))).toBeNull();
    expect(gazeVerticalFromLandmarks(makeFace({ faceW: 0.02 }))).toBeNull();
    expect(gazeVerticalFromLandmarks(makeFace().slice(0, 100))).toBeNull();
    expect(gazeVerticalFromLandmarks([])).toBeNull();
  });
});

/* ----------------------------------------------------------- calibration */

describe('computeCalibration (two captures -> a personal threshold)', () => {
  const cards = [0.78, 0.8, 0.82, 0.79, 0.81];
  const table = [0.38, 0.4, 0.42, 0.39, 0.41];

  it('takes the median of each capture', () => {
    expect(computeCalibration(cards, table)).toEqual({ cards: 0.8, table: 0.4 });
    expect(computeCalibration([...cards, 0.83], table)!.cards).toBeCloseTo(0.805, 6); // even count: middle pair
  });

  it('ignores junk samples but still needs the minimum of real ones', () => {
    const dirty = [0.78, Number.NaN, 0.8, 0.82, 0.79, 0.81, Number.POSITIVE_INFINITY];
    expect(computeCalibration(dirty, table)).toEqual({ cards: 0.8, table: 0.4 });
    expect(computeCalibration(cards.slice(0, EYE_CAL_MIN_SAMPLES - 1), table)).toBeNull();
    expect(computeCalibration(cards, table.slice(0, 2))).toBeNull();
  });

  it('rejects degenerate captures: eyes barely moved between the two looks', () => {
    const flat = [0.5, 0.52, 0.51, 0.5, 0.52];
    const near = [0.44, 0.45, 0.46, 0.45, 0.44]; // separation 0.06 < the 0.08 floor
    expect(computeCalibration(flat, near)).toBeNull();
    expect(computeCalibration(table, cards)).toBeNull(); // reversed: "cards" read LOWER than "table"
    const just = [0.4 + EYE_CAL_MIN_SEPARATION + 0.01, 0.4 + EYE_CAL_MIN_SEPARATION + 0.01, 0.4 + EYE_CAL_MIN_SEPARATION + 0.01, 0.4 + EYE_CAL_MIN_SEPARATION + 0.01, 0.4 + EYE_CAL_MIN_SEPARATION + 0.01];
    expect(computeCalibration(just, [0.4, 0.4, 0.4, 0.4, 0.4])).not.toBeNull();
  });

  it('normalizeEyeZoomCalibration: stored junk becomes null, a real pair survives clamped', () => {
    expect(normalizeEyeZoomCalibration(null)).toBeNull();
    expect(normalizeEyeZoomCalibration({ cards: 'high', table: 0.4 })).toBeNull();
    expect(normalizeEyeZoomCalibration({ cards: 0.45, table: 0.44 })).toBeNull(); // no separation
    expect(normalizeEyeZoomCalibration({ cards: 0.8, table: 0.4 })).toEqual({ cards: 0.8, table: 0.4 });
    expect(normalizeEyeZoomCalibration({ cards: 1.4, table: -0.2 })).toEqual({ cards: 1, table: 0 });
  });
});

describe('zoneForGaze (the middle band changes nothing)', () => {
  it('splits the calibrated span: top fraction cards, bottom fraction table, middle idle', () => {
    // cal span 0.40..0.80: cardsCut = 0.64, tableCut = 0.56
    expect(zoneForGaze(0.85, CAL)).toBe('cards');
    expect(zoneForGaze(0.64, CAL)).toBe('cards');
    expect(zoneForGaze(0.5, CAL)).toBe('table');
    expect(zoneForGaze(0.56, CAL)).toBe('table');
    expect(zoneForGaze(0.6, CAL)).toBe('middle');
  });
});

/* --------------------------------------------------------- zone machine */

describe('GazeZoneMachine (dwell + hysteresis)', () => {
  const feedFor = (m: GazeZoneMachine, gazeV: number, fromMs: number, toMs: number, stepMs = 100) => {
    let ev: unknown = null;
    for (let t = fromMs; t <= toMs; t += stepMs) { const r = m.feed(gazeV, t); if (r) ev = r; }
    return ev;
  };

  it('a zone must be held for the full dwell before the switch fires — once', () => {
    const m = new GazeZoneMachine(CAL);
    expect(feedFor(m, 0.8, 0, EYE_DWELL_MS - 100)).toBeNull();
    expect(m.zone).toBe('none');
    expect(m.feed(0.8, EYE_DWELL_MS)).toBe('cards');
    expect(m.zone).toBe('cards');
    expect(feedFor(m, 0.8, EYE_DWELL_MS + 100, EYE_DWELL_MS + 1000)).toBeNull(); // never re-fires
  });

  it('the reverse switch needs its OWN full dwell', () => {
    const m = new GazeZoneMachine(CAL);
    feedFor(m, 0.8, 0, EYE_DWELL_MS);
    expect(m.zone).toBe('cards');
    expect(feedFor(m, 0.4, 1000, 1000 + EYE_DWELL_MS - 100)).toBeNull();
    expect(m.zone).toBe('cards');
    expect(m.feed(0.4, 1000 + EYE_DWELL_MS)).toBe('table');
  });

  it('a middle-band reading cancels a pending switch but keeps the current zone', () => {
    const m = new GazeZoneMachine(CAL);
    feedFor(m, 0.8, 0, EYE_DWELL_MS); // in cards
    feedFor(m, 0.4, 1000, 1500); // table candidate building
    m.feed(0.6, 1600); // middle: candidate gone
    expect(feedFor(m, 0.4, 1700, 1700 + EYE_DWELL_MS - 100)).toBeNull();
    expect(m.feed(0.4, 1700 + EYE_DWELL_MS)).toBe('table'); // full dwell from the restart
  });

  it('losing the face cancels a pending switch, never changes the zone, and is reported after the grace', () => {
    const m = new GazeZoneMachine(CAL);
    feedFor(m, 0.8, 0, EYE_DWELL_MS);
    feedFor(m, 0.4, 1000, 1500);
    m.feed(null, 1600);
    expect(feedFor(m, 0.4, 1700, 1700 + EYE_DWELL_MS - 100)).toBeNull();
    expect(m.zone).toBe('cards');
    // last readable face was at t=2300; the lost grace runs from there
    expect(m.isFaceLost(2300 + EYE_FACE_LOST_MS)).toBe(false);
    m.feed(null, 2300 + EYE_FACE_LOST_MS + 100);
    expect(m.isFaceLost(2300 + EYE_FACE_LOST_MS + 100)).toBe(true);
    expect(m.zone).toBe('cards'); // held, exactly as specified
  });
});

/* ------------------------------------------------------------- fake rig */

class FakeSession implements EyeGazeSessionLike {
  startCalls = 0;
  stopCalls = 0;
  failStart = false;
  private cb: ((gazeV: number | null) => void) | null = null;
  async start(cb: (gazeV: number | null) => void): Promise<void> {
    this.startCalls++;
    if (this.failStart) throw new Error('camera denied');
    this.cb = cb;
  }
  stop(): void { this.stopCalls++; this.cb = null; }
  get active(): boolean { return this.cb !== null; }
  emit(gazeV: number | null): void { this.cb?.(gazeV); }
}

describe('EyeZoomDriver (session lifecycle, easing, cooldowns)', () => {
  let session: FakeSession;
  let driver: EyeZoomDriver;
  let commits: { tilt: number; zoom: number }[];
  const adj = () => getViewAdjustState().adj;
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  /** Feed a gaze value every 100 ms of fake time for `ms` (emit, then advance):
   *  gazeFor(v, 700) delivers readings at t=0..600, so one more emit at t=700
   *  completes a full 700 ms dwell. */
  const gazeFor = (gazeV: number, ms: number) => {
    for (let t = 0; t < ms; t += 100) { session.emit(gazeV); vi.advanceTimersByTime(100); }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    __resetViewAdjustStore();
    __resetEyeZoomStore();
    seedViewAdjust({ tilt: 5, zoom: 1 });
    commits = [];
    onViewAdjustCommit((a) => commits.push({ ...a }));
    session = new FakeSession();
    driver = new EyeZoomDriver({ sessionFactory: () => session });
    driver.setCalibration(CAL);
  });
  afterEach(() => {
    driver.dispose();
    vi.useRealTimers();
    __resetViewAdjustStore();
    __resetEyeZoomStore();
  });

  it('OFF (or uncalibrated) means NO session: the camera is never opened', async () => {
    driver.setCalibration(null);
    driver.setEnabled(true);
    await flush();
    expect(session.startCalls).toBe(0);
    driver.setCalibration(CAL);
    await flush();
    expect(session.startCalls).toBe(1);
    driver.setEnabled(false);
    expect(session.stopCalls).toBe(1);
    expect(session.active).toBe(false);
  });

  it('cards zone: after the dwell the zoom eases wide over the ease window and commits once', async () => {
    driver.setEnabled(true);
    await flush();
    gazeFor(0.8, EYE_DWELL_MS); // dwell in cards (readings at 100..700)
    session.emit(0.8); // the reading that completes the dwell
    vi.advanceTimersByTime(EYE_EASE_MS / 2);
    expect(adj().zoom).toBeCloseTo(1 + (EYE_ZOOM_CARDS_TARGET - 1) * 0.5, 3); // smoothstep midpoint
    expect(adj().tilt).toBe(5);
    vi.advanceTimersByTime(EYE_EASE_MS / 2 + 100);
    expect(adj().zoom).toBeCloseTo(EYE_ZOOM_CARDS_TARGET, 6);
    expect(commits.length).toBe(1);
    expect(commits[0]).toEqual({ tilt: 5, zoom: EYE_ZOOM_CARDS_TARGET });
  });

  it('gaze NEVER writes tilt — a tilt set by someone else mid-ease is carried through', async () => {
    driver.setEnabled(true);
    await flush();
    gazeFor(0.8, EYE_DWELL_MS);
    session.emit(0.8);
    vi.advanceTimersByTime(200); // ease under way
    updateViewAdjustLive({ tilt: 9, zoom: adj().zoom }); // Motion view leans mid-ease
    vi.advanceTimersByTime(EYE_EASE_MS);
    expect(adj().tilt).toBe(9);
    expect(adj().zoom).toBeCloseTo(EYE_ZOOM_CARDS_TARGET, 6);
  });

  it('table zone eases back in close; the targets sit inside the shipped zoom bounds', async () => {
    expect(EYE_ZOOM_CARDS_TARGET).toBeGreaterThanOrEqual(0.85);
    expect(EYE_ZOOM_TABLE_TARGET).toBeLessThanOrEqual(1.3);
    driver.setEnabled(true);
    await flush();
    gazeFor(0.8, EYE_DWELL_MS); session.emit(0.8);
    vi.advanceTimersByTime(EYE_EASE_MS + 100);
    expect(adj().zoom).toBeCloseTo(EYE_ZOOM_CARDS_TARGET, 6);
    gazeFor(0.4, EYE_DWELL_MS); session.emit(0.4);
    vi.advanceTimersByTime(EYE_EASE_MS + 100);
    expect(adj().zoom).toBeCloseTo(EYE_ZOOM_TABLE_TARGET, 6);
  });

  it('a sheet opening mid-ease stops the camera and settles the view where it rests', async () => {
    driver.setEnabled(true);
    await flush();
    gazeFor(0.8, EYE_DWELL_MS); session.emit(0.8);
    vi.advanceTimersByTime(200);
    const mid = adj().zoom;
    driver.setSuspended('sheet', true);
    expect(session.active).toBe(false);
    expect(adj().zoom).toBeCloseTo(mid, 6); // frozen where it was, committed
    expect(commits[commits.length - 1]!.zoom).toBeCloseTo(mid, 6);
    driver.setSuspended('sheet', false);
    await flush();
    expect(session.startCalls).toBe(2); // camera restarts on resume
  });

  it('external input (a touch on the felt) pauses gaze for the full cooldown, then it resumes by itself', async () => {
    driver.setEnabled(true);
    await flush();
    expect(session.active).toBe(true);
    driver.noteExternalInput();
    expect(session.active).toBe(false);
    vi.advanceTimersByTime(EYE_EXTERNAL_COOLDOWN_MS - 1000);
    await flush();
    expect(session.active).toBe(false);
    vi.advanceTimersByTime(1100);
    await flush();
    expect(session.active).toBe(true);
    // and a fresh full dwell is required before it moves the view again
    gazeFor(0.8, EYE_DWELL_MS - 100); session.emit(0.8);
    expect(adj().zoom).toBe(1);
  });

  it('a session that fails to start fails CLOSED: error surfaced, no retry loop, table untouched', async () => {
    session.failStart = true;
    const errors: unknown[] = [];
    const d2 = new EyeZoomDriver({ sessionFactory: () => session, onSessionError: (e) => errors.push(e) });
    d2.setCalibration(CAL);
    d2.setEnabled(true);
    await flush();
    expect(errors.length).toBe(1);
    vi.advanceTimersByTime(10000);
    await flush();
    expect(session.startCalls).toBe(1); // no spin
    expect(adj()).toEqual({ tilt: 5, zoom: 1 });
    d2.dispose();
  });

  it('disabling mid-ease closes the gesture at the resting zoom and stops the camera', async () => {
    driver.setEnabled(true);
    await flush();
    gazeFor(0.8, EYE_DWELL_MS); session.emit(0.8);
    vi.advanceTimersByTime(200);
    const mid = adj().zoom;
    driver.setEnabled(false);
    expect(session.active).toBe(false);
    expect(adj().zoom).toBeCloseTo(mid, 6);
    vi.advanceTimersByTime(2200); // the readout chip's linger expires
    expect(getViewAdjustState().adjusting).toBe(false);
  });
});

/* ------------------------------------------------------- camera probe */

describe('enableEyeCamera (the toggle-tap probe)', () => {
  const streamOf = () => {
    const stop = vi.fn();
    return { stream: { getTracks: () => [{ stop }] }, stop };
  };

  it('grants only after a real stream opens, and stops it again right away', async () => {
    const { stream, stop } = streamOf();
    const r = await enableEyeCamera({ mediaDevices: { getUserMedia: async () => stream } });
    expect(r).toBe('granted');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('denied is denied; a missing camera is absent; no API at all is absent', async () => {
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    await expect(enableEyeCamera({ mediaDevices: { getUserMedia: async () => { throw denied; } } })).resolves.toBe('denied');
    const missing = Object.assign(new Error('no'), { name: 'NotFoundError' });
    await expect(enableEyeCamera({ mediaDevices: { getUserMedia: async () => { throw missing; } } })).resolves.toBe('absent');
    await expect(enableEyeCamera({ mediaDevices: undefined })).resolves.toBe('absent');
    await expect(enableEyeCamera({ mediaDevices: {} })).resolves.toBe('absent');
  });
});

/* ------------------------------------------------------------ stores */

describe('eye zoom stores (seeded by the table from settings, like motion)', () => {
  beforeEach(() => { __resetEyeZoomStore(); });
  afterEach(() => { __resetEyeZoomStore(); });

  it('enabled + calibration mirrors round-trip', () => {
    expect(getEyeZoomEnabled()).toBe(false);
    seedEyeZoomEnabled(true);
    expect(getEyeZoomEnabled()).toBe(true);
    seedEyeZoomCalibration(CAL);
    expect(getEyeZoomCalibration()).toEqual(CAL);
    seedEyeZoomCalibration(null);
    expect(getEyeZoomCalibration()).toBeNull();
  });

  it('the calibration request flag is set by the row and cleared by the table', () => {
    expect(getEyeCalibrationRequested()).toBe(false);
    requestEyeCalibration();
    expect(getEyeCalibrationRequested()).toBe(true);
    clearEyeCalibrationRequest();
    expect(getEyeCalibrationRequested()).toBe(false);
  });

  it('the runtime note carries driver truth to the settings row', () => {
    expect(getEyeZoomNote()).toBeNull();
    setEyeZoomNote('Camera stopped.');
    expect(getEyeZoomNote()).toBe('Camera stopped.');
    setEyeZoomNote(null);
    expect(getEyeZoomNote()).toBeNull();
  });
});

/* ------------------------------------------------------ settings fields */

describe('settings (eyeZoom fields)', () => {
  it('default OFF with no calibration; junk normalizes away; a real pair persists', () => {
    expect(DEFAULT_SETTINGS.eyeZoom).toBe(false);
    expect(DEFAULT_SETTINGS.eyeZoomCal).toBeNull();
    expect(normalizeSettings({ eyeZoom: 'yes' as never }).eyeZoom).toBe(false);
    expect(normalizeSettings({ eyeZoom: true }).eyeZoom).toBe(true);
    expect(normalizeSettings({ eyeZoomCal: { cards: 'x', table: 0.4 } as never }).eyeZoomCal).toBeNull();
    expect(normalizeSettings({ eyeZoomCal: CAL }).eyeZoomCal).toEqual(CAL);
  });
});

/* --------------------------------------------------------- settings row */

describe('EyeZoomRow (the Settings toggle)', () => {
  let el: HTMLDivElement;
  let root: Root;

  function stubMatchMedia() {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: false, media: q,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {},
      }),
    });
  }

  async function renderRow(props: Record<string, unknown>) {
    stubMatchMedia();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root.render(createElement(EyeZoomRow, {
        value: false,
        calibrated: false,
        onChange: () => {},
        onCalibrate: () => {},
        enableFn: async () => 'granted' as const,
        ...props,
      }));
    });
    return el;
  }
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

  afterEach(async () => {
    fx.setReduce(false);
    __resetEyeZoomStore();
    if (root) await act(async () => { root.unmount(); });
    el?.remove();
  });

  it('the privacy line is on the row: the reading never leaves the phone', async () => {
    const c = await renderRow({});
    expect(c.textContent).toContain('Eye zoom');
    expect(c.textContent).toContain('never leaves your phone');
  });

  it('turning it on runs the camera probe first; a grant flips it on', async () => {
    const onChange = vi.fn();
    const c = await renderRow({ onChange });
    const sw = c.querySelector('[data-testid="eye-zoom"]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('a denial keeps it OFF and says so in plain words', async () => {
    const onChange = vi.fn();
    const c = await renderRow({ onChange, enableFn: async () => 'denied' as const });
    const sw = c.querySelector('[data-testid="eye-zoom"]') as HTMLButtonElement;
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(c.textContent).toContain('denied');
  });

  it('a missing camera keeps it OFF and says so in plain words', async () => {
    const onChange = vi.fn();
    const c = await renderRow({ onChange, enableFn: async () => 'absent' as const });
    const sw = c.querySelector('[data-testid="eye-zoom"]') as HTMLButtonElement;
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(c.textContent).toContain('No camera');
  });

  it('on but uncalibrated: a needs-calibration note and a Calibrate button', async () => {
    const onCalibrate = vi.fn();
    const c = await renderRow({ value: true, calibrated: false, onCalibrate });
    expect(c.textContent).toContain('calibrat');
    const btn = c.querySelector('[data-testid="eye-zoom-calibrate"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => { btn.click(); });
    expect(onCalibrate).toHaveBeenCalledTimes(1);
  });

  it('on and calibrated: the button reads Recalibrate; a driver note shows on the row', async () => {
    const c = await renderRow({ value: true, calibrated: true });
    const btn = c.querySelector('[data-testid="eye-zoom-calibrate"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Recalibrate');
    await act(async () => { setEyeZoomNote('Camera stopped — Eye zoom is resting.'); });
    expect(c.textContent).toContain('Camera stopped');
  });

  it('turning it OFF is immediate and never probes the camera', async () => {
    const onChange = vi.fn();
    const enableFn = vi.fn(async () => 'granted' as const);
    const c = await renderRow({ value: true, calibrated: true, onChange, enableFn });
    const sw = c.querySelector('[data-testid="eye-zoom"]') as HTMLButtonElement;
    await act(async () => { sw.click(); });
    expect(onChange).toHaveBeenCalledWith(false);
    expect(enableFn).not.toHaveBeenCalled();
  });

  it('Reduce effects on: the toggle cannot be switched on, with the same plain note as Motion view', async () => {
    fx.setReduce(true);
    const onChange = vi.fn();
    const c = await renderRow({ onChange });
    const sw = c.querySelector('[data-testid="eye-zoom"]') as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(c.textContent).toContain('Reduce effects');
    await act(async () => { sw.click(); });
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------- calibration overlay */

describe('EyeZoomCalibrate (two looks over the table)', () => {
  let el: HTMLDivElement;
  let root: Root;
  let session: FakeSession;

  async function renderCal(props: Record<string, unknown>) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root.render(createElement(EyeZoomCalibrate, {
        onCalibrated: () => {},
        onClose: () => {},
        sessionFactory: () => session,
        ...props,
      }));
    });
    return el;
  }
  /** Run one full capture step: 1 s of readings at 10 Hz. */
  const runStep = async (gazeV: number | null) => {
    for (let i = 0; i < 11; i++) {
      await act(async () => { vi.advanceTimersByTime(100); session.emit(gazeV); });
    }
  };

  beforeEach(() => { vi.useFakeTimers(); session = new FakeSession(); });
  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    el?.remove();
    vi.useRealTimers();
  });

  it('walks both steps and hands back the computed calibration', async () => {
    const onCalibrated = vi.fn();
    const c = await renderCal({ onCalibrated });
    expect(session.startCalls).toBe(1);
    expect(c.querySelector('[data-testid="eye-cal-step"]')!.textContent).toContain('Look at your cards');
    await runStep(0.8);
    expect(c.querySelector('[data-testid="eye-cal-step"]')!.textContent).toContain('Look at the table');
    await runStep(0.4);
    expect(onCalibrated).toHaveBeenCalledWith({ cards: 0.8, table: 0.4 });
    expect(c.querySelector('[data-testid="eye-cal-done"]')).not.toBeNull();
    expect(session.active).toBe(false); // camera released once captured
  });

  it('too few readable samples is an error with a retry, never a silent bad calibration', async () => {
    const onCalibrated = vi.fn();
    const c = await renderCal({ onCalibrated });
    await runStep(null); // face never readable
    expect(onCalibrated).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="eye-cal-retry"]')).not.toBeNull();
    await act(async () => { (c.querySelector('[data-testid="eye-cal-retry"]') as HTMLButtonElement).click(); });
    expect(c.querySelector('[data-testid="eye-cal-step"]')!.textContent).toContain('Look at your cards');
    await runStep(0.8);
    await runStep(0.4);
    expect(onCalibrated).toHaveBeenCalledWith({ cards: 0.8, table: 0.4 });
  });

  it('cancel closes without calibrating and stops the camera', async () => {
    const onCalibrated = vi.fn();
    const onClose = vi.fn();
    const c = await renderCal({ onCalibrated, onClose });
    await act(async () => { (c.querySelector('[data-testid="eye-cal-cancel"]') as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCalibrated).not.toHaveBeenCalled();
    expect(session.active).toBe(false);
  });
});
