/**
 * Story deck unlocks — derivation + picker plumbing.
 *
 * A story deck is unlocked exactly when the player's own story progress says its
 * stop is cleared (solo track). There is no separate grant: the progress payload
 * IS the unlock ledger, so a clear on any device unlocks the deck everywhere the
 * player signs in. Signed-out players and players with no clears get the free
 * decks only. Availability is computed from the same /api/story/progress payload
 * the story map renders (fetchStoryProgress), cached for the session; the story
 * flow should call invalidateStoryProgress() after posting a result so a fresh
 * clear shows up in the picker without a reload.
 */
import { useEffect, useState } from 'react';
import { deckForStop, type DeckDef } from './decks';
import { fetchStoryProgress, type StoryProgress } from './story/storyApi';

/** Stop ids the player has cleared at least once, from a progress payload. */
export function clearedStopIds(progress: StoryProgress | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of progress?.stops ?? []) if (s.clears > 0) out.add(s.stopId);
  return out;
}

/** Free decks are always unlocked; a story deck needs its stop in `cleared`.
 *  `cleared === null` (progress not loaded yet) treats story decks as locked —
 *  the safe default while the fetch is in flight. */
export function deckUnlocked(deck: DeckDef, cleared: ReadonlySet<string> | null): boolean {
  if (!deck.storyStopId) return true;
  return !!cleared?.has(deck.storyStopId);
}

/** The picker's unlock line for a locked story deck ("Clear The Pj's in Story Mode"). */
export function deckUnlockLine(deck: DeckDef): string | null {
  if (!deck.storyStopId || !deck.storyStopName) return null;
  if (deck.storyStopId === 'king') return 'Finish the route — clear The King of the Block in Story Mode';
  return `Clear ${deck.storyStopName} in Story Mode`;
}

/** One-line unlock announcement for the story outro/rewards moment, e.g.
 *  "New deck unlocked: Pj's Iron". The story flow calls this when a result
 *  comes back with firstClear for a stop (see StoryHome integration note). */
export function deckUnlockNotice(stopId: string): string | null {
  const d = deckForStop(stopId);
  return d ? `New deck unlocked: ${d.name}` : null;
}

type ProgressState = { cleared: Set<string> | null; loaded: boolean };
let cached: Promise<Set<string>> | null = null;

function loadCleared(): Promise<Set<string>> {
  if (!cached) {
    cached = fetchStoryProgress('solo').then((r) => (r.status === 'ok' ? clearedStopIds(r.progress) : new Set<string>()));
  }
  return cached;
}

/** Drop the cached progress (call after a story result is posted). */
export function invalidateStoryProgress(): void { cached = null; }

/** Cleared-stop set for the signed-in player (empty when signed out / on error). */
export function useClearedStoryStops(): ProgressState {
  const [state, setState] = useState<ProgressState>({ cleared: null, loaded: false });
  useEffect(() => {
    let live = true;
    void loadCleared().then((cleared) => { if (live) setState({ cleared, loaded: true }); });
    return () => { live = false; };
  }, []);
  return state;
}
