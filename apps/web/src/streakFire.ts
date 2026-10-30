/**
 * STREAK FIRE (owner, 2026-10-27): photoreal canvas fire that celebrates a
 * real streak — on the HOME screen for a player's current WIN streak, and
 * IN-GAME around the plate of a seat on a run of consecutive TRICK wins.
 *
 * Data honesty (the standing rule): every number here comes from a real
 * stored/derived fact, never from the client claiming anything.
 *  - Home: the server exposes `streakFire` on the SELF profile payload
 *    (/api/profile/me), derived from cred_totals.cur_streak (per kind,
 *    migration 0007) — the same stored rows the Record Book's "Current
 *    win streak" honor reads. The home fire uses the MAX current streak
 *    across kinds and can name the kind it came from.
 *  - In-game: the trailing run of consecutive trick wins inside the
 *    current hand, from the existing animfx detector
 *    (animfx/detect.ts `trickStreak` — st.tricks is exactly the current
 *    hand's completed tricks, so a run resets when another seat takes a
 *    trick and can never leak across hands). Every client derives it
 *    from the same trick history, so all clients agree, offline and
 *    online, for bots and humans alike.
 *
 * Tier reconciliation (owner steer, 2026-10-27 — this build UPGRADES the
 * wave-3 "On Fire" CSS plate rim in animfx, it does not stack a second
 * system on it; the Streak Heat scorebug shimmer is a different signal —
 * consecutive HAND wins by a side — and is left exactly as it was):
 *  - Home (win streak):  <3 none · 3–4 T1 · 5–6 T2 · 7–9 T3 · 10+ T4.
 *  - In-game (trick run): 0–1 none · 2 SMOLDER (low ember glow, pre-fire)
 *    · 3 T1 · 4 T2 · 5–6 T3 · 7+ T4. Real flames start at 3, matching the
 *    existing FIRE_STREAK arming convention in animfx/detect.ts.
 *
 * Renderer history: the original build baked noise-eroded flame
 * sprites at runtime; Wave A (2026-10-28) pre-rendered them into a
 * sprite atlas. The owner still read stamped tongues as "really fake
 * and lazy" in motion (2026-10-30), so the atlas is retired: the live
 * engine is a real-time procedural shader flame (see the renderer
 * note below and fire/fireEngine.ts). Tier changes cross-fade
 * (TIER_CROSSFADE_MS) instead of popping, and the home band breathes
 * at the menu's idle rate (HOME_BREATHE_PERIOD_MS). Tier tables and
 * streak derivation are unchanged from the original build.
 */

export type FireTier = 0 | 1 | 2 | 3 | 4;

/** Everything the renderer needs to scale a tier, in one auditable row. */
export interface FireTierParams {
  /** hard cap on live flame particles */
  particles: number;
  /** flame particles spawned per second */
  spawnPerSec: number;
  /** flame tongue height as a fraction of the fire band's height */
  flameHeight: number;
  /** embers spawned per second */
  embersPerSec: number;
  /** fast spark streaks spawned per second */
  sparksPerSec: number;
  /** base glow strength, 0..1 */
  glow: number;
  /** smoke puffs spawned per second */
  smokePerSec: number;
}

const T = (particles: number, spawnPerSec: number, flameHeight: number, embersPerSec: number, sparksPerSec: number, glow: number, smokePerSec: number): FireTierParams =>
  ({ particles, spawnPerSec, flameHeight, embersPerSec, sparksPerSec, glow, smokePerSec });

/** Home tiers (win streak). T1 stays small and real — flames licking the
 *  bottom edge — and only T4 earns the tall wall. */
export const HOME_FIRE_TIERS: Record<FireTier, FireTierParams> = {
  0: T(0, 0, 0, 0, 0, 0, 0),
  1: T(30, 19, 0.52, 2.5, 0.2, 0.35, 1.2),
  2: T(44, 28, 0.68, 4.5, 0.5, 0.5, 2.2),
  3: T(68, 44, 0.85, 8, 1.1, 0.7, 3.6),
  4: T(96, 64, 1.0, 13, 2.2, 0.92, 5.5),
};

/** In-game tiers (trick run, per seat). The canvas is a small plate-sized
 *  band, so counts are lower; the SHAPE of the escalation is the same. */
