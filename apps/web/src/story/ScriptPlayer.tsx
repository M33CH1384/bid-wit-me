/**
 * Story scene player — the cinematic sit-down (scene pass, 2026-10-21).
 * A scene, not a line picker: letterbox bars, the stop's venue backdrop
 * behind the cast, every character presented as a medallion (name + role),
 * the current speaker lit and the rest dimmed, lines revealed at reading
 * pace (tap completes, tap again advances), and each line spoken by its
 * character's pinned voice through the existing voice system while the
 * venue's audio identity plays underneath.
 *
 * The layout never breathes (owner, 2026-10-21): the dialogue body's
 * height is RESERVED for the current beat's full text before typing
 * starts — measured off a hidden sizer that renders the whole beat at
 * the body's real width — so a revealing line changes nothing but the
 * words, and the box only ever changes height BETWEEN beats, smoothly.
 *
 * Hidden things live here too (storySecrets): a sceneTap egg is a quiet
 * hotspot in the backdrop; a deeTap egg fires after three taps on Dee's
 * medallion; a chain egg prepends its beats when the parent says the
 * carried fact is in hand. Found eggs insert their secret beats into the
 * scene in place — discovery feels like the scene opening a side door.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { STORY_CHARACTERS, personaForName, storyPortraitFor, type StoryBeat } from '@spades/bots';
import { sound } from '../audio';
import { cancelActiveSpeech } from '../audioSession';
import { setStoryVoiceScope, speakBot, spokenClipDurationMs } from '../talkPrefs';
import StoryFace from './StoryFace';
import KingGunArt from './KingGunArt';
import { PORCH_LIVING_MOOD, livingMoodVars, type LivingMood } from './storyLiving';
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

/**
 * The reserved dialogue-body height for the current beat: the hidden
 * sizer's fully-rendered height (header + FULL line + hint slot at the
 * body's real width, in the real typography). Zero means unmeasurable
 * (no layout yet — prerender, tests): reserve nothing and let the body
 * take its natural height rather than pinning a wrong number.
 */
export function reservedBodyHeight(sizer: { offsetHeight: number } | null | undefined): number {
  return sizer && sizer.offsetHeight > 0 ? sizer.offsetHeight : 0;
}

/**
 * The reveal's target when a beat HAS a recorded clip: the text
 * completes at ~92% of the clip's length, so the last words land as
 * they're heard instead of a finished line sitting on screen while
 * the voice is still mid-sentence (owner, 2026-10-21).
 */
export const CLIP_REVEAL_FRACTION = 0.925;

/**
 * The standing no-clip reveal time for a line of `total` chars: the
 * long-standing reading pace — a ~900 ms reveal, one char per step,
 * the step clamped to [14, 30] ms so short lines linger a beat and
 * long lines don't crawl. Beats with no recorded clip (text-only
 * under the voice fence) keep exactly this.
 */
export function fixedRevealMs(total: number): number {
  if (total <= 0) return 0;
  const stepMs = Math.max(14, Math.min(30, Math.floor(900 / Math.max(1, total))));
  return stepMs * total;
}

