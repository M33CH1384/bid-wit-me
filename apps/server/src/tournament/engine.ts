/**
 * Release 9b tournament engine: pure + JSON-serializable (the Tournament Durable Object stores it as one row).
 * An entry is a team (2v2 modes: two players) or a single player (Cutthroat). A match is one game at one table with
 * k entries (2 teams, or 3–4 Cutthroat players).
 *  - Single elimination: the winner of each match advances (byes when the field isn't full); last one standing wins.
 *  - Swiss: the host picks the number of rounds; each round pairs entries with similar points (no rematches when
 *    avoidable); a match awards placement points (k−1 for 1st … 0 for last), tiebreak = total game score.
 */

export type Format = 'single' | 'swiss';
export interface Entry { id: string; name: string; members: { uid: string; name: string }[]; seed: number; checkedIn: boolean; dropped?: boolean }
export interface Match {
  id: string;
  round: number;
  entries: string[];             // entry ids, in seat order (teams: side 0, side 1)
  table?: string;                // room code once seated
  status: 'pending' | 'live' | 'done';
  /** entry ids in finishing order (ties share via `places`) */
  result?: { places: number[]; scores: number[] };
  bye?: boolean;
}
export interface TState {
  format: Format;
  k: number;                     // entries per match
  rounds: number;                // Swiss: host-picked; single: computed at start
  round: number;                 // current round (1-based; 0 = not started)
  entries: Entry[];
  matches: Match[];
  points: Record<string, number>;
  scoreSum: Record<string, number>;
  champion?: string;             // entry id
  done: boolean;
}

export function newState(format: Format, k: number, rounds: number, entries: Entry[]): TState {
  return { format, k, rounds, round: 0, entries, matches: [], points: {}, scoreSum: {}, done: false };
}

/** deterministic shuffle (seeded) so a restart reproduces the same draw */
export function shuffle<T>(a: T[], seed: number): T[] {
  const out = [...a];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const active = (st: TState) => st.entries.filter((e) => !e.dropped);

/** Start: drop no-shows (unless bots will play for them), compute rounds, seed round 1. */
export function start(st: TState, opts: { botsForNoShows: boolean; seed: number }): TState {
  const s: TState = structuredClone(st);
  for (const e of s.entries) if (!e.checkedIn && !opts.botsForNoShows) e.dropped = true;
  const n = active(s).length;
  if (n < 2) { s.done = true; return s; }
  if (s.format === 'single') s.rounds = Math.max(1, Math.ceil(Math.log(n) / Math.log(s.k)));
  for (const e of active(s)) { s.points[e.id] = 0; s.scoreSum[e.id] = 0; }
  return nextRound(s, opts.seed);
}

function chunk<T>(a: T[], k: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += k) out.push(a.slice(i, i + k));
  return out;
}

/** entries still alive in single elimination */
function alive(s: TState): string[] {
  if (s.round === 0) return active(s).map((e) => e.id);
  const last = s.matches.filter((m) => m.round === s.round);
  return last.flatMap((m) => (m.bye ? m.entries : m.result ? m.entries.filter((_, i) => m.result!.places[i] === 1).slice(0, 1) : []));
}

function nextRound(s: TState, seed: number): TState {
  const round = s.round + 1;
  let groups: string[][];
  if (s.format === 'single') {
    const ids = s.round === 0 ? shuffle(active(s), seed).sort((a, b) => a.seed - b.seed).map((e) => e.id) : alive(s);
    if (ids.length <= 1) return finish(s, ids[0]);
    groups = [];
    let rest = [...ids];
    if (s.k === 2) {
      // round 1: top seeds get byes up to the next power of two, then fold (1st vs last, 2nd vs second-last…)
      if (s.round === 0) {
        let p = 1;
        while (p < rest.length) p *= 2;
        const byes = p - rest.length;
        groups.push(...rest.slice(0, byes).map((id) => [id]));
        rest = rest.slice(byes);
      }
      while (rest.length >= 2) groups.push([rest.shift()!, rest.pop()!]);
      if (rest.length) groups.push([rest.shift()!]);
    } else {
      // Cutthroat tables of k (a short table plays with bots in the empty seats; a lone entry gets a bye)
      groups.push(...chunk(rest, s.k));
    }
  } else {
    if (round > s.rounds) return finish(s, standings(s)[0]?.id);
    // Swiss: sort by points (ties: score), then pair down avoiding rematches where possible
    const order = (s.round === 0 ? shuffle(active(s), seed) : active(s)).map((e) => e.id)
      .sort((a, b) => (s.points[b]! - s.points[a]!) || (s.round === 0 ? 0 : s.scoreSum[b]! - s.scoreSum[a]!));
    const met = new Set(s.matches.flatMap((m) => m.entries.flatMap((a) => m.entries.filter((b) => b !== a).map((b) => `${a}|${b}`))));
    groups = pairSwiss(order, s.k, met);
    // a lone leftover (odd field) gets a bye worth a win
  }
  s.round = round;
  groups.forEach((g, i) => {
    const m: Match = { id: `r${round}m${i + 1}`, round, entries: g, status: g.length === 1 ? 'done' : 'pending', ...(g.length === 1 ? { bye: true } : {}) };
    if (m.bye && s.format === 'swiss') s.points[g[0]!] = (s.points[g[0]!] ?? 0) + (s.k - 1);
    s.matches.push(m);
  });
  return roundDone(s) ? nextRound(s, seed) : s;
}

