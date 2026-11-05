/**
 * Photoreal canvas overlays (owner-approved draft, 2026-11-02): Motion Director's final v2 modules
 * (lightning / meteor / quake / goldrain, + the 2D nuke as the iPhone Safari fallback) drawn on a
 * transparent canvas above the 3D table, on the EXISTING effect triggers. Everything that already
 * plays for those triggers (sound + ducking, pop-ups, CSS, camera shake, Nuke3D on desktop) keeps
 * playing — the overlay only adds the picture, so a module that fails to load leaves the old effect.
 *
 * Fit: every overlay is anchored and scaled from the live table on screen (window.__bwmLayout.table,
 * the felt + rail projected with the 3D camera by Scene's LayoutProbe), never a fixed overlay. The
 * modules size themselves from min(canvas W, H) and assume a table ≈ 0.92 W wide, so the canvas is
 * CSS-scaled about ground zero by k = (real table half-width) / (module table half-width); the nuke
 * goes a further NUKE_ENGULF so the cap engulfs the table.
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

export type PhotorealName = 'lightning' | 'meteor' | 'quake' | 'goldrain' | 'nuke';
type Mod = { createFx(c: HTMLCanvasElement, o?: PhotorealFxOpts): PhotorealFxInstance };
const LOAD: Record<PhotorealName, () => Promise<Mod>> = {
  lightning: () => import('./modules/lightning.js') as Promise<Mod>,
  meteor: () => import('./modules/meteor.js') as Promise<Mod>,
  quake: () => import('./modules/quake.js') as Promise<Mod>,
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
 * their fracture sound: quake.js grows its five cracks from the table
 * centre with first-point times t0 = .45 + rr()*.25, so the fracture
 * opens across .45–.70 s of module time. The recorded glassCrack (the
 * plate crack's cue, 87bcbba4) fires once as presented T crosses this
 * point — inside the opening beat on every seed, and on the presented
 * clock so a stalled frame stretches the picture and its sound
 * together. Change it only with quake.js's t0. */
export const QUAKE_CRACK_T = 0.55;

/** iPhone / iPad Safari: the 2D nuke replaces Nuke3D. `bwm.fx.nuke2d` = '1' forces it anywhere (QA / captures). */
export function nuke2D(): boolean {
  try { if (localStorage.getItem('bwm.fx.nuke2d') === '1') return true; } catch { /* no storage */ }
  return isIosWebKit(currentNukeDevice());
}

/** Which overlay an effect event gets (null = none). The trigger map, in one place. */
export function photorealFor(e: Pick<FxEvent, 'kind' | 'level'>): PhotorealName | null {
  switch (e.kind) {
    case 'jokerBig': return 'quake'; // Big Joker landing rumble
    case 'overcut': return (e.level ?? 2) >= 3 ? 'lightning' : null; // the big over-cut (overcut3)
    case 'shot': return 'meteor'; // SHOT!
    case 'wheels': return 'goldrain'; // Wheels (10 books)
    case 'nuke': case 'mega': return nuke2D() && fx.nukeMode !== 'off' ? 'nuke' : null;
    default: return null;
  }
}

interface TableBox { cx: number; cy: number; x0: number; x1: number; y0: number; y1: number }
interface Layout { w?: number; h?: number; table?: TableBox; trick?: { x: number; y: number; w: number; h: number }[] }
const layout = (): Layout | null => (window as unknown as { __bwmLayout?: Layout }).__bwmLayout ?? null;

/** Placement for one overlay in mount CSS px: ground zero, table radii, and the CSS scale k. Pure (tests). */
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

let seed = 1;
const running = new Map<PhotorealName, () => void>();

export function playPhotoreal(mount: HTMLElement, name: PhotorealName, opts: { at?: number; mega?: boolean; full?: boolean } = {}): void {
  void LOAD[name]().then((mod) => {
    running.get(name)?.();
    const box = mount.getBoundingClientRect();
    const W = box.width, H = box.height;
    if (W < 32 || H < 32) return;
    const ios = isIosWebKit(currentNukeDevice());
    const low = ios || loadSettings().quality === 'low';
    const pr = Math.min(window.devicePixelRatio || 1, 2) * (ios ? IPHONE_RENDER_SCALE : 1);
    const f = fitToTable(name, W, H, layout());
    const c = document.createElement('canvas');
    c.className = `photoreal-fx photoreal-${name}`;
    c.dataset.testid = `photoreal-${name}`;
    c.width = Math.round(W * pr); c.height = Math.round(H * pr);
    Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${H}px`, pointerEvents: 'none', zIndex: '4', transformOrigin: `${f.gx}px ${f.gy}px`, transform: `scale(${f.k})` });
    mount.appendChild(c);
    const inst = mod.createFx(c, { seed: seed++, lowPower: low, x: f.gx * pr, y: f.gy * pr, tableRx: (f.rx / f.k) * pr, tableRy: (f.ry / f.k) * pr });
    let raf = 0, T = 0, last: number | null = null, flashed = false, cracked = false, first = true, done = false;
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
      // rest of the preview hook. The 1.1 gain is the bigger-beat lift:
      // this crack spans the table, not a plate (effective .85 x 1.1
      // staging, spectrally clear of the synth rumble it layers over).
      if (name === 'quake' && !cracked && opts.at === undefined && T >= QUAKE_CRACK_T) {
        cracked = true;
        try { sound.play('glassCrack', { gain: 1.1 }); } catch { /* audio never blocks the picture */ }
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
    playPhotoreal(mount, name, { mega: e.kind === 'mega', full: fx.nukeMode === 'full' });
  });
  // capture / QA hook: draw one effect pinned at time t (no sound, no game state)
  (window as unknown as { __bwmPhotorealPreview?: unknown }).__bwmPhotorealPreview = (name: PhotorealName, t: number) => playPhotoreal(mount, name, { at: t });
  return () => { off(); running.forEach((s) => s()); };
}
