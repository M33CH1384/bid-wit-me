/**
 * Story film SELECTION (Chapter 1) — the pure decision layer, modeled
 * on rundownVideo.ts. StoryHome asks these pickers at the manifest's
 * four hooks; every input is a fact the game already holds (the same
 * StoryBeatFacts inputs beatsFor reads, plus the posted result), so
 * the film surface and the beat surface can never select different
 * branches for the same match.
 *
 * The rules, per MANIFEST-CH1.json:
 *   - Teaser (map, first entry): solo track, no stop cleared yet, no
 *     Porch attempt yet, never offered. Once per track.
 *   - Pregame (intro scene step): solo, the Porch, attempts == 0,
 *     never offered. Return visits never select it — and a resumed
 *     match never reaches the intro at all (storySave law), so no
 *     film can replay on resume.
 *   - Post-win (outro): solo, the Porch, a WIN the server posted as
 *     this track's FIRST CLEAR, keyed to that posted gameId. A replay
 *     win (new gameId, firstClear false) never selects it — the
 *     shipped outro coda carries replays.
 *   - Post-loss (outro): solo, the Porch, a posted LOSS. Every
 *     completed loss is a new gameId and may select it again; the
 *     same gameId never re-offers.
 *   - Preview (outro → map exit): only on the first-clear path —
 *     this outro is that win, the clear is posted (clears >= 1),
 *     never offered. Never after a loss, a discard, or a replay.
 *
 * A scene that failed this session (decode error, missing file) is
 * never re-selected this session — the rundownVideo session-failure
 * rule. Selection says nothing about assets: a picked scene whose
 * footage does not exist yet plays as the player's labeled poster
 * presentation (StoryFilmScene), and a picked scene that fails hands
 * the flow back to the shipped fallback (the beat scene, or nothing
 * for teaser/preview, per the manifest's fallback modes).
 */
import { filmSceneById, filmSceneByType, type FilmScene } from './storyFilmManifest';
import { isFilmKeySeen, offeredGameId, type FilmSeenState } from './storyFilmSeen';

/* Session failures: scene ids that errored since this page loaded. */
const failed = new Set<string>();
export function markFilmSceneFailed(sceneId: string) { failed.add(sceneId); }
export function filmSceneFailed(sceneId: string) { return failed.has(sceneId); }
export function resetFilmSceneFailures() { failed.clear(); }

export interface TeaserFacts { track: string; stopsCleared: number; attemptsAtStop: number }
export interface PregameFacts { track: string; stopId: string; attemptsAtStop: number }
export interface PostSceneFacts { track: string; stopId: string; won: boolean; firstClear: boolean; gameId: string | null }
export interface PreviewFacts { track: string; stopId: string; won: boolean; firstClear: boolean; clearsAtStop: number }

const SOLO = 'solo';

function live(scene: FilmScene | undefined): FilmScene | null {
  return scene && !failed.has(scene.id) ? scene : null;
}

export function pickTeaser(facts: TeaserFacts, seen: FilmSeenState): FilmScene | null {
  const scene = filmSceneByType('teaser');
  if (!scene || facts.track !== SOLO) return null;
  if (facts.stopsCleared !== 0 || facts.attemptsAtStop !== 0) return null;
  if (scene.seenKey && isFilmKeySeen(seen, scene.seenKey)) return null;
  return live(scene);
}

export function pickPregame(facts: PregameFacts, seen: FilmSeenState): FilmScene | null {
  const scene = filmSceneByType('pregame');
  if (!scene || facts.track !== SOLO || facts.stopId !== 'porch') return null;
  if (facts.attemptsAtStop !== 0) return null;
  if (scene.seenKey && isFilmKeySeen(seen, scene.seenKey)) return null;
  return live(scene);
}

export function pickPostScene(facts: PostSceneFacts, seen: FilmSeenState): FilmScene | null {
  if (facts.track !== SOLO || facts.stopId !== 'porch' || !facts.gameId) return null;
  if (facts.won) {
    if (!facts.firstClear) return null; // a replay win belongs to the shipped coda
    const scene = filmSceneByType('post-win');
    if (!scene || offeredGameId(seen, scene.id) === facts.gameId) return null;
    return live(scene);
  }
  const scene = filmSceneByType('post-loss');
  if (!scene || offeredGameId(seen, scene.id) === facts.gameId) return null;
  return live(scene);
}

export function pickPreview(facts: PreviewFacts, seen: FilmSeenState): FilmScene | null {
  const scene = filmSceneByType('next-match-preview');
  if (!scene || facts.track !== SOLO || facts.stopId !== 'porch') return null;
  if (!facts.won || !facts.firstClear || facts.clearsAtStop < 1) return null;
  if (scene.seenKey && isFilmKeySeen(seen, scene.seenKey)) return null;
  return live(scene);
}

/** For the replay surface (the stop's map card): has this scene ever
 *  been offered on this track? Replays consult the same seen record
 *  and never write to it. */
export function filmSceneOffered(scene: FilmScene, seen: FilmSeenState): boolean {
  if (scene.seenKey) return isFilmKeySeen(seen, scene.seenKey);
  return offeredGameId(seen, scene.id) !== null;
}

export function filmScene(id: string): FilmScene | null {
  return filmSceneById(id) ?? null;
}

/** How a film plays (the DeeRundownVideo plan, restated for scenes):
 *  `muted` when the game's voices cannot sound — the film then leans
 *  on its captions; `autoplay` only on the hook path (a scene the
 *  flow lands on), never in replay browsing, never under reduced
 *  effects — reduced always means a Play button over the poster. */
export function filmPlayback(o: { autoplayPath: boolean; reduced: boolean; voicesOff: boolean }) {
  return { muted: o.voicesOff, autoplay: o.autoplayPath && !o.reduced };
}
