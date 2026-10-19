/** Street Cred System B: achievements. Checks are pure-ish over a context the hooks build; TS is the source of truth. */
import type { RatingKind } from '../stats/record';
import type { Division } from './divisions';
import { divisionRank } from './divisions';
import { awardXp } from './xp';
import { move } from './coins';

/** Night-themed venues count toward the After Dark achievement. */
export const NIGHT_VENUES = ['rooftop', 'speakeasy', 'vegas'];

export type CheckKey =
  | 'wins' | 'team_wins' | 'cutthroat_wins' | 'games' | 'shots_given' | 'best_streak' | 'venues'
  | 'game_nil_made' | 'game_blind_nil_made' | 'game_win_no_bags' | 'game_wheels_win'
  | 'game_books_hand' | 'game_run_it' | 'game_comeback' | 'game_foe_eliminated' | 'after_dark';

export interface AchievementDef {
  id: string; title: string; hint: string; xp: number; coins: number;
  condition: { check: CheckKey; n?: number; night_wins?: number; division?: Division; unlock?: string };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-dub', title: 'First Dub', hint: 'Win your first game', xp: 100, coins: 50, condition: { check: 'wins', n: 1 } },
  { id: 'ten-toes', title: 'Ten Toes Down', hint: 'Win 10 games', xp: 150, coins: 75, condition: { check: 'wins', n: 10 } },
  { id: 'dealmaker', title: 'Dealmaker', hint: 'Win 25 partnership games', xp: 250, coins: 125, condition: { check: 'team_wins', n: 25 } },
  { id: 'lone-wolf', title: 'Lone Wolf', hint: 'Win 10 cutthroat games', xp: 250, coins: 125, condition: { check: 'cutthroat_wins', n: 10 } },
  { id: 'century', title: 'Century Club', hint: 'Win 100 games', xp: 500, coins: 250, condition: { check: 'wins', n: 100 } },
  { id: 'clean-nil', title: 'Clean Nil', hint: 'Bid nil and make it', xp: 150, coins: 75, condition: { check: 'game_nil_made' } },
  { id: 'blind-faith', title: 'Blind Faith', hint: 'Bid blind nil and make it', xp: 300, coins: 150, condition: { check: 'game_blind_nil_made' } },
  { id: 'no-baggage', title: 'No Baggage', hint: 'Win a game with zero bags', xp: 150, coins: 75, condition: { check: 'game_win_no_bags' } },
  { id: 'wheels-up', title: 'Wheels Up', hint: 'Call wheels and take the game', xp: 200, coins: 100, condition: { check: 'game_wheels_win' } },
  { id: 'boston', title: 'Boston Party', hint: 'Take 13+ books in a single hand', xp: 300, coins: 150, condition: { check: 'game_books_hand', n: 13 } },
  { id: 'run-it-up', title: 'Run It Up', hint: 'Claim "Run it!" and clear the table', xp: 200, coins: 100, condition: { check: 'game_run_it' } },
  { id: 'sharpshooter', title: 'Sharpshooter', hint: 'Give 25 shots across your career', xp: 200, coins: 100, condition: { check: 'shots_given', n: 25 } },
  { id: 'comeback-kid', title: 'Comeback Kid', hint: 'Win after trailing by 100+ points', xp: 250, coins: 125, condition: { check: 'game_comeback', n: 100 } },
  { id: 'undertaker', title: 'Undertaker', hint: 'Outlast an eliminated rival in cutthroat', xp: 200, coins: 100, condition: { check: 'game_foe_eliminated' } },
  { id: 'untouchable', title: 'Untouchable', hint: 'Reach a 10-game win streak', xp: 400, coins: 200, condition: { check: 'best_streak', n: 10 } },
  { id: 'world-traveler', title: 'World Traveler', hint: 'Play in 5 different venues', xp: 150, coins: 75, condition: { check: 'venues', n: 5 } },
  { id: 'iron-man', title: 'Iron Man', hint: 'Play 500 games', xp: 500, coins: 250, condition: { check: 'games', n: 500 } },
  { id: 'after-dark', title: 'After Dark', hint: 'Win 25 night-venue games and reach the Block division', xp: 0, coins: 0, condition: { check: 'after_dark', night_wins: 25, division: 'block', unlock: 'after-dark' } },
];

/** Per-game facts from this game's PlayerGameStats (extended fields live in stats/record.ts). */
export interface GameFacts {
  kind: RatingKind;
  won: boolean;
  nilMade: number;       // non-blind nils made
  blindNilMade: number;
  bags: number;
  wheels: number;
  maxBooksHand: number;
  runItClaims: number;
  maxDeficit: number;    // worst points deficit overcome (0 if never trailed)
  foeEliminated: boolean;
}

