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
  /** the rail apparition's presence window (performance.now ms): the
   *  materialize begins at apparitionAt, the figure is fully dissolved
   *  at apparitionUntil; -1e9 = no visitation. Stamped by the table for
   *  the apparition character's speaking moments (warm tier), for rare
   *  ambient visits, and for lightning reveals. */
  apparitionAt: number;
  apparitionUntil: number;
  /** the current window's lightning reveal: the venue lights begin
   *  their dip at lightningAt (performance.now ms). -1e9 = the current
   *  window (if any) is a warm visitation, not a lightning reveal. */
  lightningAt: number;
  /** strike count for the current reveal: 1, or 2 for the very
   *  heaviest moments (the classic double strike — never more). */
  lightningStrikes: number;
}

export function newCrowdCue(): CrowdCue {
  return {
    stirAt: -1e9, stirAmp: 0, speakerId: null, speakerAt: -1e9,
    seatSpeakerId: null, seatSpeakerAt: -1e9,
    apparitionAt: -1e9, apparitionUntil: -1e9, lightningAt: -1e9, lightningStrikes: 0,
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
 * Stamp (or extend) the apparition's presence window. Windows merge:
 * a visit already scheduled or in progress keeps its EARLIER
 * materialize and extends to the LATER dissolve (an exchange's
 * comeback line extends the opener's stay); a stamp that begins only
 * after the previous window has fully closed starts a fresh window.
 */
export function stampApparition(cue: CrowdCue, at: number, until: number): void {
  if (cue.apparitionUntil >= at) {
    cue.apparitionAt = Math.min(cue.apparitionAt, at);
    cue.apparitionUntil = Math.max(cue.apparitionUntil, until);
  } else {
    cue.apparitionAt = at;
    cue.apparitionUntil = until;
  }
}

/**
 * Stamp a lightning reveal over a presence window: the lights begin
 * dipping at `at`. If the window being extended already carries a
 * reveal, the FIRST dip stands (the sequence never re-dips
 * mid-reveal); a warm window escalated by a later stamp takes the
 * new dip.
 */
export function stampLightning(cue: CrowdCue, at: number, until: number, strikes: number): void {
  const merging = cue.apparitionUntil >= at;
  const hadLightning = merging
    && cue.lightningAt >= cue.apparitionAt && cue.lightningAt <= cue.apparitionUntil;
  stampApparition(cue, at, until);
  if (!hadLightning) {
    cue.lightningAt = at;
    cue.lightningStrikes = strikes;
  }
}

/* ------------------------------------------------------------------ */
/* Apparition choreography constants (owner, 2026-10-26, evening).  */
/* They live here — the three-free protocol module — because the     */
/* TABLE stamps the windows and must never import the three side.    */
/* The envelopes that consume them live in kingRailLayout.ts.        */
/* ------------------------------------------------------------------ */

/** The apparition character for this pass. On the owner's approval
 *  the follow-up converts the whole cast and the ring comes down;
 *  until then only Ray's standing figure leaves the ring. */
export const GHOST_ID = 'uncleRay';

/* Warm choreography (ms, on the cue's performance.now timeline). */
export const GHOST_LEAD_MS = 900;      // materialize begins this long before the line lands
export const GHOST_FADE_IN_MS = 750;   // the dissolve-in
export const GHOST_HOLD_MS = 3800;     // presence after the line lands (voice + a beat of linger)
export const GHOST_FADE_OUT_MS = 1100; // the dissolve-out at the window's end
export const GHOST_PEAK = 0.86;        // a presence, never solid

/* Lightning choreography (ms from lightningAt). */
export const GHOST_DIP_MS = 650;        // the lights fall to near-dark
export const GHOST_STRIKE_MS = 95;      // one strike's bright pulse (never a strobe)
export const GHOST_STRIKE_GAP_MS = 210; // the dark beat inside a double strike
export const GHOST_RETURN_MS = 1500;    // the flickering climb back to full light
/** the line lands this long after the (last) strike's pulse ends —
 *  in the first beat of the after-glow. */
export const GHOST_LINE_LAG_MS = 120;
/** presence after the line lands in a reveal: the voice's beat, then
 *  he dissolves as the lights settle. */
export const GHOST_AFTERGLOW_MS = 1500;

/** When the (last) strike's pulse ends, relative to lightningAt. */
export function ghostStrikesEndMs(strikes: number): number {
  return strikes >= 2
    ? GHOST_DIP_MS + GHOST_STRIKE_MS + GHOST_STRIKE_GAP_MS + GHOST_STRIKE_MS
    : GHOST_DIP_MS + GHOST_STRIKE_MS;
}

/** Deterministic 0..1 hash — the same family as the layout seeds,
 *  duplicated here so this module stays dependency-free. */
export function cueHash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ------------------------------------------------------------------ */
/* Ambient visits: a non-speaking presence drifts in and out — the   */
/* coming-and-going texture between his lines. Stricter discipline  */
/* than speech: at most one per hand (the caller evaluates once per */
/* hand), ~1 hand in 3, never on the final hand (the endgame quiet   */
/* is the King's, and the witness line is scripted). Seeded — the    */
/* same (seedKey, hand) always decides the same way.                 */
/* ------------------------------------------------------------------ */

export const GHOST_AMBIENT_P = 0.35;

export interface GhostVisit { delayMs: number; holdMs: number }

export function ambientGhostVisit(seedKey: number, handNo: number, finalHand: boolean): GhostVisit | null {
  if (finalHand) return null;
  const roll = cueHash01(seedKey * 131 + handNo * 17 + 7);
  if (roll >= GHOST_AMBIENT_P) return null;
  const delayMs = 5000 + cueHash01(seedKey * 57 + handNo * 29 + 3) * 7000;
  return { delayMs, holdMs: 5200 };
}
