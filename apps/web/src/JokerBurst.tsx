import { useEffect, useRef } from 'react';
import { fx } from './fx';
import { HAPTIC, cancelHaptics, haptic } from './haptics';
import {
  BURST_MS, type JokerKind, JOKER_PALETTE,
  advanceBurst, bannerPose, clearBurst, cloudPose, flashOpacity, getBurst, mushroomSprites, shakeOffset, shockwave, startBurst, subscribeBurst,
} from './jokerFx';

/**
 * Detonation overlay: one canvas for the shockwave and a lightweight mushroom (a few billboard
 * sprites, no particles and no post-processing), plus a #FFFFF0 flash and a transform-only shake.
 * The 3D blast, including the iOS cheap path, stays in Nuke3D. This cloud is what a phone actually
 * sees: the cheap path's torus is a small dark shell, and the full path's screen-fire wash hides
 * the stem. A 3D stall cancels haptics but does not tear the cloud down.
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
    let hapticCut = false;
    const stop = () => {
      const table = document.querySelector<HTMLElement>('.table-canvas-wrap');
      if (table) table.style.transform = '';
      if (flash.current) flash.current.style.opacity = '0';
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    };
    const tick = () => {
      if (!alive) return;
      const b = getBurst();
      if (!b) { sawActive = false; stop(); return; }
      if (b.start !== clock) { clock = b.start; sawActive = false; hapticCut = false; }
      const warped = fx.warp;
      const t = warped !== null ? warped * 1000 : (advanceBurst()?.elapsed ?? 0);
      const nuke = (window as unknown as { __bwmNuke?: { active?: boolean } }).__bwmNuke;
      if (nuke?.active) sawActive = true;
      // The 3D blast bailed (stall watchdog, context loss, or a tap to skip). Stop vibration,
      // but keep the canvas cloud — it is the lightweight mushroom and does not use the GPU path
      // that freezes iOS.
      if (!hapticCut && b.kind === 'BJ' && sawActive && nuke && nuke.active === false && t < BURST_MS.BJ - 80) {
        hapticCut = true;
        cancelHaptics('nuke-skipped');
      }
      const table = document.querySelector<HTMLElement>('.table-canvas-wrap');
      paint(canvas.current, flash.current, table, t, b.kind, b.reduced);
      if (warped === null && t >= BURST_MS[b.kind]) { clearBurst(); stop(); return; }
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
  tableEl: HTMLElement | null,
  t: number,
  kind: JokerKind,
  reduced: boolean,
) {
  if (flashEl) flashEl.style.opacity = String(flashOpacity(t, kind, reduced));
  // The stamp follows the burst clock (including a capture warp), not a CSS delay.
  // A wall-clock animation finishes before a stalled frame ever reaches 800ms.
  const banner = document.querySelector<HTMLElement>('[data-testid="nuke"]');
  if (banner && !banner.classList.contains('calm')) {
    const pose = bannerPose(t);
    banner.style.animation = 'none';
    banner.style.opacity = pose ? String(pose.opacity) : '0';
    banner.style.transform = `translateX(-50%) scale(${pose ? pose.scale : 1.4})`;
  }
  if (tableEl) {
    const s = shakeOffset(t, kind, reduced);
    tableEl.style.transform = s.x === 0 && s.y === 0 ? '' : `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px)`;
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
  const cloud = cloudPose(t, kind, false);
  if (cloud && cloud.opacity > 0.02) {
    const hotHex = kind === 'BJ' ? '#FFD24D' : JOKER_PALETTE.LJ.hot.hex;
    const deepHex = kind === 'BJ' ? '#FF8A3D' : JOKER_PALETTE.LJ.core.hex;
    const fadeHex = kind === 'BJ' ? 'rgba(255,138,61,0)' : 'rgba(200,107,255,0)';
    const sprites = mushroomSprites(cloud, kind, Math.min(w, h));
    const soot = kind === 'BJ' ? '#3a0c02' : '#1a0630';
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    // Dark rim first, so the cap and stem stay a silhouette on the orange screen-fire wash.
    for (const s of sprites) {
      ctx.globalAlpha = cloud.opacity * 0.72;
      ctx.fillStyle = soot;
      ctx.beginPath();
      ctx.ellipse(cx + s.x, cy + s.y, Math.max(1, s.rx * 1.22), Math.max(1, s.ry * 1.22), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const cap = sprites[sprites.length - 1]!;
    const halo = Math.max(cap.rx, cap.ry) * 1.8;
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createRadialGradient(cx + cap.x, cy + cap.y, halo * 0.15, cx + cap.x, cy + cap.y, halo);
    hg.addColorStop(0, hotHex);
    hg.addColorStop(1, fadeHex);
    ctx.globalAlpha = cloud.opacity * 0.35;
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(cx + cap.x, cy + cap.y, halo, halo * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    for (const s of sprites) {
      const rad = Math.max(s.rx, s.ry, 2);
      const g = ctx.createRadialGradient(cx + s.x, cy + s.y, rad * 0.08, cx + s.x, cy + s.y, rad);
      g.addColorStop(0, s.hot === 0 ? hotHex : deepHex);
      g.addColorStop(0.62, s.hot === 0 ? deepHex : hotHex);
      g.addColorStop(1, fadeHex);
      ctx.globalAlpha = cloud.opacity * (s.hot === 0 ? 0.95 : 0.88);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx + s.x, cy + s.y, Math.max(1, s.rx), Math.max(1, s.ry), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // Drawn last so the cap never covers it. #B6FF3B, 6px (Little Joker 4px), with a glow so it
  // reads on the felt and on the full-path screen fire. The canvas itself stays transparent.
  const sw = shockwave(t, kind);
  if (sw && sw.opacity > 0.02 && sw.mul > 0.02) {
    const rad = Math.max(1, (sw.mul * table) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = kind === 'BJ' ? '#B6FF3B' : JOKER_PALETTE.LJ.hot.hex;
    ctx.shadowBlur = 16;
    ctx.shadowColor = kind === 'BJ' ? '#7CFF4F' : '#C86BFF';
    ctx.globalAlpha = sw.opacity;
    ctx.lineWidth = kind === 'BJ' ? 6 : 4;
    ctx.stroke();
    ctx.restore();
  }
}

/** Little Joker wins a trick that is not a nuke: same idea, smaller, purple, no white flash. */
export function startLittleBurst(): void {
  const reduced = fx.osReducedMotion || fx.reduced;
  startBurst('LJ', reduced);
  haptic(HAPTIC.detonation, 'detonate-little');
}
