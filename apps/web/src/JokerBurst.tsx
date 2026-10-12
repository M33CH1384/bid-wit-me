import { useEffect, useRef } from 'react';
import { fx } from './fx';
import { HAPTIC, cancelHaptics, haptic } from './haptics';
import { BURST_MS, advanceBurst, clearBurst, getBurst, startBurst, subscribeBurst } from './jokerFx';
import {
  BLAST_MS, bannerPose, canvasOwnsBlast, createBlast, dprCap, drawBlast, noteFrame, resetBlast, shakeOffset, stepBlast, warmBlast,
  type Blast,
} from './nukeBlast';

/** Fallback 3D blast length. Matches Nuke3D's NUKE_LEN without importing that module. */
const NUKE3D_MS = 3600;

/**
 * Detonation clock. When a 2D canvas is available the blast is drawn there (worker when the
 * browser can hand it an OffscreenCanvas). Otherwise Nuke3D plays, including the iOS cheap path.
 * The shake is the whole screen, HUD included. t = 0 is the haptic.
 */
export default function JokerBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blastRef = useRef<Blast | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const modeRef = useRef<'worker' | 'main' | 'off'>('off');

  useEffect(() => {
    warmBlast();
    const canvas = canvasRef.current;
    if (!canvas || !canvasOwnsBlast()) { modeRef.current = 'off'; return; }
    const frames = ((window as unknown as { __bwmBlastFrames?: number[] }).__bwmBlastFrames ??= []);
    if (typeof Worker !== 'undefined' && typeof canvas.transferControlToOffscreen === 'function') {
      try {
        const off = canvas.transferControlToOffscreen();
        const worker = new Worker(new URL('./nukeBlast.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        modeRef.current = 'worker';
        worker.postMessage({ type: 'init', canvas: off }, [off]);
        worker.onmessage = (ev: MessageEvent<{ type: string; tMs: number; ms: number; budget: number; slowed: boolean }>) => {
          if (ev.data.type !== 'frame') return;
          frames.push(ev.data.ms);
          (window as unknown as { __bwmBlastBudget?: number }).__bwmBlastBudget = ev.data.budget;
        };
        return () => { worker.terminate(); workerRef.current = null; };
      } catch {
        modeRef.current = 'main';
      }
    } else modeRef.current = 'main';
    if (modeRef.current === 'main') blastRef.current = createBlast();
    return undefined;
  }, []);

  useEffect(() => fx.on((e) => {
    if (e.kind !== 'nuke') return;
    if (fx.nukeMode === 'off' && !fx.osReducedMotion) { cancelHaptics('nuke-off'); return; }
    const reduced = fx.osReducedMotion || fx.reduced;
    startBurst('BJ', reduced);
    haptic(HAPTIC.detonation, 'detonate');
    if (!canvasOwnsBlast()) return;
    const box = trickCenter();
    const canvas = canvasRef.current;
    const w = canvas?.clientWidth || window.innerWidth;
    const h = canvas?.clientHeight || window.innerHeight;
    const dpr = dprCap();
    const opts = { cx: box.x, cy: box.y, w, h, dpr, reduced };
    if (modeRef.current === 'worker') workerRef.current?.postMessage({ type: 'start', ...opts });
    if (modeRef.current === 'main' && blastRef.current) {
      const c = canvas;
      if (c) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
      }
      resetBlast(blastRef.current, opts);
    }
  }), []);

  useEffect(() => {
    let raf = 0;
    let alive = true;
    let sawActive = false;
    let clock = 0;
    let hapticCut = false;
    const frames = () => ((window as unknown as { __bwmBlastFrames?: number[] }).__bwmBlastFrames ??= []);
    const stop = () => {
      const screen = document.querySelector<HTMLElement>('.table-screen');
      if (screen) screen.style.transform = '';
    };
    const tick = () => {
      if (!alive) return;
      const b = getBurst();
      if (!b) { sawActive = false; stop(); return; }
      if (b.start !== clock) { clock = b.start; sawActive = false; hapticCut = false; }
      const warped = fx.warp;
      const t = warped !== null ? warped * 1000 : (advanceBurst()?.elapsed ?? b.elapsed);
      if (modeRef.current === 'worker' && b.kind === 'BJ' && canvasOwnsBlast()) {
        workerRef.current?.postMessage({ type: 'frame', tMs: t });
      }
      if (modeRef.current === 'main' && blastRef.current && b.kind === 'BJ' && canvasOwnsBlast()) {
        const blast = blastRef.current;
        const t0 = performance.now();
        let guard = 0;
        while (blast.t < t / 1000 - 0.001 && guard++ < 8) stepBlast(blast, Math.min(0.033, t / 1000 - blast.t));
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) drawBlast(ctx, blast);
        const ms = performance.now() - t0;
        noteFrame(blast, ms);
        frames().push(ms);
        (window as unknown as { __bwmBlastBudget?: number }).__bwmBlastBudget = blast.budget;
      }
      const nuke = (window as unknown as { __bwmNuke?: { active?: boolean } }).__bwmNuke;
      if (nuke?.active) sawActive = true;
      // 3D fallback only. The canvas blast does not set __bwmNuke, so this does not cut a healthy detonation.
      const limit = canvasOwnsBlast() ? BURST_MS.BJ : NUKE3D_MS;
      if (!hapticCut && b.kind === 'BJ' && sawActive && nuke && nuke.active === false && t < limit - 80) {
        hapticCut = true;
        cancelHaptics('nuke-skipped');
      }
      const screen = document.querySelector<HTMLElement>('.table-screen');
      if (screen) {
        const s = shakeOffset(t, b.kind, b.reduced);
        screen.style.transform = s.x === 0 && s.y === 0 ? '' : `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px)`;
      }
      if (canvasOwnsBlast() && b.kind === 'BJ' && !b.reduced) {
        const banner = document.querySelector<HTMLElement>('[data-testid="nuke"]');
        if (banner && banner.classList.contains('driven')) {
          const pose = bannerPose(t);
          banner.style.opacity = pose ? String(pose.opacity) : '0';
          banner.style.transform = `translateX(-50%) scale(${pose ? pose.scale : 1.4})`;
        }
      }
      const end = canvasOwnsBlast() && b.kind === 'BJ' ? BLAST_MS : BURST_MS[b.kind];
      if (warped === null && t >= end) { clearBurst(); stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    const unsub = subscribeBurst(() => {
      cancelAnimationFrame(raf);
      if (getBurst()) raf = requestAnimationFrame(tick);
    });
    if (getBurst()) raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); unsub(); stop(); };
  }, []);

  return canvasOwnsBlast() ? <canvas ref={canvasRef} className="joker-burst-canvas" /> : null;
}

function trickCenter(): { x: number; y: number } {
  const L = (window as unknown as { __bwmLayout?: { trick: { x: number; y: number; w: number; h: number }[] } }).__bwmLayout;
  const trick = L?.trick ?? [];
  if (!trick.length) return { x: window.innerWidth / 2, y: window.innerHeight * 0.46 };
  return {
    x: trick.reduce((s, r) => s + r.x + r.w / 2, 0) / trick.length,
    y: trick.reduce((s, r) => s + r.y + r.h / 2, 0) / trick.length,
  };
}

/** Little Joker wins a trick that is not a nuke: the same opening haptic, no second explosion. */
export function startLittleBurst(): void {
  const reduced = fx.osReducedMotion || fx.reduced;
  startBurst('LJ', reduced);
  haptic(HAPTIC.detonation, 'detonate-little');
}