/** Lifetime aggregates (from cred_totals + cred_venue_stats). */
export interface LifeTotals {
  wins: number; teamWins: number; cutthroatWins: number;
  games: number; shotsGiven: number; bestStreak: number;
  venuesPlayed: number; nightVenueWins: number;
  bestDivision: Division;
}

export interface CheckCtx {
  /** bot games: lifetime wins/games counters still move, but per-game feats do not */
  vsBots: boolean;
  game: GameFacts;
  life: LifeTotals;
}

/** Evaluate one achievement against the context. */
export function checkOne(def: AchievementDef, ctx: CheckCtx): boolean {
  const c = def.condition;
  // anti-farming: per-game feats never unlock from bot tables
  if (ctx.vsBots && c.check.startsWith('game_')) return false;
  switch (c.check) {
    case 'wins': return ctx.life.wins >= (c.n ?? 1);
    case 'team_wins': return ctx.life.teamWins >= (c.n ?? 1);
    case 'cutthroat_wins': return ctx.life.cutthroatWins >= (c.n ?? 1);
    case 'games': return ctx.life.games >= (c.n ?? 1);
    case 'shots_given': return ctx.life.shotsGiven >= (c.n ?? 1);
    case 'best_streak': return ctx.life.bestStreak >= (c.n ?? 1);
    case 'venues': return ctx.life.venuesPlayed >= (c.n ?? 1);
    case 'game_nil_made': return ctx.game.nilMade >= 1;
    case 'game_blind_nil_made': return ctx.game.blindNilMade >= 1;
    case 'game_win_no_bags': return ctx.game.won && ctx.game.bags === 0;
    case 'game_wheels_win': return ctx.game.won && ctx.game.wheels >= 1;
    case 'game_books_hand': return ctx.game.maxBooksHand >= (c.n ?? 13);
    case 'game_run_it': return ctx.game.runItClaims >= 1;
    case 'game_comeback': return ctx.game.won && ctx.game.maxDeficit >= (c.n ?? 100);
    case 'game_foe_eliminated': return ctx.game.kind === 'cutthroat' && ctx.game.foeEliminated;
    case 'after_dark':
      return ctx.life.nightVenueWins >= (c.night_wins ?? 25) && divisionRank(ctx.life.bestDivision) >= divisionRank(c.division ?? 'block');
  }
}

export interface UnlockResult { id: string; xp: number; unlockItemId: string | null }

/**
 * Unlock every newly-earned achievement for the user. Awards XP immediately and grants
 * unlock items (e.g. the After Dark venue). Returns what was unlocked. Idempotent.
 */
export async function checkAchievements(db: D1Database, userId: string, ctx: CheckCtx, now: number): Promise<UnlockResult[]> {
  const owned = new Set((await db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?').bind(userId).all<{ achievement_id: string }>()).results.map((r) => r.achievement_id));
  const out: UnlockResult[] = [];
  for (const def of ACHIEVEMENTS) {
    if (owned.has(def.id)) continue;
    if (!checkOne(def, ctx)) continue;
    await db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').bind(userId, def.id, now).run();
    if (def.xp > 0) await awardXp(db, userId, def.xp, now);
    if (def.coins > 0) await move(db, userId, def.coins, 'achievement', def.id, now); // coins for achievements (Demetrius 2026-10-19)
    const unlockItemId = def.condition.unlock ?? null;
    if (unlockItemId) {
      await db.prepare('INSERT OR IGNORE INTO unlocks (user_id, item_id, source, unlocked_at) VALUES (?, ?, ?, ?)').bind(userId, unlockItemId, `achievement:${def.id}`, now).run();
    }
    out.push({ id: def.id, xp: def.xp, unlockItemId });
  }
  return out;
}

/** All defs with unlock state for profile payloads. */
export async function achievementStates(db: D1Database, userId: string): Promise<{ id: string; title: string; hint: string; xp: number; coins: number; unlockedAt: number | null }[]> {
  const owned = new Map((await db.prepare('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?').bind(userId).all<{ achievement_id: string; unlocked_at: number }>()).results.map((r) => [r.achievement_id, r.unlocked_at] as const));
  return ACHIEVEMENTS.map((a) => ({ id: a.id, title: a.title, hint: a.hint, xp: a.xp, coins: a.coins, unlockedAt: owned.get(a.id) ?? null }));
}
