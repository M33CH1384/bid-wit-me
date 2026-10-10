import { useEffect, useRef, useState } from 'react';

/**
 * Wheels celebration (~2.5 s, non-blocking, tap the car / banner to skip): a glossy purple-and-gold supercar
 * revs at the left of the table (body rocks, exhaust puffs), then peels out across the screen, leaving
 * tyre smoke and fading skid marks, under a "WHEELS!" banner with the team / player name.
 * Reduced effects: banner only (the sound still plays). Low graphics: lighter smoke.
 */
export const CAR_MS = 2500;
const LAUNCH = 0.95; // s: matches the engine sound's launch

export function WheelsCelebration({ id, who, reduced, low, onDone }: { id: number; who: string; reduced: boolean; low: boolean; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const car = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const t = window.setTimeout(() => done.current(), reduced ? 2000 : CAR_MS + 300);
    return () => clearTimeout(t);
  }, [id, reduced]);

  useEffect(() => {
    if (reduced || !canvas.current) return;
    const cv = canvas.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    interface Puff { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }
    const puffs: Puff[] = [];
    const skids: { x0: number; x1: number; y: number; at: number }[] = [];
    const t0 = performance.now();
    let raf = 0, last = t0;
    const rate = low ? 0.35 : 1;
    const step = (now: number) => {
      const T = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      const el = car.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const rearX = r.left + r.width * 0.2, frontX = r.left + r.width * 0.8, groundY = r.top + r.height * 0.9;
        const S = r.width / 360;
        // exhaust puffs on the revs, a wall of tyre smoke on launch
        const emit = T < LAUNCH ? (Math.sin(T * 18) > 0.6 ? 1 : 0) : T < LAUNCH + 0.7 ? 6 : T < LAUNCH + 1.1 ? 2 : 0;
        for (let i = 0; i < emit * rate; i++) {
          const atWheel = T >= LAUNCH;
          puffs.push({ x: (atWheel ? rearX : r.left + r.width * 0.02) + (Math.random() - 0.5) * 20 * S, y: groundY - (atWheel ? 6 : 16) * S, vx: -(40 + Math.random() * 120) * S, vy: -(15 + Math.random() * 45) * S, r: (atWheel ? 14 : 8) * S * (0.7 + Math.random() * 0.6), life: 0, max: 0.9 + Math.random() * 0.9 });
        }
        // skid marks: two rubber stripes laid down while the tyres spin (first ~0.55 s of the launch)
        if (T >= LAUNCH && T < LAUNCH + 0.55) {
          const s0 = skids[0];
          if (!s0) { skids.push({ x0: rearX, x1: rearX, y: groundY - 2 * S, at: T }, { x0: frontX, x1: frontX, y: groundY - 2 * S, at: T }); }
          else { skids[0]!.x1 = Math.max(skids[0]!.x1, rearX); skids[1]!.x1 = Math.max(skids[1]!.x1, frontX); }
        }
      }
      g.clearRect(0, 0, W, H);
      for (const s of skids) {
        const a = Math.max(0, 0.55 - Math.max(0, T - (s.at + 0.55)) * 0.45);
        if (a <= 0) continue;
        const grd = g.createLinearGradient(s.x0, 0, s.x1, 0);
        grd.addColorStop(0, `rgba(10,6,14,${a})`); grd.addColorStop(1, `rgba(10,6,14,${a * 0.25})`);
        g.fillStyle = grd; g.fillRect(s.x0, s.y - 3, Math.max(0, s.x1 - s.x0), 6);
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
      if (T < CAR_MS / 1000 + 0.6) raf = requestAnimationFrame(step); else g.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [id, reduced, low]);

  const skip = () => { setGone(true); done.current(); };
  return (
    <div className={`wheels-fx ${gone ? 'gone' : ''}`} data-testid="wheels-fx">
      {!reduced && <canvas ref={canvas} className="wheels-smoke" />}
      {!reduced && (
        <div ref={car} className="wheels-car" onClick={skip} role="presentation">
          <SuperCar />
        </div>
      )}
      <div className="hype-pop wheels-banner" role="status" onClick={skip} data-testid="pop-wheelsCar">
        <span className="hype-text">WHEELS!</span>
        <span className="hype-sub">{who}</span>
      </div>
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
