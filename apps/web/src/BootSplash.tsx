import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { sound } from './audio';
import { claimBootSplash, markBootRevealed, planBootSplash, SPLASH_SLAM_MS } from './bootSplash';
import { fx } from './fx';

type Phase = 'show' | 'armed' | 'fading' | 'done';

/**
 * The boot splash gate (owner, 2026-11-04): wraps the home surface on a
 * cold open only. The splash is one whole-surface button — "Touch to
 * begin" — and the tap is the audio unlock: the engine's splash entry
 * point wakes in-gesture and fires the sting; the gate pre-drops the home
 * surface to the fade's floor the moment the tap lands (so it can never
 * flash at full strength when the splash lifts), fades it 0.14 → 0.88
 * across the sting's shuffle, and snaps it to full at the slam, where the
 * splash unmounts and input goes live.
 *
 * Straight-in paths: sound off (the boot gate) or reduced motion → the
 * tap dismisses the splash at full strength, no sting, no fade. Audio
 * that never comes up also lands there (fail open to the app, never a
 * stuck splash). The claim lives in bootSplash.ts: one decision per app
 * session (sessionStorage-backed), so resume / route changes / back-nav
 * — and same-session reloads — never re-show it.
 *
 * It wraps Setup from App rather than living inside it so the wizard's
 * own render stays exactly what the theme-parity guardrail inventories;
 * the gate's only child surface is the wizard root.
 */
export default function BootSplashGate({ children }: { children: ReactNode }) {
  const [plan] = useState(() => planBootSplash({
    claimed: !claimBootSplash(),
    reducedMotion: fx.osReducedMotion || fx.reduced,
    stingAudible: sound.stingAudible(),
  }));
  const [phase, setPhase] = useState<Phase>(plan.show ? 'show' : 'done');
  const busy = useRef(false);

  // Sting mode only: hold the menu music at the engine until the slam.
  // The tap that dismisses this splash is also the engine's first
  // unlock, and its wake would otherwise start the music from the same
  // gesture (the owner's verdict on the first ship: "the menu music
  // plays immediately with no shuffle"). Armed at mount, before any
  // tap can land; the cleanup is the guarantee that no unmount can
  // strand the hold — the engine's own backstop is the second one.
  useEffect(() => {
    if (!plan.show || plan.mode !== 'sting') return;
    sound.armStingHold();
    return () => { sound.releaseStingHold(); };
  }, [plan]);

  // The reveal mark (bootSplash.ts): Home is visible the moment this
  // gate is done — on the sting path that is the slam timeout itself
  // (the same beat that releases the sting hold), on the straight-in
  // paths it is mount/tap. The home streak entrance waits on this
  // mark, so it can never start under the splash or against the sting.
  useEffect(() => {
    if (phase === 'done') markBootRevealed();
  }, [phase]);

  const begin = () => {
    if (busy.current || phase !== 'show') return;
    busy.current = true;
    if (plan.mode === 'instant') { setPhase('done'); return; }
    setPhase('armed');
    void (async () => {
      const fired = await Promise.race([
        sound.beginFromSplash(),
        new Promise<boolean>((res) => { window.setTimeout(() => res(false), 1500); }),
      ]);
      if (!fired) { sound.releaseStingHold(); setPhase('done'); return; }
      setPhase('fading');
      window.setTimeout(() => { sound.releaseStingHold(); setPhase('done'); }, SPLASH_SLAM_MS);
    })();
  };

  return (
    <div
      className="boot-gate"
      data-splash-reveal={phase}
      style={phase === 'fading' ? ({ '--splash-fade-ms': `${SPLASH_SLAM_MS}ms` } as CSSProperties) : undefined}
    >
      {children}
      {(phase === 'show' || phase === 'armed') && (
        <button type="button" className="boot-splash" data-testid="boot-splash" onClick={begin} aria-label="Touch to begin">
          <img className="boot-splash-logo" src="/assets/bwm-wordmark-white.svg" alt="" />
          <span className="boot-splash-prompt" aria-hidden="true">Touch to begin</span>
        </button>
      )}
      {phase === 'fading' && <div className="boot-splash-shield" aria-hidden="true" />}
    </div>
  );
}
