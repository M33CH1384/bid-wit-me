import { useEffect, useRef, useState } from 'react';
import { type FxEvent, type NukeIntensity, fx } from './fx';
import JokerBurst from './JokerBurst';
import PulsePlate from './PulsePlate';
import { getBurst } from './jokerFx';
import { BLAST_MS, canvasOwnsBlast } from './nukeBlast';
import { WheelsCelebration } from './WheelsCar';

/**
 * Full-screen hype overlay: streak / SHOT! pop-ups, the joker pulse, and the nuke banner.
 * The detonation is the canvas blast when a 2D context exists, otherwise the 3D blast.
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

export default function Hype({ reduced, low = false }: { reduced: boolean; low?: boolean }) {
  const [car, setCar] = useState<{ id: number; who: string } | null>(null);
  const [spark, setSpark] = useState<{ id: number; x: number; y: number; level: number } | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [nuke, setNuke] = useState<{ id: number; x: number; y: number; mode: NukeIntensity } | null>(null);
  const [pulse, setPulse] = useState<{ id: number; big: boolean } | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const nukeWatch = useRef(0);

  useEffect(() => {
    const off = fx.on((e) => {
    const add = (p: Pop, ms: number) => { setPops((ps) => [...ps.filter((x) => x.kind !== p.kind), p]); window.setTimeout(() => setPops((ps) => ps.filter((x) => x.id !== p.id)), ms); };
    if (e.kind === 'streak') add({ id: e.id, kind: e.kind, text: e.text ?? 'HEAT CHECK', sub: e.sub ?? `${e.level} hands in a row`, level: e.level }, 2300);
    else if (e.kind === 'shot') add({ id: e.id, kind: e.kind, text: e.sub ? (e.text ?? 'SHOT!') : 'SHOT!', sub: e.sub ?? e.text }, 2000);
    else if (e.kind === 'overcut') {
      const lvl = (e.level ?? 2) >= 3 ? 3 : 2;
      add({ id: e.id, kind: e.kind, text: e.text ?? 'SAY LESS!', level: lvl }, lvl === 3 ? 1700 : 1300);
      if (!reducedRef.current) { const c = lastTrickCard(); setSpark({ id: e.id, level: lvl, ...c }); window.setTimeout(() => setSpark((s) => (s?.id === e.id ? null : s)), lvl === 3 ? 800 : 600); }
    }
    else if (e.kind === 'wheelsCar') setCar({ id: e.id, who: e.text ?? '' });
    else if (e.kind === 'wheels') add({ id: e.id, kind: e.kind, text: 'WHEELS!', sub: e.sub ?? e.text }, 1900);
    else if (e.kind === 'ranIt') add({ id: e.id, kind: e.kind, text: e.text ?? 'RAN IT!', sub: e.sub }, 2700);
    else if (e.kind === 'hustled') add({ id: e.id, kind: e.kind, text: 'HUSTLED!', sub: e.text }, 2000);
    else if (e.kind === 'gotShot') add({ id: e.id, kind: e.kind, text: e.sub ? (e.text ?? 'GOT SHOT') : 'GOT SHOT', sub: e.sub ?? e.text }, 1900);
    else if (e.kind === 'jokerLittle' || e.kind === 'jokerBig') { setPulse({ id: e.id, big: e.kind === 'jokerBig' }); window.setTimeout(() => setPulse((p) => (p?.id === e.id ? null : p)), e.kind === 'jokerBig' ? 1100 : 500); }
    else if (e.kind === 'nuke') {
      const c = trickCenter();
      setNuke({ id: e.id, ...c, mode: fx.nukeMode });
      const id = e.id;
      if (!canvasOwnsBlast()) {
        window.setTimeout(() => setNuke((n) => (n?.id === id ? null : n)), 3700);
        return;
      }
      cancelAnimationFrame(nukeWatch.current);
      const watch = () => {
        const b = getBurst();
        if (!b || (fx.warp === null && b.elapsed >= BLAST_MS)) {
          setNuke((n) => (n?.id === id ? null : n));
          return;
        }
        nukeWatch.current = requestAnimationFrame(watch);
      };
      nukeWatch.current = requestAnimationFrame(watch);
    }
    });
    return () => { off(); cancelAnimationFrame(nukeWatch.current); };
  }, []);


  // HUD jolt (the 3D camera shakes separately)
  useEffect(() => {
    if (reduced) return;
    // The detonation overlay owns the nuke shake. A CSS jolt on top of it double-shakes the table.
    const big = nuke ? null : pulse?.big ? 'jolt-big' : pulse ? 'jolt-small' : null;
    if (!big) return;
    const el = document.querySelector('.table-screen');
    el?.classList.add(big);
    const t = window.setTimeout(() => el?.classList.remove(big), big === 'jolt-big' ? 900 : 350);
    return () => { clearTimeout(t); el?.classList.remove(big); };
  }, [nuke, pulse, reduced]);

  return (
    <div className="hype-layer" aria-live="polite" data-testid="hype">
      <PulsePlate reduced={reduced} />
      <JokerBurst />
      {pulse && <div key={pulse.id} className={`joker-pulse ${pulse.big ? 'big' : ''}`} data-testid="joker-pulse" />}
      {nuke && !canvasOwnsBlast() && (
        <div key={`b${nuke.id}`} className={`nuke-banner ${nuke.mode === 'off' || reduced ? 'calm' : ''}`} data-testid="nuke" onClick={() => setNuke(null)}>
          <div className="nb-title" data-text="☢ NUKED ☢">☢ NUKED ☢</div>
          <div className="nb-sub">Big Joker over Little Joker</div>
        </div>
      )}
      {spark && <div key={`s${spark.id}`} className={`overcut-spark lvl${spark.level}`} style={{ left: spark.x, top: spark.y }} data-testid="overcut-spark"><i /><i /><i /><i /><i /><i /><i /><i /></div>}
      {car && <WheelsCelebration key={car.id} id={car.id} who={car.who} reduced={reduced} low={low} onDone={() => { fx.carRelease?.(); fx.carRelease = null; setCar((c) => (c?.id === car.id ? null : c)); }} />}
      {pops.map((p) => (
        <div key={p.id} className={`hype-pop ${p.kind} lvl${p.level ?? 0}`} data-testid={`pop-${p.kind}`} role="status">
          <span className="hype-text">{p.text}</span>
          {p.sub && <span className="hype-sub">{p.sub}</span>}
        </div>
      ))}
    </div>
  );
}
