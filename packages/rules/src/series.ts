/**
 * Rematch series: a running tally of games won per side (team, or player in Cutthroat) while the same people keep
 * playing together. Pure + JSON-serializable so the server (online), the save file (offline) and a future
 * stats/profile system can all store and ingest the same record.
 *
 * Identity: a side is keyed by WHO is on it (stable player ids; bots by seat), never by its display name, so renaming
 * a team keeps the series while a partner swap resets it.
 */
import type { GameState } from './game';
import { isBooksHand, sideCount, sideOf } from './scoring';

export const SERIES_VERSION = 1;

export interface SeriesSide {
  /** stable composition key, e.g. "p:abc+p:def" or "bot:1+you" */
  key: string;
  /** stable member ids (player ids online, 'you' / 'bot:<seat>' offline) */
  members: string[];
  /** display name at the most recent game (team name or player name) */
  name: string;
}

export interface SeriesGame {
  no: number;
  /** epoch ms when the game ended */
  at: number;
  hands: number;
  /** final score per side */
  final: number[];
  /** winning side indexes (ties share) */
  winners: number[];
  /** side display names when this game was played */
  names: string[];
  /** cumulative score per side after each hand: totals[hand][side] */
  totals: number[][];
  /** per side: times that side was set (missed its bid) */
  sets: number[];
  /** per side: Wheels made (team bid 10+ and made it; Cutthroat: took 10+ books) */
  wheels: number[];
  /** per side: nukes dropped (Big Joker over Little Joker) */
  nukes: number[];
  /** per side: Nils made / busted */
  nilsMade: number[];
  nilsBusted: number[];
  /** per side: hands shot (house rule Shot = out; optional in older records) */
  shots?: number[];
  /** how the game ended ('shotOut' = a side was shot out) */
  endReason?: 'target' | 'floor' | 'shotOut';
  /** sides shot out (endReason 'shotOut') */
  shotOut?: number[];
}

export interface Series {
  v: typeof SERIES_VERSION;
  /** mode + every side's composition key; a different key means a different series */
  key: string;
  mode: string;
  sides: SeriesSide[];
  /** games won per side */
  wins: number[];
  games: SeriesGame[];
  /** set when a previous series was reset because the teams changed */
  note?: string;
}

/** Composition key for a side: sorted member ids. */
export function sideKey(members: readonly string[]): string {
  return [...members].sort().join('+');
}

/** Sides of a table from per-seat member ids + display names (teams: partners together; Cutthroat: one per seat). */
export function seriesSides(state: Pick<GameState, 'rules'>, seatIds: readonly string[], sideNames: readonly string[]): SeriesSide[] {
  const r = state.rules;
  const sides: SeriesSide[] = Array.from({ length: sideCount(r) }, (_, i) => ({ key: '', members: [], name: sideNames[i] ?? `Side ${i + 1}` }));
  for (let seat = 0; seat < r.playerCount; seat++) sides[sideOf(seat, r)]!.members.push(seatIds[seat] ?? `seat:${seat}`);
  for (const s of sides) { s.members.sort(); s.key = sideKey(s.members); }
  return sides;
}

export function seriesKey(mode: string, sides: readonly SeriesSide[]): string {
  return `${mode}|${sides.map((s) => s.key).join('|')}`;
}

/** Summarize a finished game for the series (hand-by-hand totals + highlights). */
export function summarizeGame(st: GameState, names: readonly string[], no: number, at: number): SeriesGame {
  const n = sideCount(st.rules);
  const zero = () => Array<number>(n).fill(0);
  const sets = zero(), wheels = zero(), nilsMade = zero(), nilsBusted = zero(), shots = zero();
  for (const h of st.history) {
    for (const s of h.sides) {
      if (s.shot) shots[s.side]!++;
      if (s.contractMade === false) sets[s.side]!++;
      // team wheels: a made 10+ bid, or 10+ books on the first hand where books bid themselves (no bids that hand)
      if (st.rules.partnerships ? (s.contract >= 10 && s.contractMade === true) || (isBooksHand(h.bids) && s.tricks >= 10) : s.tricks >= 10) wheels[s.side]!++;
      for (const nil of s.nils) { if (nil.made) nilsMade[s.side]!++; else nilsBusted[s.side]!++; }
    }
  }
  const final = st.result?.finalScores ?? [...st.scores];
  return {
    no, at, hands: st.history.length, final: [...final], winners: st.result ? [...st.result.winners] : [],
    names: [...names], totals: st.history.map((h) => h.sides.map((s) => s.totalScore)),
    sets, wheels, nukes: st.nukes ? [...st.nukes] : zero(), nilsMade, nilsBusted, shots,
    ...(st.result ? { endReason: st.result.endReason } : {}), ...(st.result?.shotOut ? { shotOut: [...st.result.shotOut] } : {}),
  };
}

/** A series with no games yet (shown as 0–0 after a reset, with the note). */
export function emptySeries(mode: string, sides: SeriesSide[], note?: string): Series {
  return { v: SERIES_VERSION, key: seriesKey(mode, sides), mode, sides, wins: sides.map(() => 0), games: [], ...(note ? { note } : {}) };
}

/**
 * Add a finished game. Starts a fresh series when there is none or the composition / mode changed (with a note).
 * Display names are refreshed (a renamed team keeps its series).
 */
export function addSeriesGame(prev: Series | null | undefined, mode: string, sides: SeriesSide[], game: Omit<SeriesGame, 'no'>): Series {
  const key = seriesKey(mode, sides);
  let s: Series;
  if (!prev || prev.key !== key) {
    s = { v: SERIES_VERSION, key, mode, sides, wins: sides.map(() => 0), games: [] };
    if (prev && prev.games.length) s.note = 'New series: the teams changed';
  } else {
    s = { ...prev, sides, wins: [...prev.wins], games: [...prev.games] };
    if (prev.games.length) delete s.note; // keep a fresh reset's note through its first game
  }
  const g: SeriesGame = { ...game, no: s.games.length + 1 };
  s.games.push(g);
  for (const w of g.winners) s.wins[w] = (s.wins[w] ?? 0) + 1;
  return s;
}

/** Whether a series still matches the table (same mode + composition). */
export function seriesMatches(s: Series | null | undefined, mode: string, sides: readonly SeriesSide[]): boolean {
  return !!s && s.key === seriesKey(mode, sides);
}

/** Compact "3–1" (teams) or "2–1–0" (Cutthroat) tally. */
export function seriesTally(s: Series): string {
  return s.wins.join('–');
}

/**
 * Series a game opens with. A new game is 0–0 (no carried wins). Rematch, or resuming the
 * saved game, keeps the tally the player already has.
 */
export function seriesForGameStart(prev: Series | null | undefined, resumeSeries: boolean): Series | null {
  if (!resumeSeries || !prev) return null;
  return prev;
}
