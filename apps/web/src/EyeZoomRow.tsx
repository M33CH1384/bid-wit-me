import { useEffect, useState, useSyncExternalStore } from 'react';
import { fx, useReduceEffects } from './fx';
import {
  enableEyeCamera, getEyeZoomNote, subscribeEyeZoomNote, type EyeEnableResult,
} from './eyeZoom';

/**
 * Settings sheet row: "Eye zoom" (owner, 2026-11-07). Lives in the Look
 * & effects group beside Motion view. Self-managing like the other
 * SoundControls rows (no import cycle with MoreOptions).
 *
 * Turning it ON probes the front camera FIRST, from this very tap (the
 * probe stream is stopped again immediately; the table's driver opens
 * its own when it runs). A denial or a missing camera keeps it OFF and
 * says so in plain words under the row. Turning it OFF is immediate.
 *
 * On but not yet calibrated: the row says so and offers Calibrate —
 * the two-step setup runs over the table (this row only raises the
 * request; the table opens the overlay). Afterwards the same button
 * reads Recalibrate.
 *
 * Reduce effects (the app's switch or the OS reduce-motion setting)
 * blocks enabling outright — a view that zooms on its own is exactly
 * what that setting calms — with the same plain note Motion view uses.
 */
export function EyeZoomRow({ value, calibrated, onChange, onCalibrate, enableFn }: {
  value: boolean;
  calibrated: boolean;
  onChange: (v: boolean) => void;
  onCalibrate: () => void;
  /** Injectable for tests; the real flow is enableEyeCamera. */
  enableFn?: () => Promise<EyeEnableResult>;
}) {
  const appReduced = useReduceEffects();
  const [osReduced, setOsReduced] = useState<boolean>(() => fx.osReducedMotion);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runtimeNote = useSyncExternalStore(subscribeEyeZoomNote, getEyeZoomNote, getEyeZoomNote);

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
  const enable = enableFn ?? (async () => enableEyeCamera());

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
        setNote('Camera access was denied — Eye zoom stayed off.');
      } else {
        setNote('No camera found on this device.');
      }
    } catch {
      setNote('No camera found on this device.');
    } finally {
      setBusy(false);
    }
  };

  const suffix = blocked
    ? ' — off while Reduce effects is on'
    : note
      ? ` — ${note}`
      : value && runtimeNote
        ? ` — ${runtimeNote}`
        : value && !calibrated
          ? ' — needs calibration'
          : '';

  return (
    <label className="sf-row">
      <span>
        Eye zoom
        <small className="sf-note">
          {' · the camera reads your eyes to zoom — the reading never leaves your phone'}
          {suffix}
        </small>
        {value && (
          <button
            type="button"
            className="link eye-zoom-cal-btn"
            data-testid="eye-zoom-calibrate"
            onClick={(e) => { e.preventDefault(); onCalibrate(); }}
          >
            {calibrated ? 'Recalibrate' : 'Calibrate'}
          </button>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label="Eye zoom"
        data-testid="eye-zoom"
        className={`switch ${value ? 'on' : ''}`}
        disabled={blocked || busy}
        onClick={() => { void onToggle(); }}
      >
        <i />
      </button>
    </label>
  );
}

export default EyeZoomRow;
