/**
 * BWM Central Phase 2 — the Headlines engine (pure, deterministic).
 *
 * Every story is a template over VERIFIED payload fields that already
 * exist — the results feed, the caller's /api/profile/me, the caller's
 * social-profile h2h, Power Rankings, live highlights, the Big Bank
 * wager list, and the social store's friends / pending invites / open
 * tables. No commentary is invented: each story type has an explicit
 * eligibility rule (below), a fact that cannot be anchored does not
 * become a card, timestamps are the payloads' own, and anything
 * unavailable is simply absent.
 *
 * Eligibility, in priority order:
 *  - own-result:     the caller's newest feed result (names-based, as
 *                    Phase 1 — the feed carries names, not ids; guests
 *                    get none). Anchor: the game's id + endedAt (at).
 *  - challenge-set:  a Big Bank challenge in an upcoming state
 *                    (pending/scheduled/checkin/live) whose players[]
 *                    include the caller, else a pending table invite
 *                    addressed to the caller. The card states the state
 *                    word (Pending/Accepted/Check-in open/Live).
 *  - rivalry:        the caller's top rivalry (>= 3 meetings) ONLY when
 *                    the pair's latest meeting is findable in the feed
 *                    (anchored to that game). Copy is the series state:
 *                    the leader named, or ALL SQUARE when tied.
 *  - milestone:      the nearest completable milestone from real
 *                    progress — an unclaimed challenge with progress > 0
 *                    (title + progress/target), or level progress with
 *                    progress > 0 (XP into the level; at 0 the level has
 *                    not been started and fires NO story, so a brand-new
 *                    player sees the honest empty state) — whichever has
 *                    the highest fraction.
 *  - friends-result: the newest feed result containing a friend (store
 *                    friends), not the caller.
 *  - watch:          public tables exist in the store.
 *  - wire leftovers: remaining feed results, live highlights, Power
 *                    movers — in that order, up to the cap.
 *
 * Seen-set: the caller passes the ids already shown (persisted by the
 * component in localStorage, capped). A story shows as "new" (isNew)
 * exactly once; on later visits new stories lead and seen stories keep
 * their priority order behind them — a story ages into the wire, it
 * never repeats as a headline.
 */
import { myLatestResult, powerMovers, type PowerRowLike } from './central';
import { buildRivalries, type H2hRow } from './rivalries';
import type { LiveHighlight, RecentResult } from './LeagueTicker';

export const HEADLINES_MAX = 12;
export const HEADLINE_SEEN_KEY = 'bwm.central.headlinesSeen';
export const HEADLINE_SEEN_CAP = 100;

const MODE_LABEL: Record<string, string> = { joker: 'Joker', aceDown: 'Ace Down', cutthroat: 'Cutthroat', cutthroat4: 'Cutthroat' };
export const headlineModeLabel = (m: string | undefined): string => (m ? MODE_LABEL[m] ?? m : 'Spades');

/** One result line from the feed's stored facts only (ticker grammar). */
export function resultLine(r: RecentResult): string {
  const mode = headlineModeLabel(r.mode);
  const won = r.sides.filter((s) => s.won);
  const lost = r.sides.filter((s) => !s.won);
  const names = (s: RecentResult['sides'][number]) => s.names.join(' + ');
  const flags = r.wheels ? ' · Wheels' : '';
  const scoresDesc = [...r.sides].sort((a, b) => b.score - a.score).map((s) => s.score).join('–');
  if (won.length !== 1) return `${won.map(names).join(' & ')} tied · ${mode} ${scoresDesc}${flags}`;
  if (r.kind === 'cutthroat') return `${names(won[0]!)} won ${mode} ${scoresDesc}${flags}`;
  if (!lost.length) return '';
  return `${names(won[0]!)} def. ${names(lost[0]!)} ${won[0]!.score}–${lost[0]!.score} · ${mode}${flags}`;
}

/* ---------------------------------------------------------------- inputs */

