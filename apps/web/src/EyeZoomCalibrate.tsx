import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  EYE_CAL_MIN_SAMPLES, EYE_CAL_STEP_MS, computeCalibration, setEyeCalibrating,
  type EyeGazeCalibration, type EyeGazeSessionLike,
} from './eyeZoom';
import { importChunk } from './chunkLoad';

/**
 * Eye zoom calibration (owner, 2026-11-07): the two-step setup, hosted by
 * the table AND by the Settings row (which runs it in place, over whatever
 * screen is showing). "Look at your cards" samples the player's downward gaze
 * for a second; "Look at the table" samples the level gaze; the pair
 * becomes the player's personal zone threshold, saved in settings on this
 * device only. The screen itself draws a simulated table (owner,
 * 2026-11-08) — felt mid-screen, fan low and centred, the step's target
 * lit — so each look lands where the real thing sits in a game, even when
 * calibrating from Settings where no table exists.
 * While it runs it owns the camera — the gaze driver rests
 * (the calibrating flag), and the stream closes the moment it finishes
 * or is cancelled.
 *
 * A step that can't collect enough readable samples — or a pair of looks
 * that read too much alike — is an honest error with a retry, never a
 * silently stored bad calibration.
 */
type Phase = 'cards' | 'table' | 'done' | 'error';
type ErrorKind = 'samples' | 'degenerate' | 'camera';

const TICK_MS = 100;

/** The simulated fan's arc (owner, 2026-11-08): seven cards rolled to the
 *  real hand's roll cap (0.2 rad ≈ 11.5°, three/layout.ts PHONE_HAND_ROLL),
 *  the outer cards riding a touch lower, like a held fan. */
const FAN_CARDS: readonly { tilt: number; lift: number }[] = [
  { tilt: -11, lift: 10 }, { tilt: -7.5, lift: 4.5 }, { tilt: -3.5, lift: 1 },
  { tilt: 0, lift: 0 },
  { tilt: 3.5, lift: 1 }, { tilt: 7.5, lift: 4.5 }, { tilt: 11, lift: 10 },
];

async function defaultSessionFactory(): Promise<EyeGazeSessionLike> {
  const m = await importChunk(() => import('./eyeGazeSession'));
  return m.createEyeGazeSession();
}

