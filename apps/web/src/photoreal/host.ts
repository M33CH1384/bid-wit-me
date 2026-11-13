/**
 * Photoreal canvas overlays (owner-approved draft, 2026-11-02): Motion Director's final v2 modules
 * (lightning / meteor / quake / goldrain, + the 2D nuke as the iPhone Safari fallback) drawn on a
 * transparent canvas above the 3D table, on the EXISTING effect triggers. Everything that already
 * plays for those triggers (sound + ducking, pop-ups, CSS, camera shake, Nuke3D on desktop) keeps
 * playing — the overlay only adds the picture, so a module that fails to load leaves the old effect.
 *
 * Fit: every overlay is anchored from the live table on screen (window.__bwmLayout.table,
 * the felt + rail projected with the 3D camera by Scene's LayoutProbe): ground zero and the
 * table radii are passed to the module in true screen pixels, and the canvas itself covers
 * the full mount box, so the modules' full-canvas paints (lightning's pre-strike dim,
 * meteor's fade, quake's wash) wash edge to edge in every orientation. The canvas used to
 * be CSS-scaled about ground zero by the fit ratio k — in landscape k < 1, and those paints
 * shrank with it into a bounded rectangle over the table (owner, 2026-11-05). Only the nuke
 * keeps a world-scale: k × NUKE_ENGULF, so the cap engulfs the table; its k is > 1 by
 * construction, so its paints already covered the screen.
 *
 * Lazy: this file and the modules load from Scene's AfterTable (idle, after the felt is up); nothing
 * here is in the first script. Reduce effects → no overlays (and the nuke follows the nuke mode).
 * iPhone defaults to the low-power profile: the modules' lowPower particle cut and a 0.6× backing store.
 */
import { advancePresentedClock, fx, type FxEvent } from '../fx';
import { sound } from '../audio';
import { currentNukeDevice, isIosWebKit } from '../three/nukeVisual';
import { importChunk } from '../chunkLoad';
import { loadSettings } from '../settings';
import { reportCrash } from '../telemetry';
import { createFxRunner, prepareFxInstance, type FxRunner, type FxRunnerDeps, type PreparedFx } from './runner';
import type { PhotorealFxInstance, PhotorealFxOpts } from './modules/modules';

export type PhotorealName = 'lightning' | 'meteor' | 'quake' | 'whip' | 'goldrain' | 'nuke';
type Mod = { createFx(c: HTMLCanvasElement, o?: PhotorealFxOpts): PhotorealFxInstance };
const LOAD: Record<PhotorealName, () => Promise<Mod>> = {
  lightning: () => import('./modules/lightning.js') as Promise<Mod>,
  meteor: () => import('./modules/meteor.js') as Promise<Mod>,
  quake: () => import('./modules/quake.js') as Promise<Mod>,
  whip: () => import('./modules/whip.js') as Promise<Mod>,
  goldrain: () => import('./modules/goldrain.js') as Promise<Mod>,
  nuke: () => import('./modules/nuke.js') as Promise<Mod>,
};

/** iPhone low-power backing-store scale (× min(dpr, 2)). */
export const IPHONE_RENDER_SCALE = 0.6;
/** The nuke's extra scale over the table fit, so the mushroom cap engulfs the table. */
export const NUKE_ENGULF = 1.9;
/** Module ground-zero time of the nuke flash (nuke.js T0): the card sweep + Full-mode HUD blow fire here. */
const NUKE_FLASH_T = 0.28;
/** Module time (s, presented clock) at which the quake's table cracks get
 * their fracture sound: quake.js grows its cracks from the table
 * centre with first-point times t0 = .45 + rr()*.25, so the fracture
 * opens across .45–.70 s of module time. The recorded glassCrack (the
 * plate crack's cue, 87bcbba4) fires once as presented T crosses this
 * point — inside the opening beat on every seed, and on the presented
 * clock so a stalled frame stretches the picture and its sound
 * together. Change it only with quake.js's t0. */
export const QUAKE_CRACK_T = 0.55;
/** Fracture-sound gain by Big Joker crack tier (2026-11-06), indexed by
 * tier − 1: LIGHT / STANDARD / HEAVY / MAX. STANDARD's 1.1 is the lift
 * the original binding shipped with; the tier moves the gain, never
 * the sync point and never the recording. */
