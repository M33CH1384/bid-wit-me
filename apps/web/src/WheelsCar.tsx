import { useEffect, useRef, useState } from 'react';
import { fx } from './fx';
import {
  BLAST_FLASH_S, carSweepAt, wheelPoints, wheelsBlastReaction, wheelsPoseAt,
  type CarSweepFrom, type WheelsPose,
} from './wheelsDonuts';

/**
 * Wheels celebration (~2.5 s, non-blocking, tap the car / banner to skip): the glossy
 * purple-and-gold supercar swings onto the table under the revs and does DOUGHNUTS on
 * the felt — tight circles around the trick centre, tyre smoke pouring, dark donut arcs
 * laid on the felt — then peels off the right edge, under a "WHEELS!" banner with the
 * team / player name. (Owner direction 2026-10-28: the doughnuts are the car's own
 * signature table move — the `wheelsCar` summons is unchanged, a side taking all 10
 * books; only the driving changed. The peelOut sound still fits: revs on the swing-in,
 * the squeal under the doughnuts, the away-tail under the peel-off.)
 * And if a nuke/mega detonates mid-show, the blast takes the car with everything else:
 * blown off the table, tumbling, mega harder. wheelsDonuts.ts holds the pure poses.
 * Reduced effects: banner only (the sound still plays). Low graphics: lighter smoke.
 */
export const CAR_MS = 2500;

