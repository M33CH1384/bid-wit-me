import { useEffect, useRef } from 'react';
import { fx } from './fx';
import { HAPTIC, cancelHaptics, haptic } from './haptics';
import {
  BURST_MS, type JokerKind, JOKER_PALETTE,
  advanceBurst, clearBurst, cloudPose, flashOpacity, getBurst, shakeOffset, shockwave, startBurst, subscribeBurst,
} from './jokerFx';

/**
 * Detonation overlay: one canvas for the shockwave and the mushroom sprites, plus a #FFFFF0 flash
 * and a transform-only screen shake. No WebGL composer and no fullscreen fire pass — those stay
 * inside Nuke3D, which keeps the iOS cheap path (no bloom, no screen pass, stall watchdog).
 * The clock is the burst started from the nuke event (t = 0 is the flash and the shockwave).
 */
export default function JokerBurst() {
  const flash = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => fx.on((e) => {
    if (e.kind !== 'nuke') return;
    // "Off" is banner + boom. The 3D blast is already skipped; don't add a second explosion,
    // and cancel so a vibration pattern can't outlive a blast that never painted.
    if (fx.nukeMode === 'off' && !fx.osReducedMotion) { cancelHaptics('nuke-off'); return; }
    const reduced = fx.osReducedMotion || fx.reduced;
    startBurst('BJ', reduced);
    // t = 0 of the flash and the shockwave. The pattern's on/off slots cover that window.
    haptic(HAPTIC.detonation, 'detonate');
  }), []);

  useEffect(() => {
    let raf = 0;
    let alive = true;
    let sawActive = false;
    let clock = 0;
    const stop = () => {
      const screen = document.querySelector<HTMLElement>('.table-screen');
      if (screen) screen.style.transform = '';
      if (flash.current) flash.current.style.opacity = '0';
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    };
    const tick = () => {
      if (!alive) return;
      const b = getBurst();
      if (!b) { sawActive = false; stop(); return; }
      if (b.start !== clock) { clock = b.start; sawActive = false; }
      const t = advanceBurst()?.elapsed ?? 0;
      const screen = document.querySelector<HTMLElement>('.table-screen');
      const nuke = (window as unknown as { __bwmNuke?: { active?: boolean } }).__bwmNuke;
      if (nuke?.active) sawActive = true;
      // The 3D blast bailed (stall watchdog, context loss, or a tap to skip) after it had started.
      if (b.kind === 'BJ' && sawActive && nuke && nuke.active === false && t < BURST_MS.BJ - 80) {
        cancelHaptics('nuke-skipped');
        clearBurst();
        stop();
        return;
      }
      paint(canvas.current, flash.current, screen, t, b.kind, b.reduced);
      if (t >= BURST_MS[b.kind]) { clearBurst(); stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    const unsub = subscribeBurst(() => {
      cancelAnimationFrame(raf);
      if (getBurst()) raf = requestAnimationFrame(tick);
    });
    if (getBurst()) raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); unsub(); stop(); };
  }, []);

  return (
    <div className="joker-burst" aria-hidden>
      <div ref={flash} className="joker-flash" data-testid="joker-flash" />
      <canvas ref={canvas} className="joker-burst-canvas" />
    </div>
  );
}

function paint(
  canvas: HTMLCanvasElement | null,
  flashEl: HTMLDivElement | null,
  screen: HTMLElement | null,
  t: number,
  kind: JokerKind,
  reduced: boolean,
) {
  if (flashEl) flashEl.style.opacity = String(flashOpacity(t, kind, reduced));
  if (screen) {
    const s = shakeOffset(t, kind, reduced);
    screen.style.transform = s.x === 0 && s.y === 0 ? '' : `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px)`;
  }
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (reduced) return;
  const L = (window as unknown as { __bwmLayout?: { trick: { x: number; y: number; w: number; h: number }[] } }).__bwmLayout;
  const trick = L?.trick ?? [];
  const cx = trick.length ? trick.reduce((s, r) => s + r.x + r.w / 2, 0) / trick.length : w / 2;
  const cy = trick.length ? trick.reduce((s, r) => s + r.y + r.h / 2, 0) / trick.length : h * 0.46;
  const table = Math.min(w, h) * 0.92;
  const sw = shockwave(t, kind);
  if (sw && sw.opacity > 0.01 && sw.mul > 0.02) {
    const rad = (sw.mul * table) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = JOKER_PALETTE[kind].hot.hex;
    ctx.globalAlpha = sw.opacity;
    ctx.lineWidth = kind === 'BJ' ? 6 : 4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const cloud = cloudPose(t, kind, false);
  if (cloud && cloud.opacity > 0.02) {
    const capY = cy - cloud.rise;
    const blobs = kind === 'BJ' ? 14 : 8;
    const hotHex = kind === 'BJ' ? '#FFD24D' : JOKER_PALETTE.LJ.hot.hex;
    const deepHex = kind === 'BJ' ? '#FF8A3D' : JOKER_PALETTE.LJ.core.hex;
    for (let i = 0; i < blobs; i++) {
      const ang = (i / blobs) * Math.PI * 2;
      const ring = i < blobs * 0.65;
      const rx = Math.cos(ang) * (ring ? 28 : 10) * cloud.scale;
      const ry = Math.sin(ang) * (ring ? 16 : 22) * cloud.scale - (ring ? 0 : 18 * cloud.scale);
      const rad = (ring ? 18 : 12) * cloud.scale;
      const g = ctx.createRadialGradient(cx + rx, capY + ry, 1, cx + rx, capY + ry, rad);
      const hot = i % 2 === 0;
      g.addColorStop(0, hot ? hotHex : deepHex);
      g.addColorStop(1, 'rgba(255,138,61,0)');
      ctx.globalAlpha = cloud.opacity * (ring ? 0.85 : 0.7);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx + rx, capY + ry, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** Little Joker wins a trick that is not a nuke: same idea, smaller, purple, no white flash. */
export function startLittleBurst(): void {
  const reduced = fx.osReducedMotion || fx.reduced;
  startBurst('LJ', reduced);
  haptic(HAPTIC.detonation, 'detonate-little');
}