export const QUAKE_CRACK_GAIN = [0.85, 1.1, 1.3, 1.35];
/** MAX tier only: the presented time at which the recording fires once
 * more, low — its own crumble-settle, as the fracture crawl finishes
 * (crack fronts run from t0 ≈ .45–.70 s outward for ~2 s of module
 * time). Same gates as the fracture fire: live runs, presented clock,
 * once per instance. */
export const QUAKE_SETTLE_T = 1.75;
/** The Whip-Crack's snap point (module s, presented clock): whip.js
 * starts its single stroke at t0 ≈ .06–.10 and lands it in ~.34 s, so
 * the front is mid-table as presented T crosses this point. The cue is
 * the SAME glassCrack recording as the quake's fracture, presented as
 * a snap instead of a shatter: under the quake's STANDARD gain and
 * pitched up (rate), which also shortens it. Change it only with
 * whip.js's stroke. */
export const WHIP_SNAP_T = 0.18;
export const WHIP_SNAP_GAIN = 0.9;
export const WHIP_SNAP_RATE = 1.35;

/** iPhone / iPad Safari: the 2D nuke replaces Nuke3D. `bwm.fx.nuke2d` = '1' forces it anywhere (QA / captures). */
export function nuke2D(): boolean {
  try { if (localStorage.getItem('bwm.fx.nuke2d') === '1') return true; } catch { /* no storage */ }
  return isIosWebKit(currentNukeDevice());
}

/** Which overlay an effect event gets (null = none). The trigger map, in one place. */
export function photorealFor(e: Pick<FxEvent, 'kind' | 'level'>): PhotorealName | null {
  switch (e.kind) {
    case 'jokerBig': return 'quake'; // Big Joker landing rumble
    case 'jokerWhip': return 'whip'; // Little Joker throw (the whip gate lives in landCue: never a steal, never a nuked trick)
    case 'overcut': return (e.level ?? 2) >= 3 ? 'lightning' : null; // the big over-cut (overcut3)
    case 'shot': return 'meteor'; // SHOT!
    case 'wheelsRain': return 'goldrain'; // Wheels EARNED: the declaring side's books reached the contract (the rain left the bid call — owner, 2026-11-05)
    case 'nuke': case 'mega': return nuke2D() && fx.nukeMode !== 'off' ? 'nuke' : null;
    default: return null;
  }
}

interface TableBox { cx: number; cy: number; x0: number; x1: number; y0: number; y1: number }
interface Layout { w?: number; h?: number; table?: TableBox; trick?: { x: number; y: number; w: number; h: number }[] }
const layout = (): Layout | null => (window as unknown as { __bwmLayout?: Layout }).__bwmLayout ?? null;

/** Table fit for one overlay in mount CSS px: ground zero, the true table radii, and the fit
 *  ratio k — now consumed only by the nuke's world-scale (see overlayPlacement). Pure (tests). */
export function fitToTable(name: PhotorealName, W: number, H: number, L: Layout | null): { gx: number; gy: number; rx: number; ry: number; k: number } {
  const t = L?.table;
  const rx = t ? (t.x1 - t.x0) / 2 : W * 0.42, ry = t ? (t.y1 - t.y0) / 2 : rx * 0.42;
  let gx = t ? t.cx : W / 2, gy = t ? t.cy : H * 0.5;
  const tr = L?.trick ?? [];
  if ((name === 'lightning' || name === 'meteor') && tr.length) { // strikes land on the trick in the middle
    gx = tr.reduce((a, r) => a + r.x + r.w / 2, 0) / tr.length; gy = tr.reduce((a, r) => a + r.y + r.h / 2, 0) / tr.length;
  }
  const S = Math.min(W, H), moduleRx = Math.min(W * 0.46, S * 0.95);
  let k = Math.min(1.8, Math.max(0.6, rx / moduleRx));
  if (name === 'nuke') k *= NUKE_ENGULF;
  return { gx, gy, rx, ry, k };
}

export interface OverlayPlacement { gx: number; gy: number; drawRx: number; drawRy: number; scale: number }

/**
 * How one overlay is placed: ground zero, the table radii the module
 * draws at (CSS px, before the backing-store scale), and the CSS scale
 * on the canvas element. Pure (tests).
 *
 * Non-nuke overlays are NOT css-scaled (scale 1) and draw at the true
 * table radii: their table-anchored art (cracks, the strike point,
 * the crater) lands exactly where it landed under the old fit
 * transform, while their full-canvas dim/flash paints cover the full
 * viewport instead of shrinking into the fit rectangle. The nuke
 * alone keeps its world-scale — NUKE_ENGULF is the effect — with its
 * draw radii compensated by that scale, exactly as before.
 */