/** The typewriter's total run for a beat: clip-paced when a clip exists, the fixed reading pace when it doesn't. */
export function revealDurationMs(total: number, clipMs: number | null): number {
  return clipMs && clipMs > 0 ? Math.round(clipMs * CLIP_REVEAL_FRACTION) : fixedRevealMs(total);
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

/** The OS reduced-motion setting, read once at mount (guarded: some
 *  webviews lack matchMedia). The in-game Reduce effects toggle is
 *  reactive via useReduceEffects; this one only gates the living
 *  sample staging below. */
function osPrefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * One LARGE stage portrait for the living staging (sample, 2026-10-24):
 * the character's shipped portrait art standing in the frame, initial
 * letter behind it if the art ever fails — the StoryFace fallback
 * contract, at stage size. NOT a StoryFace: the medallion's
 * `story-face-<id>` testid belongs to the cast strip alone, and the
 * stage is decorative (aria-hidden at the container) beside it.
 */
function StageFace({ characterId, name }: { characterId: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="story-stage-face">
      <span className="story-stage-initial">{name.slice(0, 1)}</span>
      {!failed && (
        <img
          className="story-stage-img"
          src={storyPortraitFor(characterId)}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export default function ScriptPlayer({ beats, cta, onDone, bgUrl, cast = [], egg, onEggFound, rail = [], living = false, livingMood }: {
  beats: StoryBeat[];
  /** label of the final advance button */
  cta: string;
  onDone: () => void;
  /** the stop's own backdrop art (storyBackdropUrl) — never a raw venue bg */
  bgUrl?: string;
  /** character ids in cast order (pair, Dee, pair) for the cast strip */
  cast?: string[];
  egg?: SceneEgg | null;
  onEggFound?: () => void;
  /** railbird character ids standing on the rail at this stop (storyRail) */
  rail?: string[];
  /**
   * LIVING SCENE (sample at the Porch 2026-10-24; owner's pick
   * 2026-10-25 put it at EVERY stop): the pre-match intro staged
   * alive — the backdrop breathes (light play + drifting air) and the
   * seated pair stand LARGE in the frame with a slow idle drift, the
   * current speaker lit. Opt-in per call site; ONLY the two intro
   * call-site classes pass it (solo StoryHome intro + co-op StoryRoom
   * scene phase) — outros and the King finale never do, so they render
   * exactly as before. Collapses to the static staging whenever Reduce
   * effects or the OS reduced-motion setting is on. The beats, voices,
   * pacing and skip behavior are untouched either way. Visuals only:
   * the audio stays the cast recordings / text, per the voice fence.
   */
  living?: boolean;
  /**
   * The stop's motion character (storyLiving.ts): pacing + light as
   * data, consumed as --lv-* custom properties on the scene root.
   * Absent = the Porch mood, the shipped sample's own values.
   */
  livingMood?: LivingMood;
}) {
  const reduceFx = useReduceEffects();
  const [osReduced] = useState(osPrefersReducedMotion);
  const livingOn = living && !reduceFx && !osReduced;
  const mood = livingMood ?? PORCH_LIVING_MOOD;
  /** The staged pair: the cast minus Dee (she guides from the strip,
   *  she is not seated at the table). Exactly two or no stage at all. */
  const stagePair = livingOn ? cast.filter((id) => id !== 'dee' && STORY_CHARACTERS[id]) : [];
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
  // A beat may stage a physical prop on the table (the King's gun — see
  // StoryBeat.prop). The prop's strip is rendered from the FIRST beat
  // whenever any beat in this scene carries one, its height reserved
  // like everything else on this screen, so the piece being set down on
  // its beat moves nothing: it only appears, and stays for the scene.
  const gunAt = lines.findIndex((b) => b.prop === 'kingGun');
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

  // line reveal pacing + voice for the current beat. The reveal starts
  // at the fixed reading pace; when the beat's line HAS a recorded
  // clip, the duration lookup (the same manifest entry the voice plays
  // from) re-paces what remains so the text completes at ~92% of the
  // clip — the words land as they're heard (owner, 2026-10-21: "the
  // words type way faster than they are heard audibly"). A tap still
  // completes the line instantly (advance below), and completing the
  // text never touches the still-playing voice — the typer and the
  // audio are independent by construction.
  useEffect(() => {
    if (!beat) return;
    setShown(reduceFx ? Number.MAX_SAFE_INTEGER : 0);
    const name = speakerName(beat.speaker);
    const persona = beat.speaker !== 'you' ? personaForName(name) : undefined;
    if (beat.speaker !== 'you') {
      speakBot(name, beat.line, persona, undefined, undefined, seatPosFor(beat.speaker, cast));
    }
    if (reduceFx) return;
    const total = beat.line.length;
    let shownCount = 0;
    let timer: number | undefined;
    // (Re)pace the REMAINING reveal over targetMs. Chars already shown
    // stay shown, so a duration that arrives late can only stretch
    // what's left — the text never jumps backwards.
    const pace = (targetMs: number) => {
      window.clearInterval(timer);
      const remaining = total - shownCount;
      if (remaining <= 0) return;
      const stepMs = Math.max(8, Math.round(targetMs / remaining));
      timer = window.setInterval(() => setShown((s) => {
        if (s >= total) { window.clearInterval(timer); return s; }
        shownCount = s + 1;
        return s + 1;
      }), stepMs);
    };
    pace(fixedRevealMs(total));
    if (beat.speaker === 'you') return () => window.clearInterval(timer);
    const t0 = performance.now();
    let live = true;
    void spokenClipDurationMs(name, beat.line, persona).then((clipMs) => {
      if (!live || !clipMs) return;
      // Aim the rest of the reveal at the clip-paced target, less the
      // time already spent typing at the fixed pace.
      pace(Math.max(0, revealDurationMs(total, clipMs) - (performance.now() - t0)));
    });
    return () => { live = false; window.clearInterval(timer); };
  }, [i, lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const sizerRef = useRef<HTMLDivElement | null>(null);
  const [reservedH, setReservedH] = useState<number | null>(null);

  // Reserve the dialogue body's height for the CURRENT beat's full text
  // before the typewriter starts (the sizer below renders the whole
  // beat; see reservedBodyHeight). Measured in a layout effect so the
  // reservation lands before paint, and re-measured when the beat
  // changes, on resize (rotation), and when webfonts land. Typing never
  // re-measures — while a line reveals, the box cannot change height at
  // all; between beats the new reservation glides in via the CSS height
  // transition on .story-script-body.
  useLayoutEffect(() => {
    const measure = () => {
      const h = reservedBodyHeight(sizerRef.current);
      if (h > 0) setReservedH((prev) => (prev === h ? prev : h));
    };
    measure();
    let live = true;
    document.fonts?.ready.then(() => { if (live) measure(); }).catch(() => { /* no Font Loading API */ });
    window.addEventListener('resize', measure);
    return () => { live = false; window.removeEventListener('resize', measure); };
  }, [i, lines]);

  // Story voice scope (one-timbre rule, 2026-10-21): while a scene is on
  // screen, story characters speak ONLY their cast recordings — generic
  // persona talk is text-only and the robot is refused by identity
  // (talkPrefs). Cleared on unmount; Table sets it again for the match.
  useEffect(() => {
    setStoryVoiceScope(true);
    return () => { setStoryVoiceScope(false); };
  }, []);

  // leaving the scene stops its voices — recorded ones via the engine; speech only
  // if an utterance is actually active (an idle cancel() still pokes the iOS audio
  // session, and the fallback is fenced during scenes — see cancelActiveSpeech)
  useEffect(() => () => {
    try { sound.stopVoice(); } catch { /* ignore */ }
    cancelActiveSpeech(typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined);
  }, []);

  if (!beat) { onDone(); return null; }
  const last = i >= lines.length - 1;
  const revealing = shown < beat.line.length;
  const name = speakerName(beat.speaker);
  const role = speakerRole(beat.speaker);
  const hintText = last ? '' : revealing ? 'Tap for the full line' : 'Tap to continue';
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
    <div
      className={`story-scene${reduceFx ? ' reduce' : ''}${livingOn ? ' living' : ''}`}
      data-testid="story-script"
      data-living-mood={livingOn ? mood.id : undefined}
      style={livingOn ? livingMoodVars(mood) : undefined}
    >
      {bgUrl && <div className="story-scene-bg" style={{ backgroundImage: `url(${bgUrl})` }} aria-hidden />}
      {/* VIDEO SEAM (phase 2, separate build): at the three big stops
          (storyLiving's `big` rows — the King, the Legends' Table, the
          Pj's) a silent clip mounts OVER this living block, which
          stays as the base layer beneath it: the clip's loading state
          and its fallback whenever the clip can't play. Nothing here
          changes for that build; the layer order below is the seam. */}
      {livingOn && (
        <>
          <div className="story-scene-glow" aria-hidden />
          <div className="story-scene-haze" aria-hidden />
          {stagePair.length === 2 && (
            <div className="story-stage" data-testid="story-stage" aria-hidden>
              {stagePair.map((id, ix) => {
                const active = beat.speaker === id;
                return (
                  <div
                    key={id}
                    className={`story-stage-one ${ix === 0 ? 'left' : 'right'}${active ? ' active' : ' dim'}`}
                    data-testid={`story-stage-${id}`}
                    data-active={active ? 'true' : 'false'}
                  >
                    <StageFace characterId={id} name={STORY_CHARACTERS[id]!.name} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
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
        {gunAt >= 0 && (
          <div className={`story-prop-strip${i >= gunAt ? ' down' : ''}`} data-testid="story-king-gun" aria-hidden>
            <KingGunArt className="story-prop-gun" />
          </div>
        )}
        <div className="story-script-card" onClick={advance} role={last ? undefined : 'button'} aria-label={last ? undefined : 'Next line'}>
          {beat.speaker !== 'you' && STORY_CHARACTERS[beat.speaker]
            ? <StoryFace characterId={beat.speaker} name={name} className="speaker-face" />
            : <div className="story-script-face" aria-hidden>{name.slice(0, 1)}</div>}
          <div className="story-script-body" style={reservedH !== null ? { height: reservedH } : undefined}>
            <p className="story-script-name">{name}{role ? <span className="story-script-role"> · {role}</span> : null}</p>
            <p className="story-script-line">{revealing ? beat.line.slice(0, shown) : beat.line}</p>
            <p className="story-script-hint">{hintText}</p>
            {/* The sizer: the WHOLE beat — header, the full unrevealed
                line, the hint slot — rendered invisibly at the body's
                real width. Its height is the reservation the layout
                effect pins on the body, so the visible card is exactly
                as tall with zero characters shown as with all of them. */}
            <div className="story-script-sizer" ref={sizerRef} aria-hidden="true" data-testid="story-script-sizer">
              <p className="story-script-name">{name}{role ? <span className="story-script-role"> · {role}</span> : null}</p>
              <p className="story-script-line">{beat.line}</p>
              <p className="story-script-hint">{hintText}</p>
            </div>
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
