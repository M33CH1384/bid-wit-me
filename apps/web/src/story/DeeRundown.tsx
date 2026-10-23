/**
 * Dee's Rundown panel (solo rundown spec §4; the co-op pair rundowns
 * share the panel per co-op spec §5.1): Dee's portrait, the DEE'S
 * RUNDOWN header, her script for THIS stop, and the transport
 * controls. It lives inside the Tale of the Tape, between the history
 * block and the two tape columns, and never gates entering the match.
 *
 * VOICE — the fence is absolute: Dee speaks ONLY from her own cast
 * recordings (sprite lilcuz-f), through the standard voice channel
 * (speakBot / spokenClipDurationMs, the same pair ScriptPlayer
 * paces its scenes with, story voice scope set while the panel is
 * mounted). The solo scripts' clips shipped in the 2026-10-22 batch,
 * so solo playback is her recorded voice with the text revealing in
 * step (the shared typer math: text completes at ~92.5% of the
 * clip's real duration). The co-op pair scripts have no recordings
 * until the Phase 4 mini-bake, so they resolve no clip and play as
 * a reading-pace text reveal — when their clips land, this panel
 * voices them with no change. A line with no clip is NEVER given a
 * substitute: no persona voice, no catalog voice, no speech
 * synthesis (webSpeech refuses Dee by identity besides).
 *
 * Voices off / sound off / Dee muted: no clip can sound, so the
 * panel is static — her full words framed as a quote with her
 * byline, no play button (spec §4).
 *
 * Auto-play fires ONCE per (track, stop, variant) per device, and
 * only on the sit-down path (autoplay prop) — from the map's "Meet
 * them" the panel opens with the full text and a tap-to-play button,
 * so browsing never ambushes the player with audio. Skip stops the
 * voice and completes the text, marking the variant heard; the
 * tape's CTA unmounts the panel, which stops playback the same way
 * leaving a scene does.
 */
import { useEffect, useRef, useState } from 'react';
import { personaForName } from '@spades/bots';
import StoryFace from './StoryFace';
import { fixedRevealMs, revealDurationMs } from './ScriptPlayer';
import { setStoryVoiceScope, speakBot, spokenClipDurationMs, talkPrefs, useTalkPrefs } from '../talkPrefs';
import { sound } from '../audio';
import { cancelActiveSpeech } from '../audioSession';
import { useReduceEffects } from '../fx';

/** The panel's line: both rundown sets (solo + co-op pair) have this shape. */
export interface RundownPanelLine { stopId: string; variant: string; text: string }

const SEEN_KEY = 'bwm.rundownSeen.v1';

function seenKeys(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]; } catch { return []; }
}
function markSeen(key: string) {
  try {
    const keys = seenKeys();
    if (!keys.includes(key)) localStorage.setItem(SEEN_KEY, JSON.stringify([...keys, key]));
  } catch { /* private mode: the panel just replays next time */ }
}

