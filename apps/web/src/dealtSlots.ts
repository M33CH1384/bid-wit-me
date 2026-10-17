import { useEffect, useRef, useState } from 'react';
import { dealTimeline, dealtSlotCount } from './three/dealTimeline';

/** Fan slots that have left the deck. While a deal is running, this counts up on the deal clock.
 *  Once the deal is over, every slot is shown — a resumed hand was already dealt. */
export function useDealtSlots(dealing: boolean, spec: {
  speedK: number;
  players: number;
  dealer: number;
  seat: number;
  slots: number;
  handNo: number;
  /** seats still in (Cutthroat after an ejection); the deal goes around these only */
  live?: readonly number[];
}): number {
  const specRef = useRef(spec);
  specRef.current = spec;
  const [tick, setTick] = useState<{ handNo: number; count: number }>({ handNo: -1, count: 0 });

  useEffect(() => {
    if (!dealing) return;
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const s = specRef.current;
      const elapsed = (performance.now() - start) / 1000;
      const next = dealtSlotCount(elapsed, dealTimeline(s.speedK, s.players), s.players, s.seat, s.dealer, s.slots, s.live);
      setTick((prev) => (prev.handNo === s.handNo && prev.count === next ? prev : { handNo: s.handNo, count: next }));
      if (next < s.slots) raf = requestAnimationFrame(step);
    };
    setTick({ handNo: spec.handNo, count: 0 });
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [dealing, spec.handNo]);

  if (!dealing) return spec.slots;
  return tick.handNo === spec.handNo ? tick.count : 0;
}
