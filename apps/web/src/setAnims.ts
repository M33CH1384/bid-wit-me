import { STORY_STOPS, storyStopById } from '@spades/bots';
import type { GameResult, ShotCover } from '@spades/rules';

/**
 * Per-stop SET ANIMATIONS (owner, 2026-10-21): every story stop has its own
 * celebration for when a side gets set at the table, in TWO tiers — the
 * regular set, and the FINALE for a set that ends the game (the escalated
 * version of the same scenario). Both tiers unlock together when the player
 * CLEARS the stop, derived client-side from story progress exactly like the
 * story decks (storyDecks.ts) — no server grant machinery.
 *
 * NO FREE DEFAULTS (owner, 2026-10-21 12:04): the old caution-tape (regular)
 * and white-sheet (finale) treatments are retired from rotation — nothing
 * selects them, earned or not. A player who has earned nothing and is not at
 * a story stop sees NO set animation: the hand resolves with normal scoring
 * and feedback only.
 *
 * HOUSE RULE (the house-deck model, shipped 84af094d): at a story stop, the
 * room's own animation is the room's celebration in its own house — it plays
 * at that stop whether or not the player has cleared it yet (venue flavor,
 * and a preview of what the clear earns). The clear earns taking it home:
 * picker ownership + use in any other match.
 */

export interface SetAnimDef {
  /** story stop id (also the animation id) */
  stopId: string;
  stopName: string;
  venueId: string;
  /** the animation's own name (picker, unlock notice) */
  name: string;
  /** one-line description of the moment (picker) */
  blurb: string;
}

const COPY: Record<string, { name: string; blurb: string }> = {
  porch: { name: 'Screen Door Slam', blurb: 'The screen door slams on the set side. Finale: the porch light cuts and stays out.' },
  barbershop: { name: 'Next Chair', blurb: 'The cape whisks over the set side — "NEXT!" Finale: the pole stops and the lights go down.' },
  'rec-center': { name: 'Buzzer Beater', blurb: 'The shot clock buzzes and the SET banner drops. Finale: the banner stays — game.' },
  cookout: { name: 'Smoke Out', blurb: 'Grill smoke rolls over the set side, tongs clacking. Finale: the lid closes on them.' },
  corner: { name: 'Gate Down', blurb: 'The bodega gate rolls down over the set side. Finale: it comes down padlocked.' },
  'church-basement': { name: 'Service Over', blurb: 'The folding chairs fold up and stack. Finale: stacked, lights low — service over.' },
  rooftop: { name: 'The Flock', blurb: 'The pigeons burst off the ledge across the set side. Finale: the whole flock, one feather left behind.' },
  'high-rise': { name: 'Going Down', blurb: 'The elevator doors close on the set side. Finale: doors shut, car going down to the lobby.' },
  'the-pjs': { name: "Lights Out", blurb: 'The streetlight buzzes and cuts over the set side, chain-link rattling. Finale: it stays out.' },
  legends: { name: 'Retired', blurb: 'A gold RETIRED stamp slams onto the score. Finale: stamped, roped off, table closed.' },
  king: { name: 'The Crown Settles', blurb: 'The lights narrow to one spotlight and the crown settles. Finale: the spotlight dies last.' },
};

export const SET_ANIMS: SetAnimDef[] = STORY_STOPS.map((s) => ({
  stopId: s.id,
  stopName: s.name,
  venueId: s.venueId,
  name: COPY[s.id]?.name ?? s.name,
  blurb: COPY[s.id]?.blurb ?? '',
}));

export const SET_ANIM_IDS: string[] = SET_ANIMS.map((a) => a.stopId);

export function setAnimForStop(stopId: string | null | undefined): SetAnimDef | null {
  if (!stopId) return null;
  return SET_ANIMS.find((a) => a.stopId === stopId) ?? null;
}

/** The stop whose house animation belongs to a venue ("Match the room").
 *  First stop on the venue wins — The Pj's and the King share the block
 *  (blockAfterDark); the King's animation is the house animation at the King
 *  stop itself (story matches resolve by stop id, never by venue). */
export function setAnimStopForVenue(venueId: string | null | undefined): string | null {
  if (!venueId) return null;
  return SET_ANIMS.find((a) => a.venueId === venueId)?.stopId ?? null;
}

