/**
 * Story film scene player (Chapter 1) — the DeeRundownVideo contract,
 * restated for full scenes (MANIFEST-CH1.json):
 *
 *   - Poster first; the video is requested only when it plays
 *     (preload="none"). A scene's bytes are fetched only when its hook
 *     is reached — never a chapter preload, never a gate on the match.
 *   - Game audio is held under the film while it plays
 *     (sound.holdForVideo) and released on pause / end / skip /
 *     unmount. With voices off the film plays MUTED and its captions
 *     carry the lines.
 *   - Reduced effects (app toggle or OS): no autoplay — a Play button
 *     stands over the poster.
 *   - Skip is always available and never rewinds anything: the caller
 *     wrote the seen mark when the scene was OFFERED.
 *   - Any failure — file missing, decode error, unsupported MP4 —
 *     marks the scene failed for the session and hands the flow back
 *     (onDone 'failed'); the caller lands on the shipped fallback.
 *     A failed scene is never retried this session.
 *   - Natural end lands on an end card: Replay (this scene only —
 *     replays advance nothing) or Continue.
 *
 * PLACEHOLDER PRESENTATION (assets.status 'to-generate'): footage
 * does not exist yet — rendering awaits the owner's spend approval.
 * There is deliberately NO video element and no faked file: the
 * player presents the scene's poster under a visible PLACEHOLDER
 * badge and walks the manifest's subtitle cues on a timer for the
 * scene's target duration, so the owner reviews the real slots,
 * timing, captions and chrome now. Nothing sounds in this mode (the
 * cast voices are baked into the footage later), so game audio is
 * NOT held. When a scene's status flips to 'ready', this same
 * component plays the real <video> with the same chrome.
 */
import { useEffect, useRef, useState } from 'react';
import { sound } from '../audio';
import { FILM_SPEAKER_NAMES, type FilmScene } from './storyFilmManifest';
import { filmPlayback, markFilmSceneFailed } from './storyFilm';

export type FilmDoneReason = 'ended' | 'skipped' | 'failed';

const TICK_MS = 100;

