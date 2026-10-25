/**
 * Dee's Rundown as a film (first-visit solo variants with a manifest
 * entry — see rundownVideo.ts for the decision). Poster first; the MP4
 * is requested only when it plays (preload="none"). Controls are
 * minimal: Play/Pause and Skip. Skip and the natural end both mark the
 * variant heard through the panel's own seen store. The match is never
 * gated: the tape's CTA stays live the whole time.
 *
 * Sound: with voices on, the game's own audio (music, ambience, beds)
 * is held under the film while it plays and released after (pause,
 * end, skip, unmount). With voices/sound off or Dee muted the film
 * plays MUTED — its captions are burned in — and the game audio is
 * left alone. Reduced effects (app toggle or OS): no autoplay; a Play
 * button sits over the poster.
 */
import { useEffect, useRef, useState } from 'react';
import { sound } from '../audio';
import { RUNDOWN_VIDEO_BASE, markRundownVideoFailed, rundownVideoPlayback, type RundownVideoEntry } from './rundownVideo';

export default function DeeRundownVideo({ entry, autoplayPath, reduced, heard, voicesOff, onHeard, onFail }: {
  entry: RundownVideoEntry;
  autoplayPath: boolean;
  reduced: boolean;
  heard: boolean;
  voicesOff: boolean;
  onHeard: () => void;
  onFail: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const holding = useRef(false);
  const plan = useRef(rundownVideoPlayback({ autoplayPath, reduced, heard, voicesOff })).current;
  const muted = voicesOff;

  const hold = (on: boolean) => {
    if (muted || holding.current === on) return;
    holding.current = on;
    try { sound.holdForVideo(on); } catch { /* ignore */ }
  };

  const play = () => {
    const v = ref.current; if (!v) return;
    try { sound.stopVoice(); } catch { /* ignore */ }
    v.muted = muted;
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => { setPlaying(false); hold(false); });
  };
  const pause = () => { ref.current?.pause(); };
  const skip = () => {
    const v = ref.current;
    if (v) { v.pause(); }
    setPlaying(false); hold(false); onHeard();
  };

  useEffect(() => {
    if (plan.autoplay) play();
    return () => { hold(false); try { ref.current?.pause(); } catch { /* ignore */ } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`dee-video${playing ? ' playing' : ''}`} data-testid="dee-rundown-video" data-muted={muted ? 'yes' : 'no'} data-autoplay={plan.autoplay ? 'yes' : 'no'}>
      <div className="dee-video-frame">
        <video
          ref={ref}
          className="dee-video-el"
          src={RUNDOWN_VIDEO_BASE + entry.file}
          poster={RUNDOWN_VIDEO_BASE + entry.poster}
          playsInline
          preload="none"
          muted={muted}
          aria-label={entry.text}
          onPlay={() => { setPlaying(true); hold(true); }}
          onPause={() => { setPlaying(false); hold(false); }}
          onEnded={() => { setPlaying(false); hold(false); onHeard(); }}
          onError={() => { hold(false); markRundownVideoFailed(entry.file); onFail(); }}
          onClick={() => (playing ? pause() : play())}
        />
        {!playing && (
          <button type="button" className="dee-video-play" data-testid="dee-rundown-video-play" aria-label={heard ? 'Watch Dee’s rundown again' : 'Play Dee’s rundown'} onClick={play}>
            <span aria-hidden>▶</span>
          </button>
        )}
      </div>
      <div className="dee-rundown-controls">
        {playing
          ? <button type="button" className="btn ghost" data-testid="dee-rundown-video-pause" onClick={pause}>Pause</button>
          : <button type="button" className="btn ghost" data-testid="dee-rundown-video-playbtn" onClick={play}>{heard ? 'Watch again' : 'Play'}</button>}
        <button type="button" className="btn ghost" data-testid="dee-rundown-skip" onClick={skip}>Skip</button>
      </div>
    </div>
  );
}