export function overlayPlacement(name: PhotorealName, W: number, H: number, L: Layout | null): OverlayPlacement {
  const f = fitToTable(name, W, H, L);
  if (name === 'nuke') return { gx: f.gx, gy: f.gy, drawRx: f.rx / f.k, drawRy: f.ry / f.k, scale: f.k };
  return { gx: f.gx, gy: f.gy, drawRx: f.rx, drawRy: f.ry, scale: 1 };
}

let seed = 1;
/**
 * Every photoreal module load goes through the OPTIONAL chunk path
 * (crash hardening, 2026-11-06): these modules are pure decoration —
 * a stale one after a deploy is skipped (the callers' rejection
 * handlers already treat a failed load as "the effect doesn't play"),
 * never a reason to reload a live match. The raw LOAD table stays the
 * single source of the import specifiers.
 */
function loadModule(name: PhotorealName): Promise<Mod> {
  return importChunk(() => LOAD[name](), { optional: `photoreal-${name}` }) as Promise<Mod>;
}

/**
 * Lifecycle + preparation state (crash hardening, 2026-11-06). Each
 * effect name owns one FxRunner (photoreal/runner.ts), which contains
 * every load/construction/render failure and guarantees cleanup. The
 * `running` map of bare stop functions this replaces had three holes:
 * a createFx throw escaped the load callback (orphan canvas, unhandled
 * rejection), a render throw killed the frame chain silently (stuck
 * overlay, stale running flag), and a load resolving after the screen
 * unmounted started an effect on a dead screen.
 *
 * PREPARATION: modules build their procedural sprites synchronously in
 * createFx — for the nuke that is 43 canvases and tens of ms of pixel
 * work at the exact moment the effect should already be on screen.
 * warmPhotoreal/startPhotoreal now also PRE-BUILD one instance per
 * effect on an idle slot (its seed is simply the next one from the
 * host counter, so per-play variety is unchanged), and playPhotoreal
 * adopts it synchronously when the placement signature matches. A
 * signature miss or an absent prep falls back to constructing at play
 * time, exactly as before. goldrain is excluded: it builds no sprites
 * (its construction is a few ms of grain fill), so there is nothing
 * worth pre-building.
 */
let hostEpoch = 0;
let lastMount: HTMLElement | null = null;
const runners = new Map<PhotorealName, FxRunner>();
const preps = new Map<PhotorealName, { sig: string; fx: PreparedFx }>();
const prepPending = new Set<PhotorealName>();
const PREPPABLE: readonly PhotorealName[] = ['nuke', 'quake', 'meteor', 'lightning'];

function setProbe(name: PhotorealName, on: boolean): void {
  const w = window as unknown as { __bwmPhotoreal?: Record<string, unknown> };
  (w.__bwmPhotoreal ??= {})[name] = on;
}

function depsFor(name: PhotorealName): FxRunnerDeps {
  return {
    load: () => loadModule(name),
    createCanvas: () => document.createElement('canvas'),
    raf: (fn) => requestAnimationFrame(fn),
    cancelRaf: (id) => cancelAnimationFrame(id),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    addSkipListener: (fn) => window.addEventListener('pointerdown', fn, { once: true }),
    removeSkipListener: (fn) => window.removeEventListener('pointerdown', fn),
    report: (stage, err) => reportCrash('error', err, { effect: `photoreal-${name}`, stage }),
    epoch: () => hostEpoch,
    advance: advancePresentedClock,
  };
}

function runnerFor(name: PhotorealName): FxRunner {
  let r = runners.get(name);
  if (!r) { r = createFxRunner(depsFor(name)); runners.set(name, r); }
  return r;
}

interface FxPlacement {
  W: number; H: number; pr: number; low: boolean;
  gx: number; gy: number; drawRx: number; drawRy: number; scale: number;
  sig: string;
}

function placementFor(name: PhotorealName, mount: HTMLElement): FxPlacement | null {
  const box = mount.getBoundingClientRect();
  const W = box.width, H = box.height;
  if (W < 32 || H < 32) return null;
  const ios = isIosWebKit(currentNukeDevice());
  const low = ios || loadSettings().quality === 'low';
  const pr = Math.min(window.devicePixelRatio || 1, 2) * (ios ? IPHONE_RENDER_SCALE : 1);
  const p = overlayPlacement(name, W, H, layout());
  const sig = [name, low ? 'l' : 'f', Math.round(W * pr), Math.round(H * pr), p.gx.toFixed(1), p.gy.toFixed(1), p.drawRx.toFixed(1), p.drawRy.toFixed(1), p.scale].join('|');
  return { W, H, pr, low, gx: p.gx, gy: p.gy, drawRx: p.drawRx, drawRy: p.drawRy, scale: p.scale, sig };
}