export interface MeChallengeLike { id: string; title: string; progress: number; target: number; claimed: boolean }
export interface MeProfileLike {
  level?: { level: number; xp?: number; xpForNext?: number; xpIntoLevel?: number; title?: string } | null;
  challenges?: {
    daily?: MeChallengeLike[]; weekly?: MeChallengeLike[];
    season?: { challenges?: MeChallengeLike[] } | null;
  } | null;
  /** carried on the payload; no Phase 2 story type reads it yet */
  streakFire?: unknown;
}
export interface WagerRowLike {
  id: string; status: string; startAt: number; mode?: string; format?: string; wager?: number;
  players: { uid: string; name: string; status?: string }[];
}
export interface InviteLike {
  id: string; from: string; fromName: string; code: string; mode?: string; seat?: number;
  expiresAt: number; kind?: string; stopId?: string;
}
export interface TableLike { code: string; mode?: string; status?: string; humans?: number; open?: number }

export interface HeadlineInputs {
  myName: string | null;
  /** the caller's account id (wager players[] match on this) */
  myUid: string | null;
  results: RecentResult[];
  me: MeProfileLike | null;
  h2h: H2hRow[];
  powerRows: PowerRowLike[];
  highlights: LiveHighlight[];
  wagers: WagerRowLike[];
  /** pending table invites ADDRESSED TO the caller (the store's list) */
  invites: InviteLike[];
  sentInvites: { to: string; expiresAt: number }[];
  friendNames: string[];
  tables: TableLike[];
  /** story ids already shown to this caller on earlier visits */
  seen: string[];
}

export type HeadlineAction =
  | { kind: 'match'; id: string }
  | { kind: 'profile'; name: string; id?: string }
  | { kind: 'rankings' }
  | { kind: 'career' }
  | { kind: 'challenge'; id: string }
  | { kind: 'invite'; id: string }
  | { kind: 'lobby' }
  | { kind: 'watch-table'; code: string }
  | { kind: 'none' };

export type HeadlineType =
  | 'own-result' | 'challenge-set' | 'rivalry' | 'milestone' | 'friends-result'
  | 'watch' | 'wire-result' | 'live' | 'power';

export interface HeadlineCard {
  /** stable: type + subject + anchor — the same inputs rebuild the same id */
  id: string;
  type: HeadlineType;
  title: string;
  text: string;
  /** the payload's own timestamp for the anchored fact, else null */
  at: number | null;
  isNew: boolean;
  action: HeadlineAction;
  subject: string;
}

type RawCard = Omit<HeadlineCard, 'isNew'>;

/* --------------------------------------------------------------- milestone */

export type Milestone =
  | { kind: 'challenge'; id: string; title: string; progress: number; target: number; fraction: number }
  | { kind: 'level'; level: number; nextLevel: number; xpIntoLevel: number; xpForNext: number; remaining: number; fraction: number };

/** The nearest completable milestone in the caller's real progress:
 *  unclaimed challenges with progress > 0 compete with level progress
 *  (also progress > 0 — 0 XP into a level is no progress at all) on
 *  progress fraction alone (ties: a challenge before the level). */
