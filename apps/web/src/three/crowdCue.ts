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
  /** the filmed visit's presence window (performance.now ms): the
   *  visitor starts walking in at visitAt and is fully departed at
   *  visitUntil; -1e9 = no visit. Stamped by the table for the
   *  visitor character's speaking moments and for rare ambient
   *  visits. */
  visitAt: number;
  visitUntil: number;
  /** the current window's settled hold (ms after arrival completes):
   *  the phase split inside the window — arrive for VISIT_ARRIVE_MS,
   *  settled for this long, then the departure takes the remainder. */
  visitSettledMs: number;
}

export function newCrowdCue(): CrowdCue {
  return {
    stirAt: -1e9, stirAmp: 0, speakerId: null, speakerAt: -1e9,
    seatSpeakerId: null, seatSpeakerAt: -1e9,
    visitAt: -1e9, visitUntil: -1e9, visitSettledMs: 0,
  };
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

/**
 * Stamp (or extend) the filmed visit's presence window. Windows
 * merge: a visit already scheduled or in progress keeps its EARLIER
 * walk-in and extends to the LATER departure (an exchange's comeback
 * line extends the opener's stay — the settled hold grows to cover
 * it); a stamp that begins only after the previous window has fully
 * closed starts a fresh window.
 */
export function stampVisit(cue: CrowdCue, at: number, until: number, settledMs: number): void {
  if (cue.visitUntil >= at) {
    cue.visitAt = Math.min(cue.visitAt, at);
    if (until > cue.visitUntil) {
      cue.visitSettledMs += until - cue.visitUntil;
      cue.visitUntil = until;
    }
  } else {
    cue.visitAt = at;
    cue.visitUntil = until;
    cue.visitSettledMs = settledMs;
  }
}

/* ------------------------------------------------------------------ */
/* Filmed-visit choreography constants (owner, 2026-10-26, late).   */
/* They live here — the three-free protocol module — because the     */
/* TABLE stamps the windows and must never import the three side.    */
/* The phase/envelope math that consumes them lives in               */
/* kingRailLayout.ts.                                                */
/*                                                                   */
/* The visit replaced the bust-portrait apparition the same day:     */
/* the owner rejected the flat portrait plane ("live posters on a    */
/* pillar") and picked full-body FILMED visits — a person walks in   */
/* with real steps and weight, settles, speaks, and walks out into   */
/* the dark. The storm tier went with the apparition (reverted) and  */
/* and returns only if this look passes his eye.                     */
/* ------------------------------------------------------------------ */

/** The visiting character for this sample pass. On the owner's
 *  approval the follow-up converts the whole cast (registry-driven —
 *  see RAIL_VISITORS in kingRailLayout.ts) and the ring comes down;
 *  until then only Ray's standing figure leaves the ring. */
export const VISITOR_ID = 'uncleRay';

/* The three filmed phases (ms, on the cue's performance.now
 * timeline). ARRIVE and DEPART are the encoded clips' real
 * durations: the walk-in settles at 5.2 s; the walk-out is a 1.35x
 * drift that leaves the light by ~7.2 s. */
export const VISIT_ARRIVE_MS = 5200;   // walk in + settle (the arrive clip)
export const VISIT_IDLE_MS = 4600;     // the settled-presence loop's length
export const VISIT_DEPART_MS = 7167;   // nod, turn, walk out into the dark
/** presence after the line lands (voice + a beat of linger) before
 *  the departure begins — the settled hold of a speech visit. */
export const VISIT_SETTLED_MS = 3800;
/** the materialize inside the arrive phase: he gathers out of the
 *  dark over the first stretch of the walk (never a pop). */
export const VISIT_FADE_IN_MS = 1400;
/** the last stretch of the departure: by then he is at the frame's
 *  edge, walking out of the light — the ghost lets go. */
export const VISIT_FADE_OUT_MS = 1500;
export const VISIT_PEAK = 0.88;        // a presence, never solid

/** Deterministic 0..1 hash — the same family as the layout seeds,
 *  duplicated here so this module stays dependency-free. */
export function cueHash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ------------------------------------------------------------------ */
/* Ambient visits: a non-speaking visit — he walks in, stands a      */
/* while, and walks out again — the coming-and-going texture         */
/* between his lines. Stricter discipline than speech: at most one   */
/* per hand (the caller evaluates once per hand), ~1 hand in 3,       */
/* never on the final hand (the endgame quiet is the King's, and     */
/* the witness line is scripted). Seeded — the same (seedKey, hand)  */
/* always decides the same way.                                      */
/* ------------------------------------------------------------------ */

export const VISIT_AMBIENT_P = 0.35;

export interface AmbientVisit { delayMs: number; settledMs: number }

export function ambientVisit(seedKey: number, handNo: number, finalHand: boolean): AmbientVisit | null {
  if (finalHand) return null;
  const roll = cueHash01(seedKey * 131 + handNo * 17 + 7);
  if (roll >= VISIT_AMBIENT_P) return null;
  const delayMs = 5000 + cueHash01(seedKey * 57 + handNo * 29 + 3) * 7000;
  return { delayMs, settledMs: 4400 };
}