/** Swiss grouping: keep the points order, avoid rematches (depth-first search; greedy fallback for big fields). */
function pairSwiss(order: string[], k: number, met: Set<string>): string[][] {
  const fresh = (g: string[], c: string) => g.every((x) => !met.has(`${x}|${c}`));
  let budget = 20000;
  const dfs = (pool: string[]): string[][] | null => {
    if (!pool.length) return [];
    if (--budget < 0) return null;
    const [first, ...rest] = pool;
    if (rest.length < k - 1) return [[first!, ...rest]]; // short last table / bye
    const pick = (g: string[], from: string[], need: number): string[][] | null => {
      if (!need) {
        const r = dfs(from);
        return r ? [g, ...r] : null;
      }
      for (let i = 0; i < from.length; i++) {
        if (!fresh(g, from[i]!)) continue;
        const r = pick([...g, from[i]!], [...from.slice(0, i), ...from.slice(i + 1)], need - 1);
        if (r) return r;
      }
      return null;
    };
    return pick([first!], rest, k - 1);
  };
  const best = dfs(order);
  if (best) return best;
  const groups: string[][] = [];
  const pool = [...order];
  while (pool.length) {
    const g = [pool.shift()!];
    while (g.length < k && pool.length) {
      const i = pool.findIndex((c) => fresh(g, c));
      g.push(pool.splice(i >= 0 ? i : 0, 1)[0]!);
    }
    groups.push(g);
  }
  return groups;
}

function roundDone(s: TState): boolean {
  return s.matches.filter((m) => m.round === s.round).every((m) => m.status === 'done');
}

function finish(s: TState, champion: string | undefined): TState {
  s.done = true;
  if (champion) s.champion = champion;
  return s;
}

/** A match finished: per-entry final scores (in m.entries order) and places (1 = won). */
export function report(st: TState, matchId: string, scores: number[], places: number[], seed = 1): TState {
  const s: TState = structuredClone(st);
  const m = s.matches.find((x) => x.id === matchId);
  if (!m || m.status === 'done' || s.done) return st;
  m.status = 'done';
  m.result = { places, scores };
  m.entries.forEach((id, i) => {
    s.points[id] = (s.points[id] ?? 0) + Math.max(0, m.entries.length - places[i]!) ;
    s.scoreSum[id] = (s.scoreSum[id] ?? 0) + (scores[i] ?? 0);
  });
  if (s.format === 'single') {
    // ties for first in a knockout: the higher score breaks it, then the better seed
    const firsts = m.entries.map((id, i) => ({ id, i })).filter((x) => places[x.i] === 1);
    if (firsts.length > 1) {
      const best = firsts.sort((a, b) => (scores[b.i]! - scores[a.i]!) || (seedOf(s, a.id) - seedOf(s, b.id)))[0]!;
      m.result.places = m.entries.map((_, i) => (i === best.i ? 1 : Math.max(2, places[i]!)));
    }
  }
  return roundDone(s) ? nextRound(s, seed) : s;
}

const seedOf = (s: TState, id: string) => s.entries.find((e) => e.id === id)?.seed ?? 999;

export function standings(s: TState): { id: string; name: string; points: number; score: number; wins: number; played: number; out: boolean }[] {
  const rows = active(s).map((e) => {
    const ms = s.matches.filter((m) => m.status === 'done' && m.entries.includes(e.id) && !m.bye);
    const wins = ms.filter((m) => m.result!.places[m.entries.indexOf(e.id)] === 1).length;
    const out = s.format === 'single' && ms.some((m) => m.result!.places[m.entries.indexOf(e.id)] !== 1);
    return { id: e.id, name: e.name, points: s.points[e.id] ?? 0, score: s.scoreSum[e.id] ?? 0, wins, played: ms.length, out };
  });
  if (s.format === 'single') {
    // champion first, then by how far they got
    const reached = (id: string) => Math.max(0, ...s.matches.filter((m) => m.entries.includes(id)).map((m) => m.round));
    return rows.sort((a, b) => (+(b.id === s.champion) - +(a.id === s.champion)) || (reached(b.id) - reached(a.id)) || (b.wins - a.wins) || (b.score - a.score));
  }
  return rows.sort((a, b) => (b.points - a.points) || (b.score - a.score) || (b.wins - a.wins));
}

/** matches ready to seat */
export function pendingMatches(s: TState): Match[] {
  return s.matches.filter((m) => m.status === 'pending' && m.round === s.round);
}