export default function DeeRundownPanel({ rundown, track, autoplay = true }: {
  rundown: RundownPanelLine;
  track: string;
  /** true on the sit-down / play path; false from the map's "Meet them" (tap-to-play). */
  autoplay?: boolean;
}) {
  const reduceFx = useReduceEffects();
  const prefs = useTalkPrefs();
  const seenKey = `${track}|${rundown.stopId}|${rundown.variant}`;
  const full = rundown.text;
  const seenInit = useRef(seenKeys().includes(seenKey)).current;
  const [heard, setHeard] = useState(seenInit);
  // The map path opens with the text whole (it is reference reading);
  // the sit-down path reveals with the voice unless already heard.
  const [shown, setShown] = useState(() => (reduceFx || seenInit || !autoplay ? full.length : 0));
  const [playing, setPlaying] = useState(false);
  // The clip lookup: the same manifest entry the voice plays from.
  // null = no clip can sound for this line on this device right now.
  const [clipMs, setClipMs] = useState<number | null>(null);
  const [resolved, setResolved] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
    if (endTimerRef.current !== null) { window.clearTimeout(endTimerRef.current); endTimerRef.current = null; }
  };

  const finish = () => {
    clearTimers();
    setShown(full.length);
    setPlaying(false);
    setHeard(true);
    markSeen(seenKey);
  };

  /** Play (or replay) the rundown: her clip when one resolved, the
   *  reading-pace text reveal when none did. clipMs is the duration
   *  the reveal paces against; the audio end is the duration itself. */
  const startPlayback = (ms: number | null) => {
    clearTimers();
    setPlaying(true);
    if (!reduceFx) setShown(0);
    if (ms) speakBot('Dee', full, personaForName('Dee'));
    if (reduceFx) {
      // Text is already whole; only the audio (if any) runs out the clock.
      if (ms) endTimerRef.current = window.setTimeout(finish, ms);
      else finish();
      return;
    }
    const total = full.length;
    const revealMs = ms ? revealDurationMs(total, ms) : fixedRevealMs(total);
    const stepMs = Math.max(8, Math.round(revealMs / Math.max(1, total)));
    let count = 0;
    intervalRef.current = window.setInterval(() => {
      count += 1;
      setShown(Math.min(total, count));
      if (count >= total) {
        if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
        if (!ms) finish(); // text-only: the reveal IS the playback
      }
    }, stepMs);
    if (ms) endTimerRef.current = window.setTimeout(finish, ms);
  };

  const skip = () => {
    try { sound.stopVoice(); } catch { /* ignore */ }
    cancelActiveSpeech(typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined);
    finish();
  };

  // Story voice scope (one-timbre rule): while this story surface is
  // mounted, Dee's lines resolve only through her cast recordings —
  // the same fence ScriptPlayer sets for scenes. Cleared on unmount.
  useEffect(() => {
    setStoryVoiceScope(true);
    return () => { setStoryVoiceScope(false); };
  }, []);

  // Leaving the tape (the CTA included) stops her voice — recorded
  // ones via the engine; speech only if an utterance is somehow
  // active (the fence means there is none for Dee; the call mirrors
  // ScriptPlayer's leave-taking exactly).
  useEffect(() => () => {
    clearTimers();
    try { sound.stopVoice(); } catch { /* ignore */ }
    cancelActiveSpeech(typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the clip once, then auto-play on the sit-down path when
  // this (stop, variant) has never been heard on this device.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    let live = true;
    void (async () => {
      let ms: number | null = null;
      try { ms = await spokenClipDurationMs('Dee', full, personaForName('Dee')); } catch { ms = null; }
      if (!live) return;
      setClipMs(ms);
      setResolved(true);
      // Static mode (voices/sound off, Dee muted): no clip can sound,
      // so nothing plays — her words stand whole as the quote.
      const off = !talkPrefs.get().voices || !sound.settings.on || sound.settings.volume <= 0 || sound.voiceMuted('Dee');
      if (ms === null && off) { setShown(full.length); return; }
      if (!autoplay || reduceFx || seenInit) return;
      startPlayback(ms);
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const revealing = shown < full.length;
  // Static mode (spec §4): voices off, sound off, or Dee muted — no
  // clip can sound, so her words carry it as a quote, no controls.
  const voicesOff = !prefs.voices || !sound.settings.on || sound.settings.volume <= 0 || sound.voiceMuted('Dee');
  const isStatic = resolved && clipMs === null && voicesOff;
  const busy = playing || revealing || (autoplay && !resolved && !heard);

  return (
    <section className={`dee-rundown${isStatic ? ' static' : ''}`} data-testid="dee-rundown" aria-label={full}>
      <StoryFace characterId="dee" name="Dee" className="tape-face" />
      <div className="dee-rundown-body">
        <p className="dee-rundown-head">DEE’S RUNDOWN <span className="dee-rundown-byline">· Dee, your guide</span></p>
        <div className="dee-rundown-textwrap">
          <p className="dee-rundown-text" aria-hidden="true">{revealing && !isStatic ? full.slice(0, shown) : full}</p>
          <p className="dee-rundown-sizer" aria-hidden="true">{full}</p>
        </div>
        {isStatic
          ? <p className="dee-rundown-sign">— Dee</p>
          : (
            <div className="dee-rundown-controls">
              {busy
                ? <button type="button" className="btn ghost" data-testid="dee-rundown-skip" onClick={skip}>Skip</button>
                : heard
                  ? <button type="button" className="btn ghost" data-testid="dee-rundown-replay" onClick={() => startPlayback(clipMs)}>Hear it again</button>
                  : <button type="button" className="btn ghost" data-testid="dee-rundown-play" onClick={() => startPlayback(clipMs)}>{clipMs ? 'Hear Dee read it' : 'Read Dee’s rundown'}</button>}
            </div>
          )}
      </div>
    </section>
  );
}
