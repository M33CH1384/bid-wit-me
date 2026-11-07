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
const running = new Map<PhotorealName, () => void>();

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
  void LOAD[name]().then(() => {}, () => { warmed.delete(name); });
}

export function playPhotoreal(mount: HTMLElement, name: PhotorealName, opts: { at?: number; mega?: boolean; full?: boolean; power?: number } = {}): void {
  void LOAD[name]().then((mod) => {
    running.get(name)?.();
    const box = mount.getBoundingClientRect();
    const W = box.width, H = box.height;
    if (W < 32 || H < 32) return;
    const ios = isIosWebKit(currentNukeDevice());
    const low = ios || loadSettings().quality === 'low';
    const pr = Math.min(window.devicePixelRatio || 1, 2) * (ios ? IPHONE_RENDER_SCALE : 1);
    const p = overlayPlacement(name, W, H, layout());
    const c = document.createElement('canvas');
    c.className = `photoreal-fx photoreal-${name}`;
    c.dataset.testid = `photoreal-${name}`;
    c.width = Math.round(W * pr); c.height = Math.round(H * pr);
    Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${H}px`, pointerEvents: 'none', zIndex: '4', ...(p.scale !== 1 ? { transformOrigin: `${p.gx}px ${p.gy}px`, transform: `scale(${p.scale})` } : {}) });
    mount.appendChild(c);
    // the quake's degree of fracture (Big Joker crack tier, 2026-11-06);
    // other modules ignore the opt. Absent = STANDARD, today's quake.
    const power = Math.min(4, Math.max(1, Math.round(opts.power ?? 2)));
    const inst = mod.createFx(c, { seed: seed++, lowPower: low, x: p.gx * pr, y: p.gy * pr, tableRx: p.drawRx * pr, tableRy: p.drawRy * pr, power });
    let raf = 0, T = 0, last: number | null = null, flashed = false, cracked = false, settled = false, first = true, done = false;
    const stop = () => {
      if (done) return; done = true; cancelAnimationFrame(raf); c.remove(); running.delete(name);
      if (name === 'nuke') { fx.blast = null; fx.nukeT = null; }
      (window as unknown as { __bwmPhotoreal?: Record<string, unknown> }).__bwmPhotoreal![name] = false;
    };
    running.set(name, stop);
    (window as unknown as { __bwmPhotoreal?: Record<string, unknown> }).__bwmPhotoreal ??= {};
    (window as unknown as { __bwmPhotoreal: Record<string, unknown> }).__bwmPhotoreal[name] = true;
    const frame = (now: number) => {
      // presented-time clock (a stalled frame stretches the show instead of skipping it), or a pinned capture time
      if (opts.at !== undefined) T = opts.at; else { const a = advancePresentedClock(T, last, now); T = a.t; last = a.last; }
      inst.render(Math.min(T, inst.duration - 1e-3));
      if (name === 'nuke') {
        if (first) { first = false; if (opts.at === undefined) fx.heroPresented(); }
        fx.nukeT = T;
        if (!flashed && T >= NUKE_FLASH_T) {
          flashed = true;
          fx.blast = { start: performance.now(), hand: !!opts.full, ...(opts.mega ? { mega: true as const } : {}) };
          if (opts.full && opts.at === undefined) void importChunk(() => import('../three/Nuke3D')).then((m) => m.blowHud(), () => {});
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
      if (opts.at !== undefined) return; // a pinned capture frame stays up until the next call
      if (T >= inst.duration) { stop(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    if (opts.at === undefined) {
      // tap anywhere skips the nuke, like Nuke3D
      if (name === 'nuke') window.setTimeout(() => window.addEventListener('pointerdown', stop, { once: true }), 400);
      window.setTimeout(stop, inst.duration * 1000 + 6000); // backstop
    }
  }, () => { /* module failed to load: the existing effect already played */ });
}

/** Start listening for effect events; returns the unsubscribe (also stops anything running). */
export function startPhotoreal(mount: HTMLElement): () => void {
  const off = fx.on((e) => {
    if (fx.reduced) return; // Reduce effects: the existing calm versions only
    const name = photorealFor(e);
    if (!name) return;
    if (fx.osReducedMotion && name !== 'goldrain' && name !== 'nuke') return; // OS reduce motion: no strobing/shaking overlays (the nuke still plays, as Nuke3D does)
    playPhotoreal(mount, name, { mega: e.kind === 'mega', full: fx.nukeMode === 'full', ...(name === 'quake' ? { power: e.level ?? 2 } : {}) });
  });
  // capture / QA hook: draw one effect pinned at time t (no sound, no game state)
  (window as unknown as { __bwmPhotorealPreview?: unknown }).__bwmPhotorealPreview = (name: PhotorealName, t: number) => playPhotoreal(mount, name, { at: t });
  return () => { off(); running.forEach((s) => s()); };
}
