/**
 * Story scene player — the cinematic sit-down (scene pass, 2026-10-21).
 * A scene, not a line picker: letterbox bars, the stop's venue backdrop
 * behind the cast, every character presented as a medallion (name + role),
 * the current speaker lit and the rest dimmed, lines revealed at reading
 * pace (tap completes, tap again advances), and each line spoken by its
 * character's pinned voice through the existing voice system while the
 * venue's audio identity plays underneath.
 *
 * Hidden things live here too (storySecrets): a sceneTap egg is a quiet
 * hotspot in the backdrop; a deeTap egg fires after three taps on Dee's
 * medallion; a chain egg prepends its beats when the parent says the
 * carried fact is in hand. Found eggs insert their secret beats into the
 * scene in place — discovery feels like the scene opening a side door.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { STORY_CHARACTERS, personaForName, type StoryBeat } from '@spades/bots';
import { sound } from '../audio';
import { speakBot } from '../talkPrefs';
import StoryFace from './StoryFace';
import { useReduceEffects } from '../fx';
import type { SeatPos } from '../spatial';

export function speakerName(speaker: string): string {
  if (speaker === 'you') return 'You';
  return STORY_CHARACTERS[speaker]?.name ?? speaker;
}

export function speakerRole(speaker: string): string {
  if (speaker === 'you') return 'That’s you. The one running the route.';
  return STORY_CHARACTERS[speaker]?.role ?? '';
}

export function speakerBlurb(speaker: string): string {
  if (speaker === 'you') return 'That’s you. The one running the route.';
  return STORY_CHARACTERS[speaker]?.blurb ?? '';
}

export interface SceneEgg {
  trigger: 'sceneTap' | 'deeTap' | 'chain';
  /** chain: the carried fact is in hand, so the egg beats play */
  ready: boolean;
  beats: StoryBeat[];
}

function seatPosFor(speaker: string, cast: string[]): SeatPos | undefined {
  const ix = cast.indexOf(speaker);
  if (ix < 0) return undefined;
  return (['left', 'top', 'right'] as SeatPos[])[ix];
}

