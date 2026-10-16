/**
 * In-progress game persistence (localStorage). The whole GameState is plain JSON and the bots are stateless
 * (their choices derive from the visible state + a per-turn seed), so state + settings + chat is everything
 * needed to resume at exactly the same point.
 */
import { type GameState, pendingTurn, viewFor } from '@spades/rules';
import type { ChatMsg } from './overlay';
import { DEFAULT_SETTINGS, type Settings } from './settings';

export const SAVE_KEY = 'bwm.game';
export const SAVE_VERSION = 1;

export interface SavedGame {
  v: typeof SAVE_VERSION;
  savedAt: number;
  seed: string;
  settings: Settings;
  state: GameState;
  chat: ChatMsg[];
  /** local-seat names (0 = 'You'); bots' random names stay the same across refresh / resume */
  names?: string[];
  /** team modes: the bots' random team name ([1]); yours comes from More options */
  teamNames?: (string | null)[];
  /** the nuke level this game started with (locked for the game) */
  nuke?: 'full' | 'classic' | 'off';
}

export function saveGame(g: Omit<SavedGame, 'v' | 'savedAt'>): void {
  try {
    const data: SavedGame = { v: SAVE_VERSION, savedAt: Date.now(), ...g, chat: g.chat.slice(-60) };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch { /* quota / private mode: resume just won't be available */ }
}

export function clearGame(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/**
 * Opening the app, refreshing, and landing on Home always show the menu. A saved
 * unfinished bot game is not resumed on its own: the save stays in storage for the
 * existing Resume button, and nothing asks the player to continue. `autostart` is
 * the test hook and starts a new game. `state` and `saved` stay in the signature so
 * every former auto-resume path is still checked.
 */
export function resumeOnLoad(state: unknown, saved: SavedGame | null, autostart: boolean): SavedGame | null {
  void state;
  void saved;
  void autostart;
  return null;
}

const isArr = (x: unknown): x is unknown[] => Array.isArray(x);

/** Parse + validate a save. Anything old, corrupted or finished is discarded (returns null and clears it). */
export function parseSave(raw: string | null): SavedGame | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<SavedGame>;
    if (!d || d.v !== SAVE_VERSION || typeof d.seed !== 'string' || !d.state || !d.settings) return null;
    const st = d.state;
    const n = st.rules?.playerCount;
    if (n !== 3 && n !== 4) return null;
    if (typeof st.phase !== 'string' || st.phase === 'gameOver' || !isArr(st.hands) || st.hands.length !== n) return null;
    if (!isArr(st.bids) || !isArr(st.scores) || !isArr(st.tricks) || !st.trick || !isArr(st.trick.plays) || !isArr(st.history)) return null;
    if (typeof st.handNo !== 'number' || typeof st.dealer !== 'number') return null;
    // must be a state the engine accepts
    viewFor(st, 0);
    pendingTurn(st);
    return { v: SAVE_VERSION, savedAt: d.savedAt ?? 0, seed: d.seed, settings: { ...DEFAULT_SETTINGS, ...d.settings }, state: st, chat: isArr(d.chat) ? (d.chat as ChatMsg[]) : [], ...(isArr(d.names) && d.names.length === n && d.names.every((x) => typeof x === 'string') ? { names: d.names as string[] } : {}), ...(isArr(d.teamNames) ? { teamNames: d.teamNames.map((x) => (typeof x === 'string' ? x.slice(0, 40) : null)) } : {}) };
  } catch {
    return null;
  }
}

export function loadGame(): SavedGame | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return null; }
  const g = parseSave(raw);
  if (raw && !g) clearGame();
  return g;
}

/** A reload with a saved bot game always opens Home (where Resume is), never a deeper wizard step. */
export function landOnHome(state: unknown, hasSave: boolean): boolean {
  const wiz = (state as { wiz?: string } | null)?.wiz;
  return hasSave && wiz !== undefined && wiz !== 'home';
}

/** Deal me in never silently replaces a game in progress. */
export function confirmReplaceSave(saved: SavedGame | null, ask: (msg: string) => boolean): boolean {
  if (!saved) return true;
  return ask(`Start a new game? Your game in progress (hand ${saved.state.handNo}) will be lost. Tap Cancel, then Back, to resume it.`);
}