export const TRICK_FIRE_TIERS: Record<FireTier, FireTierParams> = {
  0: T(0, 0, 0, 0, 0, 0, 0),
  1: T(20, 15, 0.55, 2, 0.15, 0.35, 0.8),
  2: T(32, 25, 0.78, 3.5, 0.4, 0.5, 1.4),
  3: T(46, 37, 0.86, 6, 0.9, 0.7, 2.2),
  4: T(60, 50, 1.0, 9, 1.8, 0.9, 3.2),
};

/** The smolder (pre-fire at exactly 2 straight trick wins): embers and a
 *  low glow only — no flame tongues, no smoke column. */
export const SMOLDER_PARAMS: FireTierParams = T(0, 0, 0, 5, 0.3, 0.22, 0);

/* --------------------------------------- renderer (procedural) --- */

/**
 * Step-up (owner, 2026-10-30 — "the heat streak flames look really
 * fake and lazy step it up"): the Wave A sprite atlas is RETIRED.
 * Stamped tongues repeat — eight variants cycling by life fraction
 * reads as wallpaper in motion. The renderer (fire/fireEngine.ts) is
 * now a real-time procedural flame: a WebGL fragment shader evaluates
 * a rising fbm turbulence field per pixel (tongues form, tear off and
 * die continuously; nothing cycles), with a canvas-2D procedural
 * fallback where WebGL is unavailable. The tier tables, the streak
 * derivations, the cross-fade and the home breathe in this module are
 * unchanged — the shader reads the same FireTierParams rows through
 * fireEngine's shaderUniformsFor mapping.
 */

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/* ------------------------------------------- tier cross-fade / breathe */

/** Tier changes blend over this long — a streak stepping up (or a
 *  broken streak cooling down) ramps instead of popping. */
export const TIER_CROSSFADE_MS = 300;

const smoothstep = (t: number): number => { const x = clamp01(t); return x * x * (3 - 2 * x); };

/**
 * Blend two tier rows at fraction t (smoothstepped, clamped): every
 * dimension of FireTierParams lerps, so spawn rate, particle cap,
 * flame height, embers, sparks, glow and smoke all move together.
 * Endpoints are exact — blend(a, b, 0) is a, blend(a, b, 1) is b — and
 * a blended cap never exceeds the higher endpoint's cap.
 */
export function blendFireParams(a: FireTierParams, b: FireTierParams, t: number): FireTierParams {
  const s = smoothstep(t);
  const L = (x: number, y: number): number => x + (y - x) * s;
  return {
    particles: L(a.particles, b.particles),
    spawnPerSec: L(a.spawnPerSec, b.spawnPerSec),
    flameHeight: L(a.flameHeight, b.flameHeight),
    embersPerSec: L(a.embersPerSec, b.embersPerSec),
    sparksPerSec: L(a.sparksPerSec, b.sparksPerSec),
    glow: L(a.glow, b.glow),
    smokePerSec: L(a.smokePerSec, b.smokePerSec),
  };
}

/** The home band breathes at the menu's idle rate: one slow swell. */
export const HOME_BREATHE_PERIOD_MS = 4000;

/**
 * Breathe factor for a timestamp (ms): a smooth 0.92–1.00 swell with
 * period HOME_BREATHE_PERIOD_MS. Bounded by construction, periodic,
 * and pure — the same instant breathes the same on every client.
 */
export function homeBreatheFactor(timeMs: number): number {
  const t = Number.isFinite(timeMs) ? timeMs : 0;
  return 0.96 + 0.04 * Math.sin((t / HOME_BREATHE_PERIOD_MS) * Math.PI * 2);
}

/* ------------------------------------------------------------- home side */

export type StreakKind = 'team' | 'cutthroat';

export interface HomeStreak {
  /** the current win streak (max across kinds) */
  streak: number;
  /** which kind the max came from (null when the streak is 0) */
  kind: StreakKind | null;
  /** the best streak ever, max across kinds */
  best: number;
}

const KIND_ORDER: StreakKind[] = ['team', 'cutthroat'];

/**
 * Pick the home streak from stored per-kind totals (cred_totals rows):
 * the max CURRENT streak wins; a tie keeps the earlier kind in
 * KIND_ORDER (team before cutthroat) so the answer is deterministic.
 * Pure — the server uses the same rule over totalsFor() rows and the
 * client tests pin it here.
 */
