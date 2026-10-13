import { useEffect, useRef } from 'react';

/** Canvas for the draped sheet. The three.js sim loads on demand so the first script stays light. */
export function SheetCloth({ wait }: { wait: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let stop = () => {};
    let dead = false;
    void import('./sheetClothSim').then((m) => {
      if (dead) { return; }
      stop = m.mountSheet(canvas, wait);
    });
    return () => { dead = true; stop(); };
  }, [wait]);
  return <canvas ref={ref} className="cloth" data-testid="sheet-cloth" />;
}