export default function ScriptPlayer({ beats, cta, onDone, venueId, cast = [], egg, onEggFound, rail = [] }: {
  beats: StoryBeat[];
  /** label of the final advance button */
  cta: string;
  onDone: () => void;
  venueId?: string;
  /** character ids in cast order (pair, Dee, pair) for the cast strip */
  cast?: string[];
  egg?: SceneEgg | null;
  onEggFound?: () => void;
  /** railbird character ids standing on the rail at this stop (storyRail) */
  rail?: string[];
}) {
  const reduceFx = useReduceEffects();
  const chainReady = !!(egg?.trigger === 'chain' && egg.ready);
  const queue = useMemo(
    () => (chainReady && egg ? [...egg.beats, ...beats] : beats),
    [beats, egg, chainReady],
  );
  const [extra, setExtra] = useState<StoryBeat[]>([]);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const lines = useMemo(() => {
    if (insertAt === null) return queue;
    const out = [...queue];
    out.splice(insertAt, 0, ...extra);
    return out;
  }, [queue, extra, insertAt]);

  const [i, setI] = useState(0);
  const [shown, setShown] = useState(reduceFx ? Number.MAX_SAFE_INTEGER : 0);
  const beat = lines[Math.min(i, lines.length - 1)];
  const eggFired = useRef(false);
  const deeTaps = useRef(0);

  // chain egg: being shown at all means it was found
  useEffect(() => {
    if (chainReady && !eggFired.current) { eggFired.current = true; onEggFound?.(); }
  }, [chainReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const fireEgg = () => {
    if (!egg || eggFired.current) return;
    eggFired.current = true;
    setExtra(egg.beats);
    setInsertAt(i + 1);
    onEggFound?.();
  };

  // line reveal pacing + voice for the current beat
  useEffect(() => {
    if (!beat) return;
    setShown(reduceFx ? Number.MAX_SAFE_INTEGER : 0);
    if (beat.speaker !== 'you') {
      const name = speakerName(beat.speaker);
      speakBot(name, beat.line, personaForName(name), undefined, undefined, seatPosFor(beat.speaker, cast));
    }
    if (reduceFx) return;
    const total = beat.line.length;
    const stepMs = Math.max(14, Math.min(30, Math.floor(900 / Math.max(1, total))));
    const t = window.setInterval(() => setShown((s) => {
      if (s >= total) { window.clearInterval(t); return s; }
      return s + 1;
    }), stepMs);
    return () => window.clearInterval(t);
  }, [i, lines]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving the scene stops its voices
  useEffect(() => () => {
    try { sound.stopVoice(); } catch { /* ignore */ }
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }, []);

  if (!beat) { onDone(); return null; }
  const last = i >= lines.length - 1;
  const revealing = shown < beat.line.length;
  const name = speakerName(beat.speaker);
  const advance = () => {
    if (revealing) { setShown(Number.MAX_SAFE_INTEGER); return; }
    if (!last) setI(i + 1);
  };
  const onMedallion = (id: string) => {
    if (id !== 'dee' || egg?.trigger !== 'deeTap') return;
    deeTaps.current += 1;
    if (deeTaps.current >= 3) fireEgg();
  };

  return (
    <div className={`story-scene${reduceFx ? ' reduce' : ''}`} data-testid="story-script">
      {venueId && <div className="story-scene-bg" style={{ backgroundImage: `url(/assets/venues/${venueId}/bg.jpg)` }} aria-hidden />}
      <div className="story-bar top" aria-hidden />
      <div className="story-bar bottom" aria-hidden />
      <div className="story-scene-inner">
        <div className="story-cast" role="list" aria-label="At this table">
          {cast.map((id) => {
            const c = STORY_CHARACTERS[id];
            if (!c) return null;
            const active = beat.speaker === id;
            return (
              <button
                type="button" key={id} role="listitem"
                className={`story-cast-one${active ? ' active' : ' dim'}`}
                data-testid={`story-cast-${id}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => onMedallion(id)}
                aria-label={`${c.name} — ${c.role}`}
              >
                <StoryFace characterId={id} name={c.name} className="cast-face" />
                <span className="story-cast-name">{c.name}</span>
                <span className="story-cast-role">{c.role}</span>
              </button>
            );
          })}
        </div>
        {rail.length > 0 && (
          <div className="story-rail" data-testid="story-rail" aria-label="On the rail">
            <span className="story-rail-label">On the rail</span>
            <span className="story-rail-faces">
              {rail.map((id) => {
                const c = STORY_CHARACTERS[id];
                return c ? <StoryFace key={id} characterId={id} name={c.name} className="rail-face" /> : null;
              })}
            </span>
          </div>
        )}
        <div className="story-script-card" onClick={advance} role={last ? undefined : 'button'} aria-label={last ? undefined : 'Next line'}>
          {beat.speaker !== 'you' && STORY_CHARACTERS[beat.speaker]
            ? <StoryFace characterId={beat.speaker} name={name} className="speaker-face" />
            : <div className="story-script-face" aria-hidden>{name.slice(0, 1)}</div>}
          <div className="story-script-body">
            <p className="story-script-name">{name}{speakerRole(beat.speaker) ? <span className="story-script-role"> · {speakerRole(beat.speaker)}</span> : null}</p>
            <p className="story-script-line">{revealing ? beat.line.slice(0, shown) : beat.line}</p>
            <p className="story-script-hint">{last ? '' : revealing ? 'Tap for the full line' : 'Tap to continue'}</p>
          </div>
        </div>
        <div className="story-script-actions">
          <button type="button" className="btn ghost" data-testid="story-script-skip" onClick={onDone}>Skip</button>
          {last
            ? <button type="button" className="btn primary" data-testid="story-script-done" onClick={onDone}>{cta}</button>
            : <button type="button" className="btn primary" data-testid="story-script-next" onClick={advance}>Next</button>}
        </div>
      </div>
      {egg?.trigger === 'sceneTap' && !eggFired.current && (
        <button type="button" className="story-hotspot" data-testid="story-egg-hotspot" aria-label="Something here catches your eye" onClick={fireEgg} />
      )}
    </div>
  );
}
