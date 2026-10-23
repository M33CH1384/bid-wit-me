/** Street Cred System B: XP and levels. Pure math, unit-tested. */

export const MAX_LEVEL = 50;

/** XP to go from level n to n+1. */
export const xpForLevel = (n: number): number => 100 + n * 25;

/** Total XP banked at the moment of reaching `level` (level 1 = 0). */
export function xpAtLevel(level: number): number {
  let t = 0;
  for (let n = 1; n < level; n++) t += xpForLevel(n);
  return t;
}

/** Level for a lifetime XP total (1..50). */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpAtLevel(level + 1)) level++;
  return level;
}

/** Milestone titles: the highest milestone at or below the level. */
const TITLES: [number, string][] = [
  [50, 'King of the Block'],
  [40, 'OG'],
  [30, 'Shot Caller'],
  [20, 'Block Captain'],
  [10, 'Certified'],
  [5, 'Prospect'],
  [1, 'New Jack'],
];
export const titleForLevel = (level: number): string => TITLES.find(([m]) => level >= m)?.[1] ?? 'New Jack';

/** XP still needed to reach the next level (0 at cap). */
export const xpToNext = (level: number, xp: number): number => (level >= MAX_LEVEL ? 0 : Math.max(0, xpAtLevel(level + 1) - xp));

/* ------------------------------------------------------- the rank ladder */

/**
 * The rank ladder (owner, 2026-10-23; summit shape decided same day
 * 16:15 EDT): a player's rank IS a playing card. The ladder has 51 steps.
 * Steps 1–48 = levels 1–48, climbing the suits from the 3 of hearts —
 * hearts are the come-up, clubs mean you belong, diamonds mean you're
 * really about that life, spades are the elite run. Step 49 = level 49,
 * the Deuce of spades. Step 50 = level 50, the LITTLE JOKER. Step 51 =
 * the BIG JOKER — a prestige step PAST the level-50 cap, reserved for a
 * level-50 player who has earned ALL badges (owner correction,
 * 2026-10-23 16:18 EDT; the earlier XP-past-the-cap idea is dead).
 * Badge completion + the permanent latch live in cred/card.ts
 * (badgeCompletionFor / the users.big_joker_at column, migration 0031);
 * this function stays the ONE place the step→card mapping lives — it
 * takes the latched Big Joker fact as an input and never recomputes it.
 *
 * This one derivation is the ONLY place the mapping lives: the profile
 * payloads carry its result (cred/card.ts), the client renders whatever
 * card it's handed, and a ladder reshape is a change to this function alone.
 */
export type CardSuit = 'hearts' | 'clubs' | 'diamonds' | 'spades';
export interface CardRank {
  /** the Rep level this card was derived from (1..50; the Big Joker is
   *  still level 50 — prestige lives in `step`, not a fake level 51) */
  level: number;
  /** ladder step 1..51 — steps 1–50 track levels 1–50; step 51 is prestige */
  step: number;
  /** true only for step 51, the Big Joker past the cap */
  prestige: boolean;
  /** '3'..'10', 'J', 'Q', 'K', 'A', '2' (the Deuce), or 'JOKER' */
  rank: string;
  /** 'Queen', 'Ace', 'Deuce', 'Little Joker', 'Big Joker', … */
  rankName: string;
  /** the card's suit; null for both Jokers, which stand alone */
  suit: CardSuit | null;
  /** the suit glyph (♥ ♣ ♦ ♠); both Jokers carry a star */
  symbol: string;
  /** the suit tier the step climbs in (both Jokers crown the spades run) */
  tier: CardSuit;
  /** either Joker (steps 50 and 51) */
  isJoker: boolean;
  isLittleJoker: boolean;
  isBigJoker: boolean;
}

/** The prestige step number (the Big Joker). Steps 1–50 track levels. */
export const BIG_JOKER_STEP = 51;