function stylePhotorealCanvas(name: PhotorealName, pl: FxPlacement, c: HTMLCanvasElement): void {
  c.className = `photoreal-fx photoreal-${name}`;
  c.dataset.testid = `photoreal-${name}`;
  c.width = Math.round(pl.W * pl.pr); c.height = Math.round(pl.H * pl.pr);
  // Sized as a share of the mount, never in fixed px: if the window is resized or rotated while the effect
  // plays, the canvas keeps covering the whole mount (stretching its picture with it) instead of staying a
  // box of the old size with the screen showing round its dark wash (owner, 2026-11-12: the screen crack
  // "doesnt cover the screen" after a resize). The nuke's zoom origin is a share of the box for the same reason.
  Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '4', ...(pl.scale !== 1 ? { transformOrigin: `${(pl.gx / pl.W) * 100}% ${(pl.gy / pl.H) * 100}%`, transform: `scale(${pl.scale})` } : {}) });
}

function createOpts(pl: FxPlacement, power = 2): PhotorealFxOpts {
  return { seed: seed++, lowPower: pl.low, x: pl.gx * pl.pr, y: pl.gy * pl.pr, tableRx: pl.drawRx * pl.pr, tableRy: pl.drawRy * pl.pr, power };
}

function takePrep(name: PhotorealName, sig: string): PreparedFx | null {
  const p = preps.get(name);
  if (!p) return null;
  preps.delete(name);
  return p.sig === sig ? p.fx : null; // stale placement: drop it, construct fresh
}