export function nearestMilestone(me: MeProfileLike | null): Milestone | null {
  if (!me) return null;
  const out: Milestone[] = [];
  const groups = [me.challenges?.daily ?? [], me.challenges?.weekly ?? [], me.challenges?.season?.challenges ?? []];
  for (const list of groups) {
    for (const c of list) {
      if (c.claimed || !(c.progress > 0) || !(c.target > 0)) continue;
      out.push({
        kind: 'challenge', id: c.id, title: c.title, progress: c.progress, target: c.target,
        fraction: Math.min(1, c.progress / c.target),
      });
    }
  }
  const lv = me.level;
  if (lv && typeof lv.xpForNext === 'number' && lv.xpForNext > 0 && typeof lv.xpIntoLevel === 'number' && lv.xpIntoLevel > 0) {
    const remaining = lv.xpForNext - lv.xpIntoLevel;
    if (remaining > 0) {
      out.push({
        kind: 'level', level: lv.level, nextLevel: lv.level + 1,
        xpIntoLevel: lv.xpIntoLevel, xpForNext: lv.xpForNext, remaining,
        fraction: Math.min(1, lv.xpIntoLevel / lv.xpForNext),
      });
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => b.fraction - a.fraction || (a.kind === b.kind ? 0 : a.kind === 'challenge' ? -1 : 1));
  return out[0]!;
}

/* ------------------------------------------------------------ challenge-set */

const WAGER_UPCOMING: Record<string, string> = {
  pending: 'Pending', scheduled: 'Accepted', checkin: 'Check-in open', live: 'Live',
};
export const challengeStateWord = (status: string): string | null => WAGER_UPCOMING[status] ?? null;

/* ------------------------------------------------------------------- seen */

export function parseSeenIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string');
  } catch { return []; }
}

/** Fold newly-shown ids into the seen set: deduped, capped (oldest drop). */
export function markSeenIds(seen: readonly string[], ids: readonly string[]): string[] {
  const out = [...seen];
  const have = new Set(out);
  for (const id of ids) if (!have.has(id)) { have.add(id); out.push(id); }
  return out.slice(-HEADLINE_SEEN_CAP);
}

/* ----------------------------------------------------------------- engine */

