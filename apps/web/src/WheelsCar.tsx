import { useEffect, useRef, useState } from 'react';
import { fx } from './fx';
import { wheelsBlastReaction } from './wheelsDonuts';

/**
 * Wheels celebration (~2.5 s, non-blocking, tap the banner to skip): the
 * "WHEELS!" banner with the team / player name, under the same `wheelsCar`
 * summons as always (a side taking all 10 books) and the same rev-then-peel
 * sound (the fx bus plays it). The CAR itself is a real 3D body in the scene
 * now (three/WheelsCar3D.tsx, High quality): it does its doughnuts on the
 * felt in world space, and a nuke/mega detonating mid-show blows it off the
 * table in 3D too. This DOM layer keeps what every quality path shares — the
 * banner, the show's timing, and the hand-end hold release (fx.carRelease).
 * At Low quality, under Reduce effects, or under OS reduce-motion there is
 * no car visual: banner + audio only. If a detonation claims the car, the
 * banner dies with it and the end timer defers once so the sweep plays out.
 */
export const CAR_MS = 2500;

export function WheelsCelebration({ id, who, reduced, onDone }: { id: number; who: string; reduced: boolean; low?: boolean; onDone: () => void }) {
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
  // set when a detonation claims the car mid-show; the end timer below defers
  // once so the 3D sweep gets to play out instead of ending the celebration.
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
    if (reduced) return;
    const off = fx.on((e) => {
      if (e.kind !== 'nuke' && e.kind !== 'mega') return;
      const r = wheelsBlastReaction(e.kind, fx.nukeMode);
      if (r === 'none' || sweepRef.current) return;
      sweepRef.current = { at: e.at, mega: r === 'mega-swept' };
      setBlasted(true);
    });
    return () => { off(); };
  }, [id, reduced]);

  const skip = () => {
    (window as unknown as { __bwmWheelsSkip?: () => void }).__bwmWheelsSkip?.();
    finishRef.current();
  };
  return (
    <div className={`wheels-fx ${gone ? 'gone' : ''}`} data-testid="wheels-fx">
      {!blasted && (
        <div className="hype-pop wheels-banner" role="status" onClick={skip} data-testid="pop-wheelsCar">
          <span className="hype-text">WHEELS!</span>
          <span className="hype-sub">{who}</span>
        </div>
      )}
    </div>
  );
}
