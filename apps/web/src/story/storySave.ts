/**
 * Story Mode's own save slot (owner, 2026-10-21): a story match survives
 * the app being swiped away, in its OWN storage key — the normal offline
 * save ('bwm.game') is never read or written by story code, and this slot
 * is never touched by normal games. Neither clobbers the other.
 *
 * The payload reuses the SavedGame serializer wholesale (same engine
 * state shape, same parse validation via parseSave) and adds the story
 * wrapper: which stop/track, the attempt context the match started under
 * (so retry-context selection stays correct), and the dialogue session
 * state (milestones already fired + in-match event memory) so the
 * continuous conversation resumes its thread instead of replaying beats
 * or forgetting the events its callbacks reference.
 */
import { parseSave, type SavedGame } from '../save';
import { reportStorySession, type StoryProgress } from './storyApi';

export const STORY_SAVE_KEY = 'bwm.storySave.v1';

export interface StorySessionState {
  /** milestone ids already fired this match ('firstHand', 'pullAway', …) */
  fired: string[];
  /** in-match events that really happened ('nilBusted', 'bigSwing', …) */
  memory: string[];
  /** the sit-down beat already played (never replayed on resume) */
  satDown: boolean;
  /** railbird chime-ins already fired this match (the cap survives resume) */
  railFired: number;
  /** last hand a railbird spoke in (rate discipline survives resume) */
  lastRailHand: number;
}

export interface StorySavedGame extends SavedGame {
  story: {
    stopId: string;
    track: string;
    /** progress facts the match started under (attempt N = attemptsAtStart+1) */
    attemptsAtStart: number;
    clearsAtStart: number;
    session: StorySessionState;
  };
}

export function saveStoryGame(g: Omit<SavedGame, 'v' | 'savedAt'>, story: StorySavedGame['story']): void {
  try {
    const data: StorySavedGame = { v: 1, savedAt: Date.now(), ...g, chat: g.chat.slice(-60), story };
    localStorage.setItem(STORY_SAVE_KEY, JSON.stringify(data));
  } catch { /* quota / private mode: resume just won't be available */ }
  // An open story match exists on this device — the server hears about it
  // (throttled in reportStorySession) so the table can call the player back.
  reportStorySession('open', story.stopId, story.track);
}

export function clearStoryGame(): void {
  // Read the doomed save's story context first: the server session closes
  // for the same stop/track, whichever flow cleared the slot (finish,
  // discard/restart, stale-save drop).
  let ctx: { stopId: string; track: string } | null = null;
  try {
    const raw = localStorage.getItem(STORY_SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<StorySavedGame>;
      if (typeof d.story?.stopId === 'string' && typeof d.story?.track === 'string') {
        ctx = { stopId: d.story.stopId, track: d.story.track };
      }
    }
  } catch { /* unreadable save: nothing to attribute the close to */ }
  try { localStorage.removeItem(STORY_SAVE_KEY); } catch { /* ignore */ }
  if (ctx) reportStorySession('closed', ctx.stopId, ctx.track);
}

export function loadStoryGame(): StorySavedGame | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORY_SAVE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<StorySavedGame>;
    const base = parseSave(raw);
    if (!base || !d.story || typeof d.story.stopId !== 'string' || typeof d.story.track !== 'string') { clearStoryGame(); return null; }
    const session = d.story.session;
    return {
      ...base,
      story: {
        stopId: d.story.stopId,
        track: d.story.track,
        attemptsAtStart: typeof d.story.attemptsAtStart === 'number' ? d.story.attemptsAtStart : 0,
        clearsAtStart: typeof d.story.clearsAtStart === 'number' ? d.story.clearsAtStart : 0,
        session: {
          fired: Array.isArray(session?.fired) ? session.fired.filter((x) => typeof x === 'string') : [],
          memory: Array.isArray(session?.memory) ? session.memory.filter((x) => typeof x === 'string') : [],
          satDown: session?.satDown === true,
          railFired: typeof session?.railFired === 'number' ? session.railFired : 0,
          lastRailHand: typeof session?.lastRailHand === 'number' ? session.lastRailHand : 0,
        },
      },
    };
  } catch {
    clearStoryGame();
    return null;
  }
}

/**
 * Stale-save validation against server progress: a save resurrects only
 * if its stop is still reachable AND no finished game has been recorded
 * at that stop since the save's match began (e.g. cleared on another
 * device). Otherwise the save is dropped silently by the caller.
 */
export function storySaveValidFor(save: StorySavedGame, progress: StoryProgress): boolean {
  if (save.story.track !== progress.track) return false;
  const row = progress.stops.find((s) => s.stopId === save.story.stopId);
  if (!row || row.state === 'locked') return false;
  return row.attempts === save.story.attemptsAtStart && row.clears === save.story.clearsAtStart;
}