/** Unlocked when the stop has been cleared (derived from story progress,
 *  same derivation as the decks). `cleared === null` (progress still
 *  loading / unknown) counts as locked. */
export function setAnimUnlocked(def: SetAnimDef, cleared: ReadonlySet<string> | null): boolean {
  return !!cleared && cleared.has(def.stopId);
}

/** The line shown on a locked picker row (deck-picker pattern). */
export function setAnimUnlockLine(def: SetAnimDef): string {
  if (def.stopId === 'king') return 'Finish the route — clear The King of the Block in Story Mode';
  return `Clear ${def.stopName} in Story Mode`;
}

/** Outro notice on a first clear (joins the deck notice). Both tiers are
 *  granted by the one unlock, so the one line covers both. */
export function setAnimUnlockNotice(stopId: string | null | undefined): string | null {
  const def = setAnimForStop(stopId);
  return def ? `New set animation unlocked: ${def.name}` : null;
}

/** Which tier a side's cover state calls for: an elimination cover (sheet)
 *  is a game-ending set → FINALE; an on-notice cover (tape) is a regular
 *  set. A hand-1 elimination carries both flags — the finale wins. The tier
 *  keys off the cover FACT, never a list of ending reasons, so any present
 *  or future "this set ended the game" path (score target hit by the set
 *  penalty, first-hand set, repeated set, the third-set rule) lands on the
 *  finale tier through the cover the engine already produces. */
export function setTierForCover(cover: Pick<ShotCover, 'tape' | 'sheet'>): 'regular' | 'finale' | null {
  if (cover.sheet) return 'finale';
  if (cover.tape) return 'regular';
  return null;
}

/** The third-set ending's reason id, as exposed by the rules engine
 *  (the "3 the Hard Way" game-over). Compared as a plain string so this
 *  stays correct the moment the rules union grows the member. */
export const THIRD_SET_END_REASON = 'third-set';

export function isThirdSetEnd(result: Pick<GameResult, 'endReason'> | null | undefined): boolean {
  return !!result && (result.endReason as string) === THIRD_SET_END_REASON;
}

export interface SetAnimResolveInput {
  /** In a story match at this stop (the house) — its animation plays here
   *  regardless of unlocks, for any set side, both tiers. */
  storyStopId?: string | null;
  /** The room's venue (non-story "Match the room" resolution). */
  venueId?: string | null;
  /** The player's picker choice: 'auto' (Match the room) or a stop id. */
  setting?: string;
  /** Cleared story stops (null = still loading / unknown → locked). */
  cleared: ReadonlySet<string> | null;
  /** Non-story matches only: the set side was set BY the viewer's side.
   *  A player only celebrates sets they cause — nobody's earned animation
   *  plays for a set somebody else caused. */
  causedByViewer: boolean;
}

/**
 * Resolve which stop's set animation (if any) plays for one set side.
 * Returns a stop id, or null — no animation, normal scoring only.
 *
 * - Story match: the stop's own animation (the house), unlock or not.
 * - Non-story, set not caused by the viewer: null.
 * - Non-story, equipped stop: that stop's animation, if earned.
 * - Non-story, "Match the room": the venue's stop animation, if earned;
 *   a non-story venue (or a locked one) resolves to null — no fallback.
 */
export function resolveSetAnim(input: SetAnimResolveInput): string | null {
  if (input.storyStopId) return setAnimForStop(input.storyStopId) ? input.storyStopId : null;
  if (!input.causedByViewer) return null;
  const setting = input.setting ?? 'auto';
  if (setting === 'auto') {
    const stopId = setAnimStopForVenue(input.venueId);
    if (!stopId) return null;
    const def = setAnimForStop(stopId);
    return def && setAnimUnlocked(def, input.cleared) ? stopId : null;
  }
  const def = setAnimForStop(setting);
  return def && setAnimUnlocked(def, input.cleared) ? def.stopId : null;
}

/** A stored picker value is 'auto' or a real stop id (an earned check
 *  happens at resolution time, so a stale/locked id simply never plays). */
export function isValidSetAnimSetting(v: unknown): v is string {
  return v === 'auto' || (typeof v === 'string' && !!storyStopById(v));
}
