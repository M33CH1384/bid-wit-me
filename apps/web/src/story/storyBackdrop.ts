/**
 * Story Mode: a stop's OWN backdrop art (story-art pass, 2026-10-21).
 *
 * Every stop borrows a venue (stop.venueId) for its table dressing, rules
 * and audio identity — but the borrowed venue's panorama often depicts a
 * different place entirely (the Porch played under a modern loft, the
 * Barbershop under a cell-phone store, the Rec Center under nothing at
 * all: the classic venue ships no bg.jpg). The stops now carry their own
 * photorealistic backdrops under public/assets/story/venues/<stopId>.jpg,
 * story-scoped exactly like the STORY_STOP_AUDIO ambience override and the
 * house-deck override in storySettingsFor: story surfaces resolve the
 * stop's backdrop through here, and the shared venue backdrops — and every
 * non-story surface that reads them — are untouched.
 *
 * The Pj's and the King of the Block are the exceptions: their venue
 * (blockAfterDark) was purpose-made for those stops, so they keep its
 * panorama.
 */
import { storyStopById, type StoryStop } from '@spades/bots';

/** Stops with their own story backdrop art, in route order. */
export const STORY_BACKDROP_STOPS: readonly string[] = [
  'porch',
  'barbershop',
  'rec-center',
  'cookout',
  'corner',
  'church-basement',
  'rooftop',
  'high-rise',
  'legends',
];

export function storyBackdropUrl(stop: StoryStop): string {
  return STORY_BACKDROP_STOPS.includes(stop.id)
    ? `/assets/story/venues/${stop.id}.jpg`
    : `/assets/venues/${stop.venueId}/bg.jpg`;
}

/** Same resolution for surfaces that hold only a stop id (or none). */
export function storyBackdropUrlForStopId(stopId: string | undefined): string | null {
  if (!stopId) return null;
  const stop = storyStopById(stopId);
  return stop ? storyBackdropUrl(stop) : null;
}
