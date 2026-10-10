import { useEffect, useRef, useState } from 'react';
import { type FxEvent, fx } from './fx';
import { WheelsCelebration } from './WheelsCar';

/**
 * Full-screen hype overlay: streak / SHOT! pop-ups, joker vignette pulses and the Big-over-Little nuke
 * (white flash → mushroom cloud particles over the trick → shockwave ring → smoke clears).
 * Listens to the fx bus; with "Reduce effects" the flash, shockwave and screen jolt are skipped (sound + text stay).
 */
interface Pop { id: number; kind: FxEvent['kind']; text: string; sub?: string; level?: number }

function trickCenter(): { x: number; y: number } {
  const L = (window as unknown as { __bwmLayout?: { trick: { x: number; y: number; w: number; h: number }[] } }).__bwmLayout;
  if (L?.trick?.length) {
    const xs = L.trick.map((t) => t.x + t.w / 2), ys = L.trick.map((t) => t.y + t.h / 2);
    return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
}

/** Screen centre of the most recently played trick card (the over-cut lands there). */
function lastTrickCard(): { x: number; y: number } {
  const L = (window as unknown as { __bwmLayout?: { trick: { x: number; y: number; w: number; h: number }[] } }).__bwmLayout;
  const t = L?.trick?.[L.trick.length - 1];
  return t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : trickCenter();
}

/* ------------------------------------------------------------- mushroom cloud */
interface P { x: number; y: number; vx: number; vy: number; r: number; vr: number; life: number; max: number; kind: 'stem' | 'cap' | 'dust' | 'spark' | 'fire' }

function runNuke(canvas: HTMLCanvasElement, cx: number, cy: number, onDone: () => void): () => void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const S = Math.min(W, H) / 400; // scale with the screen
  const ps: P[] = [];
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const capY = cy - 150 * S;
  for (let i = 0; i < 46; i++) ps.push({ x: cx + rnd(-10, 10) * S, y: cy, vx: rnd(-6, 6) * S, vy: rnd(-150, -70) * S, r: rnd(8, 14) * S, vr: 7 * S, life: 0, max: rnd(2.6, 3.4), kind: 'stem' });
  for (let i = 0; i < 90; i++) { const a = rnd(0, Math.PI * 2); const sp = rnd(25, 75) * S; ps.push({ x: cx + Math.cos(a) * 6 * S, y: capY + 40 * S, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.45 - 55 * S, r: rnd(12, 22) * S, vr: 12 * S, life: -rnd(0.15, 0.45), max: rnd(2.7, 3.6), kind: 'cap' }); }
  for (let i = 0; i < 60; i++) { const dir = Math.random() < 0.5 ? -1 : 1; ps.push({ x: cx, y: cy + rnd(-4, 6) * S, vx: dir * rnd(60, 220) * S, vy: rnd(-8, 4) * S, r: rnd(6, 13) * S, vr: 9 * S, life: 0, max: rnd(1.8, 2.8), kind: 'dust' }); }
  for (let i = 0; i < 26; i++) ps.push({ x: cx, y: cy, vx: rnd(-50, 50) * S, vy: rnd(-90, -10) * S, r: rnd(16, 30) * S, vr: 30 * S, life: 0, max: rnd(0.5, 0.9), kind: 'fire' });
  for (let i = 0; i < 70; i++) { const a = rnd(-Math.PI, 0); const sp = rnd(120, 380) * S; ps.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(1, 2.4) * S, vr: 0, life: 0, max: rnd(0.8, 1.8), kind: 'spark' }); }
  let raf = 0, last = performance.now();
  const t0 = last;
  const color = (p: P, k: number) => {
    // hot core (white → yellow → orange → red) cooling to grey smoke
    if (p.kind === 'spark') return `rgba(255,${200 - k * 120 | 0},${120 - k * 100 | 0},${1 - k})`;
    if (p.kind === 'fire') return `rgba(255,${230 - k * 150 | 0},${140 - k * 140 | 0},${0.8 * (1 - k)})`;
    const heat = Math.max(0, 1 - k * 2.2);
    const r = 90 + heat * 165, gg = 80 + heat * 130, b = 78 + heat * 20;
    const a = (p.kind === 'dust' ? 0.5 : 0.75) * Math.min(1, (1 - k) * 1.6) * Math.min(1, p.life * 6 + 0.2);
    return `rgba(${r | 0},${gg | 0},${b | 0},${a})`;
  };
  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const T = (now - t0) / 1000;
    g.clearRect(0, 0, W, H);
    // a glow under the blast
    if (T < 1.6) { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 170 * S); gr.addColorStop(0, `rgba(255,200,90,${0.55 * (1 - T / 1.6)})`); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    let alive = 0;
    for (const p of ps) {
      p.life += dt;
      if (p.life < 0 || p.life > p.max) { if (p.life <= p.max) alive++; continue; }
      alive++;
      const k = p.life / p.max;
      if (p.kind === 'stem') { p.vy *= 0.985; if (p.y < capY + 30 * S) { p.vy *= 0.9; p.vx += (p.x - cx) * 0.02; } }
      if (p.kind === 'cap') { p.vx *= 0.975; p.vy = p.vy * 0.97 - 4 * S * dt; const dx = p.x - cx; p.vy += (dx * dx) / (6000 * S) * dt * 10; }
      if (p.kind === 'dust') { p.vx *= 0.97; p.vy -= 6 * S * dt; }
      if (p.kind === 'spark') p.vy += 300 * S * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      g.globalCompositeOperation = p.kind === 'spark' || p.kind === 'fire' || k < 0.18 ? 'lighter' : 'source-over';
      g.fillStyle = color(p, k);
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    if (alive && T < 4.2) raf = requestAnimationFrame(step);
    else { g.clearRect(0, 0, W, H); onDone(); }
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export default function Hype({ reduced, low = false }: { reduced: boolean; low?: boolean }) {
  const [car, setCar] = useState<{ id: number; who: string } | null>(null);
  const [spark, setSpark] = useState<{ id: number; x: number; y: number; level: number } | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [nuke, setNuke] = useState<{ id: number; x: number; y: number } | null>(null);
  const [pulse, setPulse] = useState<{ id: number; big: boolean } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => fx.on((e) => {
    const add = (p: Pop, ms: number) => { setPops((ps) => [...ps.filter((x) => x.kind !== p.kind), p]); window.setTimeout(() => setPops((ps) => ps.filter((x) => x.id !== p.id)), ms); };
    if (e.kind === 'streak') add({ id: e.id, kind: e.kind, text: e.text ?? 'HEAT CHECK', sub: e.sub ?? `${e.level} hands in a row`, level: e.level }, 2300);
    else if (e.kind === 'shot') add({ id: e.id, kind: e.kind, text: 'SHOT!', sub: e.text }, 2000);
    else if (e.kind === 'overcut') {
      const lvl = (e.level ?? 2) >= 3 ? 3 : 2;
      add({ id: e.id, kind: e.kind, text: e.text ?? 'SAY LESS!', level: lvl }, lvl === 3 ? 1700 : 1300);
      if (!reducedRef.current) { const c = lastTrickCard(); setSpark({ id: e.id, level: lvl, ...c }); window.setTimeout(() => setSpark((s) => (s?.id === e.id ? null : s)), lvl === 3 ? 800 : 600); }
    }
    else if (e.kind === 'wheelsCar') setCar({ id: e.id, who: e.text ?? '' });
    else if (e.kind === 'wheels') add({ id: e.id, kind: e.kind, text: 'WHEELS!', sub: e.sub ?? e.text }, 1900);
    else if (e.kind === 'gotShot') add({ id: e.id, kind: e.kind, text: 'GOT SHOT', sub: e.text }, 1900);
    else if (e.kind === 'jokerLittle' || e.kind === 'jokerBig') { setPulse({ id: e.id, big: e.kind === 'jokerBig' }); window.setTimeout(() => setPulse((p) => (p?.id === e.id ? null : p)), e.kind === 'jokerBig' ? 1100 : 500); }
    else if (e.kind === 'nuke') {
      const c = trickCenter();
      setNuke({ id: e.id, ...c });
      add({ id: e.id + 0.5, kind: e.kind, text: '☢ NUKED ☢', sub: 'Big Joker over Little Joker' }, 2600);
    }
  }), []);

  useEffect(() => {
    if (!nuke || !canvas.current) return;
    const id = nuke.id;
    const stop = runNuke(canvas.current, nuke.x, nuke.y, () => setNuke((n) => (n?.id === id ? null : n)));
    return stop;
  }, [nuke]);

  // HUD jolt (the 3D camera shakes separately)
  useEffect(() => {
    if (reduced) return;
    const big = nuke ? 'jolt-nuke' : pulse?.big ? 'jolt-big' : pulse ? 'jolt-small' : null;
    if (!big) return;
    const el = document.querySelector('.table-screen');
    el?.classList.add(big);
    const t = window.setTimeout(() => el?.classList.remove(big), big === 'jolt-nuke' ? 1500 : big === 'jolt-big' ? 900 : 350);
    return () => { clearTimeout(t); el?.classList.remove(big); };
  }, [nuke, pulse, reduced]);

  return (
    <div className="hype-layer" aria-live="polite" data-testid="hype">
      {pulse && <div key={pulse.id} className={`joker-pulse ${pulse.big ? 'big' : ''}`} data-testid="joker-pulse" />}
      {nuke && (
        <>
          {!reduced && <div key={`f${nuke.id}`} className="nuke-flash" data-testid="nuke-flash" />}
          {!reduced && <div key={`w${nuke.id}`} className="nuke-wave" style={{ left: nuke.x, top: nuke.y }} />}
        </>
      )}
      <canvas ref={canvas} className="nuke-canvas" data-testid={nuke ? 'nuke' : undefined} style={{ display: nuke ? 'block' : 'none' }} />
      {spark && <div key={`s${spark.id}`} className={`overcut-spark lvl${spark.level}`} style={{ left: spark.x, top: spark.y }} data-testid="overcut-spark"><i /><i /><i /><i /><i /><i /><i /><i /></div>}
      {car && <WheelsCelebration key={car.id} id={car.id} who={car.who} reduced={reduced} low={low} onDone={() => setCar((c) => (c?.id === car.id ? null : c))} />}
      {pops.map((p) => (
        <div key={p.id} className={`hype-pop ${p.kind} lvl${p.level ?? 0}`} data-testid={`pop-${p.kind}`} role="status">
          <span className="hype-text">{p.text}</span>
          {p.sub && <span className="hype-sub">{p.sub}</span>}
        </div>
      ))}
    </div>
  );
}