export default function StoryFilmScene({ scene, voicesOff, reduced, mode, onDone }: {
  scene: FilmScene;
  voicesOff: boolean;
  reduced: boolean;
  /** 'hook': the scene the flow landed on (autoplay path).
   *  'replay': the player asked for it from the map card (never autoplays). */
  mode: 'hook' | 'replay';
  onDone: (reason: FilmDoneReason) => void;
}) {
  const placeholder = scene.assets.status !== 'ready';
  const plan = useRef(filmPlayback({ autoplayPath: mode === 'hook', reduced, voicesOff })).current;
  const [playing, setPlaying] = useState(plan.autoplay);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captionsOn, setCaptionsOn] = useState(plan.muted);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const holding = useRef(false);
  const doneRef = useRef(false);

  const finish = (reason: FilmDoneReason) => {
    if (doneRef.current) return;
    doneRef.current = true;
    hold(false);
    onDone(reason);
  };

  const hold = (on: boolean) => {
    if (placeholder || plan.muted || holding.current === on) return;
    holding.current = on;
    try { sound.holdForVideo(on); } catch { /* ignore */ }
  };

  /* Placeholder clock: advances only while playing; reaching the
   * target duration lands on the end card (never an auto-advance). */
  useEffect(() => {
    if (!placeholder || !playing || ended) return;
    const t = window.setInterval(() => {
      setElapsed((e) => {
        const next = Math.min(e + TICK_MS / 1000, scene.durationTargetSeconds);
        if (next >= scene.durationTargetSeconds) {
          window.clearInterval(t);
          setPlaying(false);
          setEnded(true);
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(t);
  }, [placeholder, playing, ended, scene.durationTargetSeconds]);

  /* Unmount: release any audio hold and stop any video. */
  useEffect(() => () => {
    hold(false);
    try { videoRef.current?.pause(); } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cue = scene.lines.find((c) => elapsed >= c.cueStart && elapsed < c.cueEnd) ?? null;
  const showCaptions = captionsOn || placeholder;

  const play = () => {
    if (!placeholder) {
      const v = videoRef.current; if (!v) return;
      try { sound.stopVoice(); } catch { /* ignore */ }
      v.muted = plan.muted;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => { setPlaying(false); hold(false); });
    } else {
      setPlaying(true);
    }
  };
  const pause = () => {
    if (!placeholder) videoRef.current?.pause();
    setPlaying(false);
  };
  const replay = () => {
    setEnded(false);
    setElapsed(0);
    if (!placeholder && videoRef.current) {
      try { videoRef.current.currentTime = 0; } catch { /* ignore */ }
    }
    setPlaying(true);
    if (!placeholder) play();
  };
  const fail = () => {
    markFilmSceneFailed(scene.id);
    finish('failed');
  };

  return (
    <div
      className={`story-film${playing ? ' playing' : ''}`}
      data-testid={`story-film-${scene.id}`}
      data-placeholder={placeholder ? 'yes' : 'no'}
      data-muted={plan.muted ? 'yes' : 'no'}
      data-autoplay={plan.autoplay ? 'yes' : 'no'}
      role="region"
      aria-label={`${scene.title} — chapter film scene`}
    >
      <div className="story-film-frame">
        {placeholder ? (
          <img
            className="story-film-poster"
            src={scene.assets.poster}
            alt=""
            aria-hidden
            onError={fail}
          />
        ) : (
          <video
            ref={videoRef}
            className="story-film-el"
            src={scene.assets.video}
            poster={scene.assets.poster}
            playsInline
            preload="none"
            muted={plan.muted}
            aria-label={scene.title}
            onPlay={() => { setPlaying(true); hold(true); }}
            onPause={() => { setPlaying(false); hold(false); }}
            onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
            onEnded={() => { setPlaying(false); hold(false); setEnded(true); }}
            onError={fail}
            onClick={() => (playing ? pause() : play())}
          >
            <track kind="subtitles" src={scene.assets.subtitles} srcLang="en" label="English" />
          </video>
        )}
        {placeholder && (
          <span className="story-film-badge" aria-label="Placeholder — footage to generate">
            PLACEHOLDER — footage to generate
          </span>
        )}
        {!playing && !ended && (
          <button type="button" className="story-film-play" data-testid="story-film-play" aria-label={`Play ${scene.title}`} onClick={play}>
            <span aria-hidden>▶</span>
          </button>
        )}
        {showCaptions && cue && !ended && (
          <p className="story-film-caption" data-testid="story-film-caption" aria-live="off">
            <b>{FILM_SPEAKER_NAMES[cue.speaker] ?? cue.speaker}:</b> {cue.text}
          </p>
        )}
        {ended && (
          <div className="story-film-endcard">
            <p className="story-film-endcard-title">{scene.title}</p>
            <div className="story-film-controls">
              <button type="button" className="btn ghost" data-testid="story-film-replay" onClick={replay}>Replay scene</button>
              <button type="button" className="btn primary" data-testid="story-film-continue" onClick={() => finish('ended')}>Continue</button>
            </div>
          </div>
        )}
        <div className="story-film-progress" aria-hidden>
          <span style={{ width: `${Math.min(100, (elapsed / scene.durationTargetSeconds) * 100)}%` }} />
        </div>
      </div>
      {!ended && (
        <div className="story-film-controls">
          {playing
            ? <button type="button" className="btn ghost" data-testid="story-film-pause" onClick={pause}>Pause</button>
            : <button type="button" className="btn ghost" data-testid="story-film-playbtn" onClick={play}>Play</button>}
          <button type="button" className="btn ghost" data-testid="story-film-cc" aria-pressed={showCaptions} onClick={() => setCaptionsOn((c) => !c)}>
            {showCaptions ? 'Captions on' : 'Captions'}
          </button>
          <button type="button" className="btn ghost" data-testid="story-film-skip" onClick={() => finish('skipped')}>Skip</button>
        </div>
      )}
      {placeholder && (
        <p className="story-film-note">
          Preview placeholder — the finished scene will play here, in the cast’s own voices, once the footage is generated.
        </p>
      )}
    </div>
  );
}