const LADDER_SUITS: { suit: CardSuit; symbol: string }[] = [
  { suit: 'hearts', symbol: '♥' },
  { suit: 'clubs', symbol: '♣' },
  { suit: 'diamonds', symbol: '♦' },
  { suit: 'spades', symbol: '♠' },
];
const LADDER_RANKS: { rank: string; rankName: string }[] = [
  { rank: '3', rankName: 'Three' }, { rank: '4', rankName: 'Four' }, { rank: '5', rankName: 'Five' },
  { rank: '6', rankName: 'Six' }, { rank: '7', rankName: 'Seven' }, { rank: '8', rankName: 'Eight' },
  { rank: '9', rankName: 'Nine' }, { rank: '10', rankName: 'Ten' }, { rank: 'J', rankName: 'Jack' },
  { rank: 'Q', rankName: 'Queen' }, { rank: 'K', rankName: 'King' }, { rank: 'A', rankName: 'Ace' },
];

/**
 * The rank card for a Rep level (clamped to 1..50). Steps 1–50 derive
 * from the level alone. Step 51 (Big Joker) additionally requires the
 * ACTIVE crown: callers pass `bigJoker: true` only when the latched
 * all-badges feat (users.big_joker_at, set by cred/card.ts, never
 * cleared) is seasonally active per cred/bigJokerSeason.ts. An earned
 * but season-inactive holder derives step 50 here — reactivation, not
 * re-earning, restores 51.
 */
export function cardRankForLevel(level: number, opts?: { bigJoker?: boolean }): CardRank {
  const lv = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level) || 1));
  const base = { level: lv, prestige: false, suit: null as CardSuit | null, symbol: '★', tier: 'spades' as CardSuit, isJoker: true, isLittleJoker: false, isBigJoker: false };
  if (lv === 50 && opts?.bigJoker) return { ...base, step: BIG_JOKER_STEP, prestige: true, rank: 'JOKER', rankName: 'Big Joker', isBigJoker: true };
  if (lv === 50) return { ...base, step: 50, rank: 'JOKER', rankName: 'Little Joker', isLittleJoker: true };
  if (lv === 49) return { level: lv, step: 49, prestige: false, rank: '2', rankName: 'Deuce', suit: 'spades', symbol: '♠', tier: 'spades', isJoker: false, isLittleJoker: false, isBigJoker: false };
  const tier = LADDER_SUITS[Math.floor((lv - 1) / 12)]!;
  const step = LADDER_RANKS[(lv - 1) % 12]!;
  return { level: lv, step: lv, prestige: false, rank: step.rank, rankName: step.rankName, suit: tier.suit, symbol: tier.symbol, tier: tier.suit, isJoker: false, isLittleJoker: false, isBigJoker: false };
}

export interface AwardResult { xp: number; level: number; leveledUp: boolean; title: string }

/**
 * Add XP to a player's lifetime total. Creates the row on first touch.
 * Returns the new totals; leveledUp is true when the level increased.
 */
export async function awardXp(db: D1Database, userId: string, amount: number, now: number): Promise<AwardResult> {
  if (!(amount > 0)) {
    const row = await db.prepare('SELECT xp, level FROM xp_state WHERE user_id = ?').bind(userId).first<{ xp: number; level: number }>();
    const xp = row?.xp ?? 0, level = row?.level ?? levelForXp(xp);
    return { xp, level, leveledUp: false, title: titleForLevel(level) };
  }
  const row = await db.prepare('SELECT xp, level FROM xp_state WHERE user_id = ?').bind(userId).first<{ xp: number; level: number }>();
  const before = row?.xp ?? 0;
  const xp = before + Math.floor(amount);
  const level = levelForXp(xp);
  const prevLevel = row?.level ?? levelForXp(before);
  await db.prepare(`INSERT INTO xp_state (user_id, xp, level, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, updated_at = excluded.updated_at`).bind(userId, xp, level, now).run();
  return { xp, level, leveledUp: level > prevLevel, title: titleForLevel(level) };
}

/** Read-only snapshot for profile payloads. */
export async function xpSnapshot(db: D1Database, userId: string): Promise<{ level: number; xp: number; xpForNext: number; xpIntoLevel: number; title: string }> {
  const row = await db.prepare('SELECT xp, level FROM xp_state WHERE user_id = ?').bind(userId).first<{ xp: number; level: number }>();
  const xp = row?.xp ?? 0;
  const level = row?.level ?? levelForXp(xp);
  const base = xpAtLevel(level);
  return { level, xp, xpForNext: xpForLevel(level), xpIntoLevel: xp - base, title: titleForLevel(level) };
}
