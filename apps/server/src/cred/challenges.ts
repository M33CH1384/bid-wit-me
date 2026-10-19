/** Street Cred System B: daily/weekly challenges. Rotation is deterministic (same for everyone, every period). */
import type { RatingKind } from '../stats/record';

export type ChallengeMetric = 'wins' | 'games' | 'books' | 'nils_made' | 'shots_given' | 'streak';
export type Cadence = 'daily' | 'weekly';

export interface ChallengeDef {
  id: string;
  cadence: Cadence;
  title: string;
  metric: ChallengeMetric;
  target: number;
  xp: number;
  /** coin VALUE only — no ledger exists until Phase 3b */
  coins: number;
  /** 'team'|'cutthroat' filter, undefined = any */
  kind?: RatingKind;
}

export const DAILY_POOL: ChallengeDef[] = [
  { id: 'win-2', cadence: 'daily', title: 'Win 2 games', metric: 'wins', target: 2, xp: 75, coins: 50 },
  { id: 'books-15', cadence: 'daily', title: 'Take 15 books', metric: 'books', target: 15, xp: 50, coins: 25 },
  { id: 'games-4', cadence: 'daily', title: 'Play 4 games', metric: 'games', target: 4, xp: 50, coins: 25 },
  { id: 'nil-1', cadence: 'daily', title: 'Make a nil', metric: 'nils_made', target: 1, xp: 100, coins: 75 },
  { id: 'shots-3', cadence: 'daily', title: 'Give 3 shots', metric: 'shots_given', target: 3, xp: 75, coins: 50 },
  { id: 'streak-3', cadence: 'daily', title: 'Win 3 in a row', metric: 'streak', target: 3, xp: 100, coins: 75 },
];

export const WEEKLY_POOL: ChallengeDef[] = [
  { id: 'win-5', cadence: 'weekly', title: 'Win 5 partnership games', metric: 'wins', target: 5, xp: 200, coins: 150, kind: 'team' },
  { id: 'cut-2', cadence: 'weekly', title: 'Win 2 cutthroat games', metric: 'wins', target: 2, xp: 250, coins: 200, kind: 'cutthroat' },
  { id: 'books-60', cadence: 'weekly', title: 'Take 60 books', metric: 'books', target: 60, xp: 150, coins: 100 },
  { id: 'games-20', cadence: 'weekly', title: 'Play 20 games', metric: 'games', target: 20, xp: 150, coins: 100 },
];

const DAY_MS = 86400_000;

const dayIndex = (now: number) => Math.floor(now / DAY_MS);
const weekIndex = (now: number) => Math.floor(now / (7 * DAY_MS));

/** 3 of 6 daily defs, rotating so the full pool cycles every 2 days. Deterministic per UTC day. */
export function dailyChallenges(now: number): ChallengeDef[] {
  const d = dayIndex(now);
  return [0, 1, 2].map((i) => DAILY_POOL[(d * 3 + i) % DAILY_POOL.length]!);
}

/** 2 of 4 weekly defs, rotating so the full pool cycles every 2 weeks. Deterministic per UTC week. */
export function weeklyChallenges(now: number): ChallengeDef[] {
  const w = weekIndex(now);
  return [0, 1].map((i) => WEEKLY_POOL[(w * 2 + i) % WEEKLY_POOL.length]!);
}