/** Build the next instance of an effect ahead of its moment, on an idle slot. */
function schedulePrep(name: PhotorealName): void {
  if (!PREPPABLE.includes(name)) return;
  if (preps.has(name) || prepPending.has(name)) return;
  const mount = lastMount;
  if (!mount || !mount.isConnected) return;
  const pl = placementFor(name, mount);
  if (!pl) return;
  prepPending.add(name);
  const epochAt = hostEpoch;
  const build = () => {
    void prepareFxInstance(depsFor(name), (c) => stylePhotorealCanvas(name, pl, c), createOpts(pl)).then((fx) => {
      prepPending.delete(name);
      if (!fx) return;
      if (hostEpoch !== epochAt || lastMount !== mount) return; // the screen moved on: drop it
      preps.set(name, { sig: pl.sig, fx });
    });
  };
  const ric = (window as unknown as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(build, { timeout: 1500 }); else window.setTimeout(build, 60);
}

const warmed = new Set<PhotorealName>();
/**
 * Start loading an overlay module BEFORE its moment (nuked-trick freeze fix,
 * 2026-11-05): the load-time warm pass covers the 3D blast, but on the iOS
 * path the blast IS this 2D module, and it used to cold-import at detonation
 * — inside the beat it was supposed to be filling. The browser's module map
 * makes the play-time import near-free once the module has loaded; this just
 * moves WHEN it loads. Fire-and-forget, once per name.
 */
export function warmPhotoreal(name: PhotorealName): void {
  if (warmed.has(name)) return;
  warmed.add(name);
  // Once the module is in, also pre-build its instance off-beat (see
  // schedulePrep) so the construction cost lands here, not at play time.
  void loadModule(name).then(() => { schedulePrep(name); }, () => { warmed.delete(name); });
}

export function playPhotoreal(mount: HTMLElement, name: PhotorealName, opts: { at?: number; mega?: boolean; full?: boolean; power?: number } = {}): void {
  lastMount = mount;
  const pl = placementFor(name, mount);
  if (!pl) return;
  const runner = runnerFor(name);
  // the quake's degree of fracture (Big Joker crack tier, 2026-11-06);
  // other modules ignore the opt. Absent = STANDARD, today's quake.
  const power = Math.min(4, Math.max(1, Math.round(opts.power ?? 2)));
  // A pre-built instance is always STANDARD power: any other tier constructs at play.
  const prep = power === 2 ? takePrep(name, pl.sig) : (preps.delete(name), null);
  let flashed = false, cracked = false, settled = false, first = true;
  const live = opts.at === undefined;
  runner.play({
    mount,
    opts: createOpts(pl, power),
    prepared: prep,
    styleCanvas: (c) => stylePhotorealCanvas(name, pl, c),
    pinnedAt: opts.at,
    skipDelayMs: live && name === 'nuke' ? 400 : undefined,
    onBegin: () => setProbe(name, true),
    onFrame: (T) => {
      if (name === 'nuke') {
        if (first) { first = false; if (opts.at === undefined) fx.heroPresented(); }
        fx.nukeT = T;
        if (!flashed && T >= NUKE_FLASH_T) {
          flashed = true;
          fx.blast = { start: performance.now(), hand: !!opts.full, ...(opts.mega ? { mega: true as const } : {}) };
          if (opts.full && opts.at === undefined) void importChunk(() => import('../three/Nuke3D'), { optional: 'nuke3d' }).then((m) => m.blowHud(), () => {});
        }
      }
      // the quake's cracks fracture audibly as they open (QUAKE_CRACK_T);
      // live runs only — a pinned capture frame stays silent, like the
      // rest of the preview hook. The gain follows the crack tier
      // (QUAKE_CRACK_GAIN): STANDARD's 1.1 is the bigger-beat lift this
      // binding shipped with — this crack spans the table, not a plate
      // (effective .85 x 1.1 staging, spectrally clear of the synth
      // rumble it layers over).
      if (name === 'quake' && !cracked && opts.at === undefined && T >= QUAKE_CRACK_T) {
        cracked = true;
        try { sound.play('glassCrack', { gain: QUAKE_CRACK_GAIN[power - 1] }); } catch { /* audio never blocks the picture */ }
      }
      // MAX tier only: as the fracture finishes crawling, the recording
      // plays once more, low — its own crumble-settle under the
      // completed crack field (and, on a nuked trick, under the blast).
      if (name === 'quake' && power === 4 && !settled && opts.at === undefined && T >= QUAKE_SETTLE_T) {
        settled = true;
        try { sound.play('glassCrack', { gain: 0.55 }); } catch { /* audio never blocks the picture */ }
      }
      // the whip's snap: the single stroke strikes almost at once, so
      // the recording fires as presented T crosses WHIP_SNAP_T — under
      // the quake's gain and pitched up (WHIP_SNAP_RATE), a snap
      // instead of a shatter. Same gates as the fracture fire: live
      // runs only, presented clock, once per instance.
      if (name === 'whip' && !cracked && opts.at === undefined && T >= WHIP_SNAP_T) {
        cracked = true;
        try { sound.play('glassCrack', { gain: WHIP_SNAP_GAIN, rate: WHIP_SNAP_RATE }); } catch { /* audio never blocks the picture */ }
      }
    },
    onStop: () => {
      if (name === 'nuke') { fx.blast = null; fx.nukeT = null; }
      setProbe(name, false);
      schedulePrep(name); // build the next activation's instance off-beat
    },
  });
}

/** Start listening for effect events; returns the unsubscribe (also stops anything running). */
export function startPhotoreal(mount: HTMLElement): () => void {
  lastMount = mount;
  // The table is up: pre-build the sprite-heavy instances on idle slots
  // so their construction never lands inside a live beat.
  for (const n of PREPPABLE) schedulePrep(n);
  const off = fx.on((e) => {
    if (fx.reduced) return; // Reduce effects: the existing calm versions only
    const name = photorealFor(e);
    if (!name) return;
    if (fx.osReducedMotion && name !== 'goldrain' && name !== 'nuke') return; // OS reduce motion: no strobing/shaking overlays (the nuke still plays, as Nuke3D does)
    playPhotoreal(mount, name, { mega: e.kind === 'mega', full: fx.nukeMode === 'full', ...(name === 'quake' ? { power: e.level ?? 2 } : {}) });
  });
  // capture / QA hook: draw one effect pinned at time t (no sound, no game state)
  (window as unknown as { __bwmPhotorealPreview?: unknown }).__bwmPhotorealPreview = (name: PhotorealName, t: number) => playPhotoreal(mount, name, { at: t });
  return () => {
    off();
    // Invalidate everything in flight BEFORE stopping the runners (their
    // onStop prep scheduling must see the mount already gone), then run
    // every cleanup: frames, timers, skip listeners, overlays, probes.
    hostEpoch++;
    lastMount = null;
    runners.forEach((r) => r.stop());
    runners.clear();
    preps.clear();
  };
}
