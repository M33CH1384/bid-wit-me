/**
 * Story beat pacing (defect fix, owner report 2026-10-22: story lines
 * "cut short" at the table). The Table story channel used to schedule a
 * beat sequence on a FIXED stagger (base + ix · gap) that ignored how
 * long each line's recorded clip actually runs: clips run 3.3–8.2 s
 * against 1.4–1.7 s staggers, and the voice engine only lets a new line
 * talk over a playing line's tail (≤ 3 s left — planVoiceArrival in
 * audio.ts); every other arrival REPLACES it. A long line early in a
 * sequence was therefore guaranteed to be murdered by the next beat —
 * Dee's 5015 ms sit-down line cut at 1.7 s, Pat's 7115 ms signature
 * line the same.
 *
 * The fix: pace the sequence by the lines' REAL clip durations — the
 * same manifest numbers the voice plays from (talkPrefs'
 * spokenClipDurationMs, ScriptPlayer's pacing source). Beat ix starts
 * at base + Σ (duration + gap) over the beats before it, so a beat
 * never starts before the previous line's voice has finished (plus
 * the caller's conversational gap). A beat with no recorded clip
 * (text-only: voices off, muted, fenced, or simply unrecorded) has
 * no duration to wait for — it occupies exactly its legacy stagger
 * slot, so text-only sequences keep the rhythm they always had.
 * Chat text and voice stay glued: the caller schedules ONE timer per
 * beat that pushes the line and speaks it together, exactly as before,
 * just at the paced offset. ScriptPlayer is untouched (its typewriter
 * is already duration-aware) and so is regular-table talk.
 */
import { spokenClipDurationMs } from '../talkPrefs';

export interface PacedBeatLine { speaker: string; line: string }

/**
 * The start offset (ms after the caller's base) for each beat: beat 0
 * at 0, beat ix after every earlier beat's spoken duration plus one
 * gap each. `durations[ix]` is that beat's clip duration in ms, or
 * null when the beat will not be heard (text-only) — a null beat
 * occupies `gapMs`, its legacy stagger slot. A caller may split the
 * two slot sizes with `silentSlotMs` (the end-of-hand banter: a heard
 * line holds duration + a short reply beat, while a silent line keeps
 * the exact legacy slot its fixed stagger always gave it).
 */
export function beatStartOffsets(durations: readonly (number | null)[], gapMs: number, silentSlotMs: number = gapMs): number[] {
  const out: number[] = [];
  let t = 0;
  for (let ix = 0; ix < durations.length; ix++) {
    out.push(t);
    const d = durations[ix];
    // a heard line occupies its real duration + one gap; a silent one its legacy slot
    t += (d == null ? silentSlotMs : d + gapMs);
  }
  return out;
}

/**
 * Schedule a story beat sequence at paced offsets: resolves each
 * beat's clip duration (a lookup, never playback), then hands the
 * caller each beat with its start delay in ms — baseMs + the paced
 * offset. `fire` runs the caller's own push + speak for the beat, so
 * the chat line and its voice start in the same tick. Only beats
 * flagged `audible` are looked up; a muted or player ('you') beat is
 * text on screen and takes the legacy slot without a lookup.
 */
export async function scheduleStoryBeats<T extends PacedBeatLine>(
  beats: readonly T[],
  opts: { baseMs: number; gapMs: number; nameOf: (beat: T) => string; audible: (beat: T) => boolean },
  fire: (beat: T, delayMs: number, ix: number) => void,
): Promise<void> {
  const durations = await Promise.all(beats.map(async (bt) => {
    if (!opts.audible(bt)) return null;
    try { return await spokenClipDurationMs(opts.nameOf(bt), bt.line, undefined); }
    catch { return null; }
  }));
  const offsets = beatStartOffsets(durations, opts.gapMs);
  beats.forEach((bt, ix) => fire(bt, opts.baseMs + offsets[ix]!, ix));
}
