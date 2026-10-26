/* Crowd cue channel for the King rail (split out of kingRailLayout.ts so the
   table can stamp it without statically importing three). No three imports. */

/**
 * The crowd's cue channel: a plain mutable object the table stamps
 * with real match moments (the same event stream the rail chime-ins
 * key on) and the figures read inside useFrame. Stamping never
 * re-renders React; the cue carries timestamps, and poses are pure
 * functions of (figure, time, cue).
 */
export interface CrowdCue {
  /** last crowd-stir stamp (performance.now ms) + its amplitude 0..1.3 */
  stirAt: number;
  stirAmp: number;
  /** the railbird currently speaking a chime-in, if any */
  speakerId: string | null;
  speakerAt: number;
  /** the seated character currently speaking (Part 2) */
  seatSpeakerId: string | null;
  seatSpeakerAt: number;
}

export const newCrowdCue = (): CrowdCue => ({
  stirAt: -1e9, stirAmp: 0, speakerId: null, speakerAt: -1e9, seatSpeakerId: null, seatSpeakerAt: -1e9,
});

export function stampStir(cue: CrowdCue, at: number, amp: number): void {
  cue.stirAt = at;
  cue.stirAmp = amp;
}
export function stampSpeaker(cue: CrowdCue, id: string, at: number): void {
  cue.speakerId = id;
  cue.speakerAt = at;
}
export function stampSeatSpeaker(cue: CrowdCue, id: string, at: number): void {
  cue.seatSpeakerId = id;
  cue.seatSpeakerAt = at;
}
