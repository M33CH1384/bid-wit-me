/**
 * The crowd cue — the one mutable channel between the table's event stream
 * and the King rail figures (three/KingRail.tsx). Deliberately three-free
 * and dependency-free: Table.tsx imports the stamp helpers statically, and
 * the entry graph must never pull three.js into the first script (the
 * blank-screen stall, pinned by entry-graph.test.ts). Poses are computed
 * from this cue by the pure math in kingRailLayout.ts; stamping a cue never
 * re-renders anything — the figures' frame loop reads it.
 */
export interface CrowdCue {
  /** last crowd stir (a set, a shot-out, a Nil landing, a big swing, the nuke) */
  stirAt: number;
  stirAmp: number;
  /** the railbird currently speaking a chime-in, and when their line lands */
  speakerId: string | null;
  speakerAt: number;
  /** a seated figure currently speaking (bot talk / scene line / consultation) */
  seatSpeakerId: string | null;
  seatSpeakerAt: number;
}

export function newCrowdCue(): CrowdCue {
  return { stirAt: -1e9, stirAmp: 0, speakerId: null, speakerAt: -1e9, seatSpeakerId: null, seatSpeakerAt: -1e9 };
}

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