export function homeStreakFromTotals(rows: readonly { kind: string; curStreak: number; bestStreak: number }[]): HomeStreak {
  let best: HomeStreak = { streak: 0, kind: null, best: 0 };
  for (const kind of KIND_ORDER) {
    const r = rows.find((x) => x.kind === kind);
    if (!r) continue;
    const cur = Number.isFinite(r.curStreak) ? Math.max(0, Math.floor(r.curStreak)) : 0;
    const bst = Number.isFinite(r.bestStreak) ? Math.max(0, Math.floor(r.bestStreak)) : 0;
    if (cur > best.streak) best = { streak: cur, kind, best: Math.max(best.best, bst) };
    else best = { ...best, best: Math.max(best.best, bst) };
  }
  return best;
}

/**
 * Read the home streak off a /api/profile/me payload. The server field
 * is `streakFire` (self payload only — see cred/routes.ts fullProfile).
 * Anything missing or malformed reads as NO streak: the fire never
 * invents a number the payload didn't carry.
 */
export function homeStreakFromProfile(payload: unknown): HomeStreak | null {
  if (!payload || typeof payload !== 'object') return null;
  const f = (payload as { streakFire?: unknown }).streakFire;
  if (!f || typeof f !== 'object') return null;
  const { current, kind, best } = f as { current?: unknown; kind?: unknown; best?: unknown };
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  const streak = Math.max(0, Math.floor(current));
  return {
    streak,
    kind: kind === 'team' || kind === 'cutthroat' ? kind : null,
    best: typeof best === 'number' && Number.isFinite(best) ? Math.max(0, Math.floor(best)) : streak,
  };
}

/** Home tier for a win streak: NO fire below 3 (the Record Book's own
 *  "current streak" floor), then 3–4 / 5–6 / 7–9 / 10+. */
export function homeFireTier(streak: number): FireTier {
  if (!Number.isFinite(streak) || streak < 3) return 0;
  if (streak <= 4) return 1;
  if (streak <= 6) return 2;
  if (streak <= 9) return 3;
  return 4;
}

/** The honest home chip line, real number in it. */
export function homeFireLabel(streak: number): string {
  return `On fire — ${streak}-game win streak`;
}

/* --------------------------------------------------------- in-game side */

export type TrickFireKind = 'none' | 'smolder' | 'fire';

export interface TrickFire {
  kind: TrickFireKind;
  /** 0 when none/smolder, else 1..4 */
  tier: FireTier;
  count: number;
}

/** In-game tier for a trailing run of consecutive trick wins:
 *  0–1 none · 2 smolder · 3 T1 · 4 T2 · 5–6 T3 · 7+ T4. */
export function trickFire(count: number): TrickFire {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n < 2) return { kind: 'none', tier: 0, count: n };
  if (n === 2) return { kind: 'smolder', tier: 0, count: n };
  if (n === 3) return { kind: 'fire', tier: 1, count: n };
  if (n === 4) return { kind: 'fire', tier: 2, count: n };
  if (n <= 6) return { kind: 'fire', tier: 3, count: n };
  return { kind: 'fire', tier: 4, count: n };
}

/** The plate marker line: pre-fire reads as heating up, fire as ON FIRE. */
export function trickFireLabel(count: number): string | null {
  const f = trickFire(count);
  if (f.kind === 'none') return null;
  if (f.kind === 'smolder') return `HEATING UP ×${f.count}`;
  return `ON FIRE ×${f.count}`;
}

/* ------------------------------------------------------------ home fetch */

let homeStreakCache: Promise<HomeStreak | null> | null = null;
let homeStreakCacheAt = 0;
const HOME_STREAK_TTL_MS = 30_000;

/**
 * The signed-in player's home streak, from the one /api/profile/me read
 * (cached ~30 s, mirroring the venue-unlock cache's shape). Signed out,
 * offline, or a payload without the field → null → no fire. Never throws.
 */
export function fetchHomeStreak(now = Date.now()): Promise<HomeStreak | null> {
  if (homeStreakCache && now - homeStreakCacheAt < HOME_STREAK_TTL_MS) return homeStreakCache;
  homeStreakCacheAt = now;
  homeStreakCache = (async () => {
    try {
      const r = await fetch('/api/profile/me', { credentials: 'include' });
      if (!r.ok) return null;
      return homeStreakFromProfile(await r.json());
    } catch { return null; }
  })();
  return homeStreakCache;
}

export function invalidateHomeStreak(): void {
  homeStreakCache = null;
  homeStreakCacheAt = 0;
}