export function buildHeadlines(input: HeadlineInputs): HeadlineCard[] {
  const { myName, myUid, results } = input;
  const stories: RawCard[] = [];
  const usedResults = new Set<string>();
  const usedHighlights = new Set<string>();

  // own-result — the caller's newest feed result (anchor: its game id/at)
  const mine = myLatestResult(results, myName);
  if (mine) {
    usedResults.add(mine.id);
    stories.push({
      id: `own-result:${mine.id}`, type: 'own-result', title: 'Your latest match',
      text: resultLine(mine), at: mine.at, action: { kind: 'match', id: mine.id }, subject: myName ?? '',
    });
  }

  // challenge-set — an upcoming Big Bank challenge the caller is in,
  // else a pending table invite addressed to the caller
  const wager = myUid
    ? input.wagers
      .filter((w) => challengeStateWord(w.status) !== null
        && w.players.some((p) => p.uid === myUid && p.status !== 'declined'))
      .sort((a, b) => a.startAt - b.startAt)[0]
    : undefined;
  if (wager) {
    const others = wager.players.filter((p) => p.uid !== myUid).map((p) => p.name);
    stories.push({
      id: `challenge-set:wager:${wager.id}`, type: 'challenge-set', title: 'Challenge set',
      text: `Big Bank challenge${others.length ? ` vs ${others.join(', ')}` : ''} — ${challengeStateWord(wager.status)}`,
      at: wager.startAt, action: { kind: 'challenge', id: wager.id }, subject: wager.id,
    });
  } else if (input.invites.length) {
    const inv = input.invites[0]!;
    stories.push({
      id: `challenge-set:invite:${inv.id}`, type: 'challenge-set', title: 'Challenge set',
      text: `${inv.fromName} invited you to ${headlineModeLabel(inv.mode)} — Pending`,
      at: null, action: { kind: 'invite', id: inv.id }, subject: inv.fromName,
    });
  }

  // rivalry — >= 3 meetings AND the latest meeting anchored in the feed
  if (myName) {
    const top = buildRivalries(input.h2h, results, myName)
      .find((r) => r.games >= 3 && r.lastMeeting !== null);
    if (top?.lastMeeting) {
      usedResults.add(top.lastMeeting.id);
      const text = top.tied
        ? `ALL SQUARE with ${top.name} — ${top.wins}–${top.losses} in ${top.games} games`
        : top.wins > top.losses
          ? `You lead ${top.name} ${top.wins}–${top.losses} in ${top.games} games`
          : `${top.name} leads you ${top.losses}–${top.wins} in ${top.games} games`;
      stories.push({
        id: `rivalry:${top.id}:${top.lastMeeting.id}`, type: 'rivalry', title: 'Rivalry',
        text, at: top.lastMeeting.at, action: { kind: 'match', id: top.lastMeeting.id }, subject: top.name,
      });
    }
  }

  // milestone — nearest completable, from real progress fields only
  const ms = nearestMilestone(input.me);
  if (ms) {
    stories.push(ms.kind === 'challenge'
      ? {
        id: `milestone:challenge:${ms.id}`, type: 'milestone', title: 'Milestone watch',
        text: `${ms.title} — ${ms.progress}/${ms.target}`, at: null,
        action: { kind: 'career' }, subject: ms.id,
      }
      : {
        id: `milestone:level:${ms.level}`, type: 'milestone', title: 'Milestone watch',
        text: `${ms.remaining} XP to Level ${ms.nextLevel} (${ms.xpIntoLevel}/${ms.xpForNext} XP)`, at: null,
        action: { kind: 'career' }, subject: `level-${ms.level}`,
      });
  }

  // friends-result — newest feed result containing a friend, not the caller
  if (input.friendNames.length) {
    const fr = results.find((r) => !usedResults.has(r.id)
      && r.sides.some((s) => s.names.some((n) => input.friendNames.includes(n)))
      && !(myName && r.sides.some((s) => s.names.includes(myName))));
    if (fr) {
      usedResults.add(fr.id);
      const friend = fr.sides.flatMap((s) => s.names).find((n) => input.friendNames.includes(n)) ?? '';
      stories.push({
        id: `friends-result:${fr.id}`, type: 'friends-result', title: "Friends' result",
        text: resultLine(fr), at: fr.at, action: { kind: 'match', id: fr.id }, subject: friend,
      });
    }
  }

  // watch — public tables exist in the store
  if (input.tables.length) {
    const t = input.tables[0]!;
    stories.push({
      id: `watch:${t.code}`, type: 'watch', title: 'Watch live',
      text: `${input.tables.length} public table${input.tables.length === 1 ? '' : 's'} up — ${headlineModeLabel(t.mode)} at table ${t.code}`,
      at: null, action: { kind: 'lobby' }, subject: t.code,
    });
  }

  // wire leftovers — the rest of the feed, then live highlights, then movers
  for (const r of results) {
    if (usedResults.has(r.id)) continue;
    usedResults.add(r.id);
    stories.push({
      id: `wire-result:${r.id}`, type: 'wire-result', title: 'Result',
      text: resultLine(r), at: r.at, action: { kind: 'match', id: r.id }, subject: r.id,
    });
  }
  for (const h of input.highlights) {
    if (usedHighlights.has(h.id)) continue;
    usedHighlights.add(h.id);
    stories.push({
      id: `live:${h.id}`, type: 'live', title: 'Live highlight',
      text: h.text, at: h.at, action: h.code ? { kind: 'watch-table', code: h.code } : { kind: 'none' }, subject: h.name,
    });
  }
  for (const p of powerMovers(input.powerRows, 3)) {
    const move = p.movement === 'new' ? 'NEW' : `${(p.movement as number) > 0 ? '▲' : '▼'}${Math.abs(p.movement as number)}`;
    stories.push({
      id: `power:${p.id}`, type: 'power', title: 'Power Rankings mover',
      text: `${p.name} — Power ${p.power} · ${move}`,
      at: null, action: { kind: 'profile', name: p.name, id: p.id }, subject: p.name,
    });
  }

  // new stories lead (priority order kept inside each half); seen
  // stories follow in the same priority order — the wire order.
  const seenSet = new Set(input.seen);
  const fresh = stories.filter((c) => !seenSet.has(c.id));
  const aged = stories.filter((c) => seenSet.has(c.id));
  return [...fresh, ...aged].slice(0, HEADLINES_MAX)
    .map((c) => ({ ...c, isNew: !seenSet.has(c.id) }));
}
