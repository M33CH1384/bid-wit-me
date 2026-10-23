import { useEffect, useRef, useState } from 'react';
import { type FxEvent, type NukeIntensity, fx } from './fx';
import { WheelsCelebration } from './WheelsCar';

/**
 * Full-screen hype overlay: streak pop-ups, joker vignette pulses and the Big-over-Little nuke.
 * A set is not a banner here — the scorecard panel takes the shotgun blast.
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

export default function Hype({ reduced, low = false }: { reduced: boolean; low?: boolean }) {
  const [car, setCar] = useState<{ id: number; who: string } | null>(null);
  const [spark, setSpark] = useState<{ id: number; x: number; y: number; level: number } | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [nuke, setNuke] = useState<{ id: number; x: number; y: number; mode: NukeIntensity } | null>(null);
  const [mega, setMega] = useState<{ id: number; x: number; y: number; mode: NukeIntensity } | null>(null);
  const [pulse, setPulse] = useState<{ id: number; big: boolean } | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => fx.on((e) => {
    const add = (p: Pop, ms: number) => { setPops((ps) => [...ps.filter((x) => x.kind !== p.kind), p]); window.setTimeout(() => setPops((ps) => ps.filter((x) => x.id !== p.id)), ms); };
    if (e.kind === 'streak') add({ id: e.id, kind: e.kind, text: e.text ?? 'HEAT CHECK', sub: e.sub ?? `${e.level} hands in a row`, level: e.level }, 2300);
    else if (e.kind === 'shot' || e.kind === 'gotShot') { /* scorecard panel blast; no full-screen banner */ }
    else if (e.kind === 'overcut') {
      const lvl = (e.level ?? 2) >= 3 ? 3 : 2;
      add({ id: e.id, kind: e.kind, text: e.text ?? 'SAY LESS!', level: lvl }, lvl === 3 ? 1700 : 1300);
      if (!reducedRef.current) { const c = lastTrickCard(); setSpark({ id: e.id, level: lvl, ...c }); window.setTimeout(() => setSpark((s) => (s?.id === e.id ? null : s)), lvl === 3 ? 800 : 600); }
    }
    else if (e.kind === 'wheelsCar') setCar({ id: e.id, who: e.text ?? '' });
    else if (e.kind === 'wheels') add({ id: e.id, kind: e.kind, text: 'WHEELS!', sub: e.sub ?? e.text }, 1900);
    else if (e.kind === 'ranIt') add({ id: e.id, kind: e.kind, text: e.text ?? 'RAN IT!', sub: e.sub }, 2700);
    else if (e.kind === 'hustled') add({ id: e.id, kind: e.kind, text: 'HUSTLED!', sub: e.text }, 2000);
    else if (e.kind === 'jokerLittle' || e.kind === 'jokerBig') { setPulse({ id: e.id, big: e.kind === 'jokerBig' }); window.setTimeout(() => setPulse((p) => (p?.id === e.id ? null : p)), e.kind === 'jokerBig' ? 1100 : 500); }
    else if (e.kind === 'nuke') {
      const c = trickCenter();
      setNuke({ id: e.id, ...c, mode: fx.nukeMode });
      window.setTimeout(() => setNuke((n) => (n?.id === e.id ? null : n)), 3700);
    }
    else if (e.kind === 'mega') {
      // ☢☢ the both-Jokers run: the nuke's banner treatment, one size up, held for the longer blast
      const c = trickCenter();
      setMega({ id: e.id, ...c, mode: fx.nukeMode });
      window.setTimeout(() => setMega((n) => (n?.id === e.id ? null : n)), 4400);
    }
  }), []);


  // HUD jolt (the 3D camera shakes separately)
  useEffect(() => {
    if (reduced) return;
    const big = (nuke && nuke.mode !== 'off') || (mega && mega.mode !== 'off') ? 'jolt-nuke' : pulse?.big ? 'jolt-big' : pulse ? 'jolt-small' : null;
    if (!big) return;
    const el = document.querySelector('.table-screen');
    el?.classList.add(big);
    const t = window.setTimeout(() => el?.classList.remove(big), big === 'jolt-nuke' ? (mega ? 1900 : 1500) : big === 'jolt-big' ? 900 : 350);
    return () => { clearTimeout(t); el?.classList.remove(big); };
  }, [nuke, mega, pulse, reduced]);

  return (
    <div className="hype-layer" aria-live="polite" data-testid="hype">
      {pulse && <div key={pulse.id} className={`joker-pulse ${pulse.big ? 'big' : ''}`} data-testid="joker-pulse" />}
      {nuke && (
        <>
          {!reduced && nuke.mode !== 'off' && <div key={`f${nuke.id}`} className="nuke-flash" data-testid="nuke-flash" />}
          <div key={`b${nuke.id}`} className={`nuke-banner ${nuke.mode === 'off' || reduced ? 'calm' : ''}`} data-testid="nuke" onClick={() => setNuke(null)}>
            <div className="nb-title" data-text="☢ NUKED ☢">☢ NUKED ☢</div>
            <div className="nb-sub">Big Joker over Little Joker</div>
          </div>
        </>
      )}
      {mega && (
        <>
          {!reduced && mega.mode !== 'off' && <div key={`f${mega.id}`} className="nuke-flash mega-flash" data-testid="mega-flash" />}
          <div key={`b${mega.id}`} className={`nuke-banner mega-banner ${mega.mode === 'off' || reduced ? 'calm' : ''}`} data-testid="mega" onClick={() => setMega(null)}>
            <div className="nb-title" data-text="☢☢ ANNIHILATION ☢☢">☢☢ ANNIHILATION ☢☢</div>
            <div className="nb-sub">Ran it with BOTH Jokers</div>
          </div>
        </>
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
