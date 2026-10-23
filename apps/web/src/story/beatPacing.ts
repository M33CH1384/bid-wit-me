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
 * Reply tail ride (owner, 2026-10-22, on the Cookout twins: "it's cool
 * that the twins finish each others sentences but the second person
 * takes too long to do it"). A REPLY sequence — rail exchanges, the
 * end-of-hand banter, and the Table story channel (deliver(): sit-downs,
 * play reacts, between-hands exchanges, milestone/signature sets) —
 * opts in with `tailRideMs`: a heard line's slot shrinks so the next
 * beat starts this far BEFORE the line's voice ends, and the voice
 * engine's cross-talk policy (planVoiceArrival in audio.ts: tail only,
 * ≤ 3 s left, max two voices, the first ducked) decides whether it
 * truly overlaps or lands as the line finishes. One second targets
 * the policy's deep tail (≤ 1.2 s left), where an overlap is the
 * natural read. ScriptPlayer SCENE dialogue (intros, outros,
 * meet-them scenes) does NOT ride: it keeps the full duration + gap
 * handoff this module was built for — cinematic conversation, not
 * table banter. (The Table channel was initially left unridden too;
 * the owner reported the twins still slow at the Cookout table that
 * evening — measured: every voiced reply there waited the full
 * 1400/1700 ms gap after the opener ended — so deliver() rides now.)
 */
export const REPLY_TAIL_RIDE_MS = 1000;

/**
 * The start offset (ms after the caller's base) for each beat: beat 0
 * at 0, beat ix after every earlier beat's spoken duration plus one
 * gap each. `durations[ix]` is that beat's clip duration in ms, or
 * null when the beat will not be heard (text-only) — a null beat
 * occupies `gapMs`, its legacy stagger slot. A caller may split the
 * two slot sizes with `silentSlotMs` (the end-of-hand banter: a heard
 * line holds duration + a short reply beat, while a silent line keeps
 * the exact legacy slot its fixed stagger always gave it). With
 * `tailRideMs` (reply sequences only), a heard line's slot is its
 * duration MINUS the ride — the next beat starts that far before the
 * voice ends — floored so a short line's reply still starts at least
 * ~0.6 s in (or at its end, when the line is shorter than that): a
 * reply never jumps the first line in the same breath.
 */
export function beatStartOffsets(durations: readonly (number | null)[], gapMs: number, silentSlotMs: number = gapMs, tailRideMs = 0): number[] {
  const out: number[] = [];
  let t = 0;
  for (let ix = 0; ix < durations.length; ix++) {
    out.push(t);
    const d = durations[ix];
    // a heard line occupies its real duration + one gap; a silent one its legacy slot;
    // a reply sequence's heard line gives up the ride at its tail instead
    t += (d == null ? silentSlotMs : tailRideMs > 0 ? Math.max(d - tailRideMs, Math.min(600, d)) : d + gapMs);
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
  opts: { baseMs: number; gapMs: number; nameOf: (beat: T) => string; audible: (beat: T) => boolean; tailRideMs?: number },
  fire: (beat: T, delayMs: number, ix: number) => void,
): Promise<void> {
  const durations = await Promise.all(beats.map(async (bt) => {
    if (!opts.audible(bt)) return null;
    try { return await spokenClipDurationMs(opts.nameOf(bt), bt.line, undefined); }
    catch { return null; }
  }));
  const offsets = beatStartOffsets(durations, opts.gapMs, opts.gapMs, opts.tailRideMs ?? 0);
  beats.forEach((bt, ix) => fire(bt, opts.baseMs + offsets[ix]!, ix));
}
