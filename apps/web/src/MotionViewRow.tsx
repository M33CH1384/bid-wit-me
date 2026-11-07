import { useEffect, useState } from 'react';
import { fx, useReduceEffects } from './fx';
import { enableMotionSensors, type MotionEnableResult } from './motionView';

/**
 * Settings sheet row: "Motion view" (owner, 2026-11-07). Lives in the
 * Look & effects group beside Reduce effects. Self-managing like the
 * other SoundControls rows (no import cycle with MoreOptions).
 *
 * Turning it ON runs the sensor permission flow FIRST, from this very
 * tap (iOS grants motion access only inside a user gesture): the stored
 * setting flips on only on a grant with a live sensor behind it. A
 * denial or a sensorless device keeps it OFF and says so in plain words
 * under the row. Turning it OFF is immediate and asks nothing.
 *
 * Reduce effects (the app's switch or the OS reduce-motion setting)
 * blocks enabling outright — a view that moves with the phone is exactly
 * what that setting calms — with the same plain note. A player who
 * already has it on can still turn it off while reduced.
 */
export function MotionViewRow({ value, onChange, enableFn }: {
  value: boolean;
  onChange: (v: boolean) => void;
  /** Injectable for tests; the real flow is enableMotionSensors. */
  enableFn?: () => Promise<MotionEnableResult>;
}) {
  const appReduced = useReduceEffects();
  const [osReduced, setOsReduced] = useState<boolean>(() => fx.osReducedMotion);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { mq = null; }
    if (!mq) return;
    const onChangeMq = () => setOsReduced(mq!.matches);
    onChangeMq();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChangeMq);
    return () => { if (typeof mq!.removeEventListener === 'function') mq!.removeEventListener('change', onChangeMq); };
  }, []);

  const reduced = appReduced || osReduced;
  const blocked = reduced && !value;
  const enable = enableFn ?? (async () => enableMotionSensors());

  const onToggle = async () => {
    if (value) {
      setNote(null);
      onChange(false);
      return;
    }
    if (blocked || busy) return;
    setBusy(true);
    try {
      const r = await enable();
      if (r === 'granted') {
        setNote(null);
        onChange(true);
      } else if (r === 'denied') {
        setNote('Motion access was denied — Motion view stayed off.');
      } else {
        setNote('No motion sensor found on this device.');
      }
    } catch {
      setNote('No motion sensor found on this device.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="sf-row">
      <span>
        Motion view
        <small className="sf-note">
          {' · lean your phone to tilt the table, push or pull it to zoom'}
          {blocked ? ' — off while Reduce effects is on' : note ? ` — ${note}` : ''}
        </small>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label="Motion view"
        data-testid="motion-view"
        className={`switch ${value ? 'on' : ''}`}
        disabled={blocked || busy}
        onClick={() => { void onToggle(); }}
      >
        <i />
      </button>
    </label>
  );
}

export default MotionViewRow;