export const dailyPeriodId = (now: number): string => {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

/** ISO-ish week id 'YYYY-Www' (UTC). */
export function weeklyPeriodId(now: number): string {
  const d = new Date(now);
  const onejan = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan) / DAY_MS + onejanDay(onejan) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
const onejanDay = (onejan: number) => new Date(onejan).getUTCDay();

export interface ChallengeProgress {
  id: string; title: string; metric: ChallengeMetric; target: number; xp: number; coins: number;
  kind?: RatingKind; progress: number; claimed: boolean; done: boolean;
}

/** Active challenges for the current period with this player's progress. */
export async function progressFor(db: D1Database, userId: string, now: number): Promise<{ daily: ChallengeProgress[]; weekly: ChallengeProgress[] }> {
  const daily = dailyChallenges(now), weekly = weeklyChallenges(now);
  const dPid = dailyPeriodId(now), wPid = weeklyPeriodId(now);
  const rows = (await db.prepare(`SELECT challenge_id, period_id, progress, claimed_at FROM challenge_progress
    WHERE user_id = ? AND (period_id = ? OR period_id = ?)`).bind(userId, dPid, wPid)
    .all<{ challenge_id: string; period_id: string; progress: number; claimed_at: number | null }>()).results;
  const byId = new Map(rows.map((r) => [`${r.challenge_id}:${r.period_id}`, r]));
  const one = (c: ChallengeDef, pid: string): ChallengeProgress => {
    const r = byId.get(`${c.id}:${pid}`);
    const progress = r?.progress ?? 0;
    return { id: c.id, title: c.title, metric: c.metric, target: c.target, xp: c.xp, coins: c.coins, ...(c.kind ? { kind: c.kind } : {}), progress, claimed: r?.claimed_at != null, done: progress >= c.target };
  };
  return { daily: daily.map((c) => one(c, dPid)), weekly: weekly.map((c) => one(c, wPid)) };
}

/** Add `amount` to a metric's progress rows for the current period (only active defs of that cadence/metric). */
export async function bumpProgress(db: D1Database, userId: string, metric: ChallengeMetric, amount: number, kind: RatingKind, now: number): Promise<string[]> {
  if (!(amount > 0)) return [];
  const jobs: { defs: ChallengeDef[]; pid: string }[] = [
    { defs: dailyChallenges(now), pid: dailyPeriodId(now) },
    { defs: weeklyChallenges(now), pid: weeklyPeriodId(now) },
  ];
  const stmts = [];
  const checks: { def: ChallengeDef; before: number }[] = [];
  for (const { defs, pid } of jobs) {
    for (const c of defs) {
      if (c.metric !== metric) continue;
      if (c.kind && c.kind !== kind) continue;
      const row = await db.prepare('SELECT progress FROM challenge_progress WHERE user_id = ? AND challenge_id = ? AND period_id = ?')
        .bind(userId, c.id, pid).first<{ progress: number }>();
      checks.push({ def: c, before: row?.progress ?? 0 });
      stmts.push(db.prepare(`INSERT INTO challenge_progress (user_id, challenge_id, period_id, progress) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, challenge_id, period_id) DO UPDATE SET progress = challenge_progress.progress + excluded.progress`).bind(userId, c.id, pid, amount));
    }
  }
  if (stmts.length) await db.batch(stmts);
  // titles of challenges that crossed 100% with this bump (push: "challenge complete")
  return checks.filter(({ def, before }) => before < def.target && before + amount >= def.target).map(({ def }) => def.title);
}

/** Set (not add) the streak metric: a loss resets the day's/week's streak challenges. */
export async function setStreakProgress(db: D1Database, userId: string, streak: number, kind: RatingKind, now: number): Promise<void> {
  const jobs: { defs: ChallengeDef[]; pid: string }[] = [
    { defs: dailyChallenges(now), pid: dailyPeriodId(now) },
    { defs: weeklyChallenges(now), pid: weeklyPeriodId(now) },
  ];
  const stmts = [];
  for (const { defs, pid } of jobs) {
    for (const c of defs) {
      if (c.metric !== 'streak') continue;
      if (c.kind && c.kind !== kind) continue;
      stmts.push(db.prepare(`INSERT INTO challenge_progress (user_id, challenge_id, period_id, progress) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, challenge_id, period_id) DO UPDATE SET progress = excluded.progress`).bind(userId, c.id, pid, Math.min(streak, c.target)));
    }
  }
  if (stmts.length) await db.batch(stmts);
}
