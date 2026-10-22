/**
 * Dee's Rundown panel (co-op spec §5.1; presentation per the solo
 * rundown spec §4 — same panel, same discipline): Dee's portrait, the
 * DEE'S RUNDOWN header, her script for THIS pair at THIS stop, and the
 * transport controls. It lives inside the Tale of the Tape, between
 * the history block and the two tape columns.
 *
 * PHASE 3 IS TEXT ONLY — the voice fence is absolute. The co-op
 * scripts have no cast recordings until the Phase 4 mini-bake, so no
 * audio plays here: the "playback" is her written words revealing at
 * the standing reading pace (ScriptPlayer's fixedRevealMs — the same
 * typer math, never a fork). When the clips land, playback routes
 * through the standard voice channel from Dee's own cast sprite only
 * (never persona, catalog, or speech synthesis), paced by the clip's
 * real duration — the selectors and this panel do not change.
 *
 * Auto-play (the reveal) fires once per (track, stop, variant) per
 * device on the sit-down path; a seen panel shows the full text with
 * a "Hear it again" replay. Skip completes the text instantly. The
 * panel never gates entering the match.
 */
import { useEffect, useRef, useState } from 'react';
import type { CoopRundown } from '@spades/bots';
import StoryFace from './StoryFace';
import { fixedRevealMs } from './ScriptPlayer';
import { useReduceEffects } from '../fx';

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

export default function DeeRundownPanel({ rundown, track }: { rundown: CoopRundown; track: string }) {
  const reduceFx = useReduceEffects();
  const seenKey = `${track}|${rundown.stopId}|${rundown.variant}`;
  const [shown, setShown] = useState(() => (reduceFx || seenKeys().includes(seenKey) ? rundown.text.length : 0));
  const [playing, setPlaying] = useState(false);
  const full = rundown.text;
  const revealing = shown < full.length;

  // The reveal: one char per step at the standing no-clip reading pace —
  // the same fixedRevealMs ScriptPlayer's typer uses for text-only beats.
  useEffect(() => {
    if (!playing || reduceFx) return;
    const total = full.length;
    const stepMs = Math.max(8, Math.round(fixedRevealMs(total) / Math.max(1, total)));
    const t = window.setInterval(() => {
      setShown((s) => {
        if (s >= total) { window.clearInterval(t); setPlaying(false); markSeen(seenKey); return s; }
        return s + 1;
      });
    }, stepMs);
    return () => window.clearInterval(t);
  }, [playing, full, reduceFx, seenKey]);

  // Auto-play once per (track, stop, variant) on the sit-down path.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    if (!reduceFx && !seenKeys().includes(seenKey)) { setShown(0); setPlaying(true); }
  }, [reduceFx, seenKey]);

  const skip = () => { setPlaying(false); setShown(full.length); markSeen(seenKey); };
  const replay = () => { if (reduceFx) { setShown(full.length); return; } setShown(0); setPlaying(true); };

  return (
    <section className="dee-rundown" data-testid="dee-rundown" aria-label={full}>
      <StoryFace characterId="dee" name="Dee" className="tape-face" />
      <div className="dee-rundown-body">
        <p className="dee-rundown-head">DEE’S RUNDOWN <span className="dee-rundown-byline">· Dee, your guide</span></p>
        <div className="dee-rundown-textwrap">
          <p className="dee-rundown-text" aria-hidden="true">{revealing ? full.slice(0, shown) : full}</p>
          <p className="dee-rundown-sizer" aria-hidden="true">{full}</p>
        </div>
        <div className="dee-rundown-controls">
          {revealing
            ? <button type="button" className="btn ghost" data-testid="dee-rundown-skip" onClick={skip}>Skip</button>
            : <button type="button" className="btn ghost" data-testid="dee-rundown-replay" onClick={replay}>Hear it again</button>}
        </div>
      </div>
    </section>
  );
}