export function EyeZoomCalibrate({ onCalibrated, onClose, sessionFactory, doneLabel }: {
  onCalibrated: (cal: EyeGazeCalibration) => void;
  onClose: () => void;
  /** Injectable for tests; the real session is eyeGazeSession.ts (lazy). */
  sessionFactory?: () => EyeGazeSessionLike | Promise<EyeGazeSessionLike>;
  /** The done button's words: the table host keeps the default; a host with
   *  no table on screen (the Settings row) passes plainer words. */
  doneLabel?: string;
}) {
  const [phase, setPhase] = useState<Phase>('cards');
  const [errorKind, setErrorKind] = useState<ErrorKind>('samples');
  const [progress, setProgress] = useState(0);

  const phaseRef = useRef<Phase>('cards');
  const samplesRef = useRef<number[]>([]);
  const cardsRef = useRef<number[]>([]);
  const stepStartRef = useRef<number>(Date.now());
  const sessionRef = useRef<EyeGazeSessionLike | null>(null);
  const sessionLiveRef = useRef(false);
  const startingRef = useRef(false);
  const factoryRef = useRef(sessionFactory ?? defaultSessionFactory);
  const onCalibratedRef = useRef(onCalibrated);
  onCalibratedRef.current = onCalibrated;

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const stopSession = () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    sessionLiveRef.current = false;
    if (s) { try { s.stop(); } catch { /* ignore */ } }
  };

  const startSession = async () => {
    if (sessionLiveRef.current || startingRef.current) return;
    startingRef.current = true;
    try {
      const s = await factoryRef.current();
      sessionRef.current = s;
      await s.start((gazeV) => {
        if (gazeV === null) return;
        const p = phaseRef.current;
        if (p === 'cards' || p === 'table') samplesRef.current.push(gazeV);
      });
      sessionLiveRef.current = true;
    } catch {
      sessionRef.current = null;
      sessionLiveRef.current = false;
      setErrorKind('camera');
      setPhaseBoth('error');
    } finally {
      startingRef.current = false;
    }
  };

  const beginStep = (p: 'cards' | 'table') => {
    samplesRef.current = [];
    stepStartRef.current = Date.now();
    setProgress(0);
    setPhaseBoth(p);
  };

  const finalizeStep = () => {
    const p = phaseRef.current;
    if (p !== 'cards' && p !== 'table') return;
    const samples = samplesRef.current;
    if (samples.length < EYE_CAL_MIN_SAMPLES) {
      setErrorKind('samples');
      setPhaseBoth('error');
      return;
    }
    if (p === 'cards') {
      cardsRef.current = samples;
      beginStep('table');
      return;
    }
    const cal = computeCalibration(cardsRef.current, samples);
    if (!cal) {
      setErrorKind('degenerate');
      setPhaseBoth('error');
      return;
    }
    stopSession();
    setPhaseBoth('done');
    onCalibratedRef.current(cal);
  };

  useEffect(() => {
    setEyeCalibrating(true);
    void startSession();
    stepStartRef.current = Date.now();
    const timer = setInterval(() => {
      const p = phaseRef.current;
      if (p !== 'cards' && p !== 'table') return;
      const el = Date.now() - stepStartRef.current;
      setProgress(Math.min(1, el / EYE_CAL_STEP_MS));
      if (el >= EYE_CAL_STEP_MS) finalizeStep();
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      stopSession();
      setEyeCalibrating(false);
    };
    // Mount-only: the flow is driven by refs + the tick from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    cardsRef.current = [];
    beginStep('cards');
    if (!sessionLiveRef.current) void startSession();
  };

  const cancel = () => {
    stopSession();
    onClose();
  };

  const sampling = phase === 'cards' || phase === 'table';

  return (
    <div className={`modal-backdrop eye-cal-backdrop${sampling ? ' eye-cal-live' : ''}`} data-testid="eye-zoom-calibrate" role="dialog" aria-label="Eye zoom setup">
      {sampling && (
        /* The simulated table (owner, 2026-11-08): something real for each
           look to land on — a felt mid-screen and the player's fan low and
           centred, in the proportions of the real table view — with the
           current step's target lit and the other at rest. Decorative: the
           prompts above remain the instructions. */
        <div className="eye-cal-sim" data-testid="eye-cal-sim" data-step={phase} aria-hidden="true">
          <div className={`eye-cal-sim-table${phase === 'table' ? ' lit' : ''}`} data-testid="eye-cal-sim-table">
            <i className="eye-cal-sim-centre" />
          </div>
          <div className={`eye-cal-sim-fan${phase === 'cards' ? ' lit' : ''}`} data-testid="eye-cal-sim-fan">
            {FAN_CARDS.map((c) => (
              <i
                key={c.tilt}
                className="eye-cal-sim-card"
                style={{ '--tilt': `${c.tilt}deg`, '--lift': `${c.lift}px` } as CSSProperties}
              />
            ))}
          </div>
        </div>
      )}
      <div className="modal glass slant eye-cal-card">
        {phase === 'done' ? (
          <>
            <h3 data-testid="eye-cal-done">Eye zoom is set</h3>
            <p>Look at your cards to open the view up; look at the table to zoom in close.</p>
            <button type="button" className="primary big" onClick={onClose}>{doneLabel ?? 'Back to the table'}</button>
          </>
        ) : phase === 'error' ? (
          <>
            <h3>That didn&apos;t read</h3>
            <p>
              {errorKind === 'camera'
                ? 'The camera didn’t start. Check it isn’t busy in another app, then try again.'
                : errorKind === 'degenerate'
                  ? 'Your two looks read too much alike. Try again — really settle your eyes on your cards, then on the middle of the table.'
                  : 'We couldn’t see your eyes well enough. Hold the phone up a little and give it another go in good light.'}
            </p>
            <button type="button" className="primary big" data-testid="eye-cal-retry" onClick={retry}>Try again</button>
            <button type="button" className="link" data-testid="eye-cal-cancel" onClick={cancel}>Cancel</button>
          </>
        ) : (
          <>
            <h3 data-testid="eye-cal-step">{phase === 'cards' ? 'Look at your cards' : 'Look at the table'}</h3>
            <p>{phase === 'cards' ? 'Settle your eyes on your hand, like you’re studying what to play.' : 'Now settle your eyes on the middle of the table.'}</p>
            <div className="eye-cal-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <button type="button" className="link" data-testid="eye-cal-cancel" onClick={cancel}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

export default EyeZoomCalibrate;
