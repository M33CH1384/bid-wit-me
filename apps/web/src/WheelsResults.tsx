/**
 * THE WHEELS SHOW ON THE RESULTS PAGE (owner, 2026-11-04: "put the
 * wheels animation back on the results page given I can only hear it
 * now"). Table stashes the final hand's Wheels feat instead of firing
 * it into the covered table scene; this component is what the results
 * surface mounts when it presents with a feat stashed.
 *
 * The staging mirrors the table's exactly: the fx bus plays the
 * peel-out ITSELF on the live path, so here the show plays the same
 * cue directly — `sound.play('wheelsCar', { gain: 1 })`, untouched —
 * the same DOM banner (WheelsCelebration) pops over it, and at High
 * quality the roadster does its doughnuts on a small stage (the table
 * canvas sits UNDER the results overlay, which is why the car was
 * heard and not seen). Low / Reduce effects / OS reduce-motion keep
 * today's calm path: banner + audio, no stage.
 *
 * The overlay is transient and pointer-transparent (the banner keeps
 * its tap-to-skip): nothing on the results page moves, resizes or
 * waits for it — the XP slider and standings are live underneath.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { WheelsCelebration } from './WheelsCar';
import { sound } from './audio';
import { fx } from './fx';
import { importChunk } from './chunkLoad';
import { useTheme } from './theme';

interface StageProps { neon: boolean; onDone: () => void }

export function WheelsResultsShow({ who, quality, reduced, onDone }: {
  who: string;
  quality: 'high' | 'low';
  reduced: boolean;
  onDone: () => void;
}) {
  const theme = useTheme();
  const [Stage, setStage] = useState<ComponentType<StageProps> | null>(null);
  const [bannerDone, setBannerDone] = useState(false);
  const [stageDone, setStageDone] = useState(false);
  const playedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const wantStage = quality === 'high' && !reduced && !fx.osReducedMotion;

  /* The sound: the identical cue the bus fires on the live path, once,
   * at presentation. (A ref guard, not the deps array — a strict-mode
   * double effect must not double the peel-out.) */
  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    sound.play('wheelsCar', { gain: 1 });
  }, []);

  useEffect(() => {
    if (!wantStage) { setStageDone(true); return; }
    let alive = true;
    void importChunk(() => import('./three/WheelsStage3D'), { optional: 'wheels-stage' }).then(
      (m) => { if (alive) setStage(() => m.WheelsStage3D); },
      () => { if (alive) setStageDone(true); }, // a failed stage load degrades to banner + sound
    );
    return () => { alive = false; };
  }, [wantStage]);

  useEffect(() => {
    if (bannerDone && stageDone) onDoneRef.current();
  }, [bannerDone, stageDone]);

  return (
    <div className="wheels-results" data-testid="wheels-results">
      <WheelsCelebration id={1} who={who} reduced={reduced} onDone={() => setBannerDone(true)} />
      {Stage && (
        <div className="wheels-stage">
          <Stage neon={theme === 'neon'} onDone={() => setStageDone(true)} />
        </div>
      )}
    </div>
  );
}
