import { useEffect, useRef } from 'react';

/** Host for the draped sheet. The warmed canvas is moved in here; the sim stays off the first script. */
export function SheetCloth({ wait }: { wait: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop = () => {};
    let dead = false;
    void import('./sheetClothSim').then((m) => {
      if (dead || !host.current) return;
      stop = m.mountSheet(host.current, wait);
    });
    return () => { dead = true; stop(); };
  }, [wait]);
  return <div ref={host} className="cloth-host" data-testid="sheet-cloth" />;
}