/** Screen centre of the felt (the trick spots) — the same layout probe Hype pops from. */
function feltCenter(): { x: number; y: number } {
  const L = (window as unknown as { __bwmLayout?: { trick: { x: number; y: number; w: number; h: number }[] } }).__bwmLayout;
  if (L?.trick?.length) {
    const xs = L.trick.map((t) => t.x + t.w / 2), ys = L.trick.map((t) => t.y + t.h / 2);
    return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
}

export function WheelsCelebration({ id, who, reduced, low, onDone }: { id: number; who: string; reduced: boolean; low: boolean; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const car = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  const [blasted, setBlasted] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const finished = useRef(false);
  const finishRef = useRef(() => {});
  finishRef.current = () => {
    if (finished.current) return;
    finished.current = true;
    setGone(true);
    done.current();
  };
  // set by the driving loop when a detonation claims the car mid-show; the end
  // timer below defers once so the sweep gets to play out instead of unmounting.
  const sweepRef = useRef<{ at: number; mega: boolean } | null>(null);

  useEffect(() => {
    let t = 0;
    let rearmed = false;
    const arm = (ms: number) => {
      t = window.setTimeout(() => {
        if (!reduced && sweepRef.current && !rearmed) { rearmed = true; arm(1100); return; }
        finishRef.current();
      }, ms);
    };
    arm(reduced ? 2000 : CAR_MS + 300);
    return () => clearTimeout(t);
  }, [id, reduced]);

  useEffect(() => {
    if (reduced || !canvas.current || !car.current) return;
    const cv = canvas.current;
    const el = car.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    const carW = el.getBoundingClientRect().width || Math.min(W * 0.36, 336);
    const carH = (carW * 110) / 360;
    const view = { w: W, h: H, carW };
    const center = feltCenter();
    const S = carW / 360;
    interface Puff { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }
    interface Seg { x0: number; y0: number; x1: number; y1: number; at: number }
    const puffs: Puff[] = [];
    const segs: Seg[] = [];
    const t0 = performance.now();
    let raf = 0, last = t0;
    const rate = low ? 0.35 : 1;
    let lastPts: { rear: { x: number; y: number }; front: { x: number; y: number } } | null = null;
    let blast: { at: number; mega: boolean; calm: boolean; from?: CarSweepFrom; burst?: boolean } | null = null;
    // the detonation seam — the same fx event the blast itself keys off; the
    // nuke system is not modified, the car just stops being exempt from it.
    const offBlast = fx.on((e) => {
      if (e.kind !== 'nuke' && e.kind !== 'mega') return;
      const r = wheelsBlastReaction(e.kind, fx.nukeMode);
      if (r === 'none' || blast) return;
      blast = { at: e.at, mega: r === 'mega-swept', calm: fx.osReducedMotion };
      sweepRef.current = { at: e.at, mega: blast.mega };
    });
    const spawn = (x: number, y: number, vx: number, vy: number, r: number) => {
      puffs.push({ x, y, vx, vy, r, life: 0, max: 0.9 + Math.random() * 0.9 });
    };
    const step = (now: number) => {
      const T = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      let pose: WheelsPose = wheelsPoseAt(T, view, center);
      let airborne = false;
      if (blast) {
        const u = (now - blast.at) / 1000 - BLAST_FLASH_S;
        if (u >= 0) {
          if (!blast.from) { blast.from = { cx: pose.cx, cy: pose.cy, flip: pose.flip }; setBlasted(true); }
          const sp = carSweepAt(u, blast.from, center, blast.mega, blast.calm, view);
          if (sp) {
            pose = { cx: sp.cx, cy: sp.cy, rot: sp.rot, flip: sp.flip, phase: 'swept' };
            airborne = true;
            el.style.opacity = String(sp.opacity);
            if (!blast.burst) {
              blast.burst = true;
              for (let i = 0; i < 14; i++) spawn(pose.cx + (Math.random() - 0.5) * carW * 0.7, pose.cy + (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 160 * S, -(30 + Math.random() * 90) * S, (12 + Math.random() * 10) * S);
            }
            if (sp.gone) { finishRef.current(); return; }
          }
        }
      }
      el.style.transform = `translate(${pose.cx - carW / 2}px, ${pose.cy - carH / 2}px) rotate(${pose.rot}deg) scaleX(${pose.flip ? -1 : 1})`;
      const pts = wheelPoints(pose, view);
      if (!airborne) {
        if (pose.phase === 'enter') {
          // exhaust puffs pulsing with the revs, off the rear bumper
          if (Math.sin(T * 18) > 0.6) spawn(pts.rear.x - 16 * S, pts.rear.y - 12 * S, -(40 + Math.random() * 120) * S, -(15 + Math.random() * 45) * S, 8 * S * (0.7 + Math.random() * 0.6));
        } else if (pose.phase === 'donuts') {
          // tyre smoke billowing outward off the sliding rear wheel
          const ox = pose.cx - center.x, oy = pose.cy - center.y, ol = Math.hypot(ox, oy) || 1;
          const n = Math.max(1, Math.round(3 * rate));
          for (let i = 0; i < n; i++) spawn(pts.rear.x + (Math.random() - 0.5) * 16 * S, pts.rear.y + (Math.random() - 0.5) * 8 * S, ((ox / ol) * (50 + Math.random() * 80) + (Math.random() - 0.5) * 30) * S, -(25 + Math.random() * 55) * S, (15 + Math.random() * 8) * S * (0.8 + Math.random() * 0.5));
        } else if (pose.phase === 'exit') {
          const n = Math.max(1, Math.round(3 * rate));
          for (let i = 0; i < n; i++) spawn(pts.rear.x + (Math.random() - 0.5) * 14 * S, pts.rear.y - 4 * S, -(60 + Math.random() * 140) * S, -(20 + Math.random() * 50) * S, (13 + Math.random() * 8) * S);
        }
        // donut arcs (and the peel-off stripes): stroked segments between
        // successive wheel points, fading a beat after they're laid
        if ((pose.phase === 'donuts' || pose.phase === 'exit') && lastPts) {
          for (const k of ['rear', 'front'] as const) {
            const a = lastPts[k], b = pts[k], d = Math.hypot(b.x - a.x, b.y - a.y);
            if (d > 1.5 && d < 90) segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, at: T });
          }
        }
        lastPts = pts;
      } else {
        // airborne: a thinning smoke trail, and no rubber — the wheels are off the felt
        if (Math.random() < 0.8 * rate) spawn(pose.cx + (Math.random() - 0.5) * carW * 0.5, pose.cy + (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 60 * S, (10 + Math.random() * 40) * S, (10 + Math.random() * 8) * S);
        lastPts = null;
      }
      g.clearRect(0, 0, W, H);
      g.lineCap = 'round';
      for (const s of segs) {
        const a = Math.max(0, 0.5 - Math.max(0, T - (s.at + 1.1)) * 0.4);
        if (a <= 0) continue;
        g.strokeStyle = `rgba(10,6,14,${a})`;
        g.lineWidth = 5.5 * S + 1.5;
        g.beginPath(); g.moveTo(s.x0, s.y0); g.lineTo(s.x1, s.y1); g.stroke();
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i]!;
        p.life += dt; if (p.life > p.max) { puffs.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.97; p.r += 38 * dt;
        const k = p.life / p.max;
        const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        const al = 0.42 * (1 - k) * Math.min(1, p.life * 8);
        grd.addColorStop(0, `rgba(226,216,240,${al})`); grd.addColorStop(1, 'rgba(200,190,220,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
      }
      if (T < CAR_MS / 1000 + 0.6 || airborne) raf = requestAnimationFrame(step); else g.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); offBlast(); };
  }, [id, reduced, low]);

  const skip = () => finishRef.current();
  return (
    <div className={`wheels-fx ${gone ? 'gone' : ''}`} data-testid="wheels-fx">
      {!reduced && <canvas ref={canvas} className="wheels-smoke" />}
      {!reduced && (
        <div ref={car} className="wheels-car" onClick={skip} role="presentation">
          <SuperCar />
        </div>
      )}
      {!blasted && (
        <div className="hype-pop wheels-banner" role="status" onClick={skip} data-testid="pop-wheelsCar">
          <span className="hype-text">WHEELS!</span>
          <span className="hype-sub">{who}</span>
        </div>
      )}
    </div>
  );
}

/** Side-view supercar: low wedge body, glossy purple paint with a gold stripe, chrome glints, gold rims. */
function SuperCar() {
  return (
    <svg viewBox="0 0 360 110" width="100%" height="100%" aria-hidden>
      <defs>
        <linearGradient id="wc-paint" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c79bff" />
          <stop offset=".28" stopColor="#8a3dff" />
          <stop offset=".62" stopColor="#4b1aa6" />
          <stop offset="1" stopColor="#1e0a45" />
        </linearGradient>
        <linearGradient id="wc-gloss" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".45" stopColor="#fff" stopOpacity=".85" />
          <stop offset=".6" stopColor="#fff" stopOpacity=".15" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wc-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a2c5c" />
          <stop offset=".5" stopColor="#0d0818" />
          <stop offset="1" stopColor="#2b1f48" />
        </linearGradient>
        <linearGradient id="wc-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset=".5" stopColor="#f5c542" />
          <stop offset="1" stopColor="#a8741a" />
        </linearGradient>
        <radialGradient id="wc-rim" cx=".4" cy=".35" r=".7">
          <stop offset="0" stopColor="#fff6cf" />
          <stop offset=".45" stopColor="#f5c542" />
          <stop offset="1" stopColor="#7a5210" />
        </radialGradient>
        <radialGradient id="wc-shadow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="180" cy="100" rx="170" ry="9" fill="url(#wc-shadow)" />
      {/* body: long nose (right), fastback roof, high rear deck + wing (left) */}
      <path d="M14 78 C12 66 18 58 34 55 L70 50 C96 30 132 20 170 19 C204 18 232 26 258 40 C290 44 322 50 340 60 C350 66 352 74 348 82 L14 82 Z" fill="url(#wc-paint)" stroke="#2a0d5c" strokeWidth="1.5" />
      {/* rear wing */}
      <path d="M10 46 L52 44 L54 50 L18 52 Z" fill="url(#wc-gold)" />
      <path d="M34 50 L38 56 L44 56 L42 50 Z" fill="#1e0a45" />
      {/* side intake + gold stripe */}
      <path d="M98 66 C112 56 132 54 150 56 L146 70 C130 68 116 70 104 74 Z" fill="#14072e" opacity=".9" />
      <path d="M20 68 C120 62 240 58 344 64 L344 68 C240 63 120 67 20 73 Z" fill="url(#wc-gold)" />
      {/* canopy */}
      <path d="M92 50 C112 32 142 25 172 25 C196 25 220 31 240 42 L232 46 C204 44 160 45 98 52 Z" fill="url(#wc-glass)" stroke="#d9c2ff" strokeOpacity=".5" strokeWidth="1" />
      <path d="M118 40 C140 31 166 29 186 30 L178 36 C160 36 140 38 124 42 Z" fill="#fff" opacity=".22" />
      {/* gloss sweep + chrome glints */}
      <path d="M40 54 C120 40 220 34 330 56 L326 59 C220 40 120 46 44 58 Z" fill="url(#wc-gloss)" opacity=".7" />
      <rect x="300" y="56" width="34" height="5" rx="2.5" fill="#fff8d6" />
      <rect x="302" y="57" width="18" height="2.4" rx="1.2" fill="#fff" />
      <rect x="16" y="60" width="16" height="6" rx="2" fill="#ff3d6e" />
      <rect x="18" y="61.5" width="8" height="2" rx="1" fill="#ffd0dc" />
      {/* wheels: dark tyre, gold rim with spokes (spun by CSS) */}
      {[78, 284].map((cx) => (
        <g key={cx} className="wc-wheel" style={{ transformOrigin: `${cx}px 82px` }}>
          <circle cx={cx} cy="82" r="20" fill="#0b0710" stroke="#2a2235" strokeWidth="3" />
          <circle cx={cx} cy="82" r="13" fill="url(#wc-rim)" />
          {[0, 72, 144, 216, 288].map((a) => <rect key={a} x={cx - 1.6} y="70" width="3.2" height="12" fill="#5c3d0c" transform={`rotate(${a} ${cx} 82)`} />)}
          <circle cx={cx} cy="82" r="3.5" fill="#fff1b8" />
        </g>
      ))}
      {/* wheel arches */}
      <path d="M52 82 C54 62 102 62 104 82" fill="none" stroke="#1e0a45" strokeWidth="4" />
      <path d="M258 82 C260 62 308 62 310 82" fill="none" stroke="#1e0a45" strokeWidth="4" />
    </svg>
  );
}
