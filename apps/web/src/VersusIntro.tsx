import { useEffect, useMemo, useRef, useState } from 'react';
import { AvatarCircle, useAvatar } from './avatar';
import { CoinIcon } from './RepBlock';
import { sound, type Sfx } from './audio';

/**
 * Versus intro (owner, 2026-10-20): a boxing-style match card on the game loading
 * screen. The two sides' profile pics fly in from opposite edges and SMASH together
 * at center, then a Tale of the Tape card reveals the matchup's real numbers.
 *
 * DATA HONESTY (owner's standing rule): every number comes from the public cred
 * profile payload (GET /api/profile/:id) — the same payload ProfileView/Compare
 * read. Bots have no profiles and show NO numbers; a human whose payload doesn't
 * carry a stat shows '—'; nothing is ever invented.
 *
 * STORY FLOOR: the intro never auto-dismisses before the story has fully played
 * (VERSUS_STORY_MS), no matter how fast the table loads. Dismissal = story complete
 * AND table ready (the parent owns the actual dismissal; see versusDismissReady).
 * If the table still isn't ready when the story ends, the finished card holds
 * with a "getting the table ready…" line.
 *
 * PAINT-GATED START (owner report 2026-10-21: "Game loading screen is not long
 * enough"): the story clock, the cues, and the CSS beats all arm only after the
 * card has actually painted — two animation frames after mount, and only while
 * the document is visible (the useRewardsReveal pattern from the /rewards fix,
 * 3fc0e1cb). Mount-keyed timing let the story burn while the phone still showed
 * the previous screen, so the owner only ever caught the tail of it.
 *
 * DELIBERATE SKIP: taps are ignored until the tape card is up (VERSUS_TAPE_MS);
 * only then does the "Tap to skip" hint show and a tap finish the story. A prod
 * at the loading screen can't kill the intro by accident anymore.
 */

/* ------------------------------------------------------------ beat sheet */
export const VERSUS_IMPACT_MS = 1500;   // the collision frame
export const VERSUS_TAPE_MS = 2200;     // the tape card lands / rows start revealing
export const VERSUS_HOLD_MS = 4800;     // last row is in; clean readable hold begins
export const VERSUS_STORY_MS = 10_000;  // guaranteed minimum story duration, from first paint
export const VERSUS_ROW_STAGGER_MS = 700;

/* ------------------------------------------------------------ sound cues */
/** One cue on the beat sheet. `side` pans/travels the entrance whooshes in 3D. */
export interface VersusCue { at: number; cue: Sfx; side?: -1 | 0 | 1; gain?: number }
export const VERSUS_CUES: readonly VersusCue[] = [
  { at: 100, cue: 'versusWhoosh', side: -1 },             // left side flies in
  { at: 400, cue: 'versusWhoosh', side: 1 },              // right side flies in
  { at: VERSUS_IMPACT_MS, cue: 'versusImpact' },         // the collision frame
  { at: VERSUS_TAPE_MS + 20, cue: 'versusSting' },       // the tape card lands
  { at: VERSUS_TAPE_MS + 60, cue: 'versusCrowd', gain: 0.9 }, // crowd bed under the hold
];
/** The resolve plays when the story completes (or is skipped to), never on a timer of its own. */
export const VERSUS_RESOLVE_CUE: Sfx = 'versusResolve';
/** Reduced motion = the static card path: no dramatic cues at all. */
export function versusCueSchedule(reduced: boolean): readonly VersusCue[] {
  return reduced ? [] : VERSUS_CUES;
}

/* ------------------------------------------------------------ dismissal / replay */
/** The intro may leave only when the story has fully played AND the table is ready. */
export function versusDismissReady(o: { storyComplete: boolean; tableReady: boolean }): boolean {
  return o.storyComplete && o.tableReady;
}

const SEEN_PREFIX = 'bwm.versus.shown.v1:';
export function versusSeenKey(seed: string): string { return `${SEEN_PREFIX}${seed}`; }
/** One-shot per match: the rewards before-snapshot pinning is the precedent — a
 *  sessionStorage flag keyed by the match seed. A refresh mid-game finds it set
 *  and resumes the table with no intro; a rematch has a new seed and plays. */
export function versusAlreadyShown(seed: string): boolean {
  try { return sessionStorage.getItem(versusSeenKey(seed)) === '1'; } catch { return false; }
}
export function markVersusShown(seed: string): void {
  try { sessionStorage.setItem(versusSeenKey(seed), '1'); } catch { /* private mode: the resume prop still guards */ }
}
export function versusEligible(o: { seed?: string | null; resume?: boolean }): boolean {
  if (!o.seed || o.resume) return false;
  return !versusAlreadyShown(o.seed);
}

/* ------------------------------------------------------------ stats (public payload) */
/** The slice of GET /api/profile/:id the tape reads (same shapes as ProfileView). */
export interface CredProfileSlice {
  rank?: { team?: CredSeasonRank | null; cutthroat?: CredSeasonRank | null } | null;
  stats?: { team?: CredModeStats | null; cutthroat?: CredModeStats | null } | null;
}
interface CredSeasonRank { wins?: number; losses?: number; games?: number }
interface CredModeStats { elo?: number | null; wins?: number; games?: number; streak?: number }

export type VersusStatKind = 'team' | 'cutthroat';
/** One player's honest line for this mode. Rating is the REAL ratings-table value
 *  (stats.elo — null until the first rated game), never the season display seed. */
export interface VersusStatLine { rating: number | null; wins: number; losses: number; streak: number }
export function statLineFromCredProfile(p: CredProfileSlice | null | undefined, kind: VersusStatKind): VersusStatLine | null {
  if (!p) return null;
  const rk = p.rank?.[kind];
  const st = p.stats?.[kind];
  if (!rk && !st) return null;
  const wins = rk?.wins ?? st?.wins ?? 0;
  const losses = rk?.losses ?? (st && typeof st.games === 'number' ? Math.max(0, st.games - (st.wins ?? 0)) : 0);
  return {
    rating: typeof st?.elo === 'number' ? st.elo : null,
    wins,
    losses,
    streak: st?.streak ?? 0,
  };
}

/** A side's tape numbers. Null object = the side gets NO numbers at all (bots). */
export interface VersusSideStats { rating: number | null; wins: number | null; losses: number | null; streak: number | null }
export function summarizeSide(lines: readonly (VersusStatLine | null)[], hasHuman: boolean): VersusSideStats | null {
  if (!hasHuman) return null; // bots have no profiles and no stats — never invented
  const real = lines.filter((l): l is VersusStatLine => !!l);
  if (!real.length) return { rating: null, wins: null, losses: null, streak: null }; // humans, payload carried nothing: '—'
  const ratings = real.map((l) => l.rating).filter((r): r is number => typeof r === 'number');
  return {
    // combined team rating = the average of the ratings that exist (Tale of the Tape precedent)
    rating: ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
    wins: real.reduce((a, l) => a + l.wins, 0),
    losses: real.reduce((a, l) => a + l.losses, 0),
    streak: Math.max(...real.map((l) => l.streak)),
  };
}
export function winPctOf(s: VersusSideStats | null): number | null {
  if (!s || s.wins === null || s.losses === null) return null;
  const g = s.wins + s.losses;
  return g > 0 ? Math.round((s.wins / g) * 100) : null;
}
/** Which side wins a row (gold highlight), or null for a tie / no honest comparison. */
export function rowWinner(a: number | null, b: number | null): 'a' | 'b' | null {
  if (a === null || b === null || a === b) return null;
  return a > b ? 'a' : 'b';
}
/** Index of the best value in a row (solo tape), or -1 for a tie / nothing to compare. */
export function bestIndex(values: readonly (number | null)[]): number {
  let best = -1; let bestVal = -Infinity; let tied = false;
  values.forEach((v, i) => {
    if (v === null) return;
    if (v > bestVal) { bestVal = v; best = i; tied = false; } else if (v === bestVal) tied = true;
  });
  return tied ? -1 : best;
}

/* ------------------------------------------------------------ model */
export interface VersusMember { name: string; uid: string | null; isBot: boolean; direct?: string | null }
export interface VersusSideInput { label: string; members: VersusMember[] }
export interface VersusModel {
  /** team = partnership (two duo sides); solo = cutthroat (four one-player sides) */
  mode: 'team' | 'solo';
  sides: VersusSideInput[];
  kind: VersusStatKind;
  /** Big Bank pot, only when the client actually knows it (wager row for this table). */
  pot?: number | null;
}

export interface VersusSideView extends VersusSideInput { stats: VersusSideStats | null }

/**
 * The Tale of the Tape card, from resolved side stats. The better number per row
 * is gold (profile Compare style). A side with null stats (bots) shows '—' in
 * every cell — the absence of a number, never an invented one. When NO side has
 * any number the card drops entirely; the Big Bank pot still shows on its own.
 */
export function VersusTape({ mode, sides, pot }: { mode: 'team' | 'solo'; sides: VersusSideView[]; pot?: number | null }) {
  const anyStats = sides.some((s) => s.stats && (s.stats.rating !== null || s.stats.wins !== null));
  if (!anyStats) {
    return pot != null ? (
      <div className="versus-pot only" data-testid="versus-pot"><CoinIcon size={15} /> Pot {pot.toLocaleString('en-US')}</div>
    ) : null;
  }
  const a = sides[0]?.stats ?? null;
  const b = sides[1]?.stats ?? null;
  return (
    <div className={`versus-tape${mode === 'solo' ? ' solo' : ''}`} data-testid="versus-tape">
      <div className="versus-tape-title">TALE OF THE TAPE</div>
      {pot != null && (
        <div className="versus-pot" data-testid="versus-pot"><CoinIcon size={15} /> Pot {pot.toLocaleString('en-US')}</div>
      )}
      {mode === 'team' ? (
        <>
          <TapeRow label="Rating" delay={0} a={fmt(a?.rating)} b={fmt(b?.rating)} win={rowWinner(a?.rating ?? null, b?.rating ?? null)} />
          <TapeRow label="Season record" delay={1} a={recordOf(a)} b={recordOf(b)} win={rowWinner(winPctOf(a), winPctOf(b))} />
          <TapeRow label="Win %" delay={2} a={pctText(a)} b={pctText(b)} win={rowWinner(winPctOf(a), winPctOf(b))} />
          <TapeRow label="Win streak" delay={3} a={fmt(a?.streak)} b={fmt(b?.streak)} win={rowWinner(a?.streak ?? null, b?.streak ?? null)} />
        </>
      ) : (
        <>
          <SoloRow label="Rating" delay={0} values={sides.map((s) => fmt(s.stats?.rating))} nums={sides.map((s) => s.stats?.rating ?? null)} />
          <SoloRow label="Season record" delay={1} values={sides.map((s) => recordOf(s.stats))} nums={sides.map((s) => winPctOf(s.stats))} />
          <SoloRow label="Win %" delay={2} values={sides.map((s) => pctText(s.stats))} nums={sides.map((s) => winPctOf(s.stats))} />
          <SoloRow label="Win streak" delay={3} values={sides.map((s) => fmt(s.stats?.streak))} nums={sides.map((s) => s.stats?.streak ?? null)} />
        </>
      )}
    </div>
  );
}
const pctText = (s: VersusSideStats | null): string => { const p = winPctOf(s); return p === null ? '—' : `${p}%`; };

function VersusFace({ member, size }: { member: VersusMember; size: number }) {
  const pic = useAvatar(member.uid, member.direct ?? null);
  return (
    <span className="versus-face" style={{ width: size, height: size }}>
      <AvatarCircle pic={pic} name={member.name} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} />
    </span>
  );
}

const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));
const recordOf = (s: VersusSideStats | null): string => (s && s.wins !== null && s.losses !== null ? `${s.wins}–${s.losses}` : '—');

/* ------------------------------------------------------------ component */
export function VersusIntro({ model, reduced, ready, onStoryComplete }: {
  model: VersusModel;
  reduced: boolean;
  ready: boolean;
  onStoryComplete: () => void;
}) {
  const [done, setDone] = useState(reduced);
  const [play, setPlay] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const [profiles, setProfiles] = useState<ReadonlyMap<string, CredProfileSlice | null>>(new Map());
  const timers = useRef<number[]>([]);
  const finished = useRef(false);
  const doneRef = useRef(reduced);
  const canSkipRef = useRef(false);
  const completeRef = useRef(onStoryComplete);
  completeRef.current = onStoryComplete;

  const finish = (withResolve: boolean) => {
    if (finished.current) return;
    finished.current = true;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    if (withResolve && !reduced) { try { sound.play(VERSUS_RESOLVE_CUE, { gain: 0.9 }); } catch { /* audio never blocks */ } }
    doneRef.current = true;
    setDone(true);
    completeRef.current();
  };

  // Paint gate: the story starts only once the card has actually painted —
  // two animation frames after mount, and only while the document is visible
  // (the useRewardsReveal arming from GameOverRewards). Until it opens, the CSS
  // holds every beat at its first frame (the .versus:not(.play) pause rules in
  // styles.css) and no beat timer runs — VERSUS_STORY_MS measures visible time.
  useEffect(() => {
    if (reduced || play) return;
    let raf1 = 0;
    let raf2 = 0;
    let offVis: (() => void) | null = null;
    const arm = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPlay(true));
      });
    };
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      const onVis = () => { if (document.visibilityState === 'visible') arm(); };
      document.addEventListener('visibilitychange', onVis);
      offVis = () => document.removeEventListener('visibilitychange', onVis);
    } else {
      arm();
    }
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); offVis?.(); };
  }, [reduced, play]);

  // Beat sheet: cues, the skip window, and story completion — all armed by the
  // paint gate. Reduced motion: no cues, and the static card is complete
  // immediately (dismissal then rides on table readiness alone).
  useEffect(() => {
    if (reduced) { finish(false); return; }
    if (!play) return;
    for (const c of versusCueSchedule(false)) {
      timers.current.push(window.setTimeout(() => {
        try { sound.play(c.cue, { versusSide: c.side, ...(c.gain !== undefined ? { gain: c.gain } : {}) }); } catch { /* locked context: fail silent */ }
      }, c.at));
    }
    // Skipping is deliberate: a tap counts only once the tape card is up.
    timers.current.push(window.setTimeout(() => { canSkipRef.current = true; setCanSkip(true); }, VERSUS_TAPE_MS));
    timers.current.push(window.setTimeout(() => finish(true), VERSUS_STORY_MS));
    return () => { for (const id of timers.current) window.clearTimeout(id); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, play]);

  // Real stats only: fetch the public payload per human member (bots/guest seats
  // without an account uid are never fetched and never shown numbers).
  const uids = useMemo(() => {
    const set = new Set<string>();
    for (const s of model.sides) for (const m of s.members) if (!m.isBot && m.uid) set.add(m.uid);
    return [...set];
  }, [model]);
  useEffect(() => {
    if (!uids.length) return;
    let alive = true;
    for (const uid of uids) {
      fetch(`/api/profile/${encodeURIComponent(uid)}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: CredProfileSlice | null) => { if (alive) setProfiles((prev) => new Map(prev).set(uid, j)); })
        .catch(() => { if (alive) setProfiles((prev) => new Map(prev).set(uid, null)); });
    }
    return () => { alive = false; };
  }, [uids]);

  const sides: VersusSideView[] = useMemo(() => model.sides.map((s) => {
    const hasHuman = s.members.some((m) => !m.isBot);
    const lines = s.members.map((m) => (m.isBot || !m.uid ? null : statLineFromCredProfile(profiles.get(m.uid), model.kind)));
    return { ...s, stats: summarizeSide(lines, hasHuman) };
  }), [model, profiles]);

  const skip = () => { if (!doneRef.current && canSkipRef.current) finish(true); };
  const cls = `versus ${model.mode}${play ? ' play' : ''}${done ? ' done' : ''}${reduced ? ' reduced' : ''}`;

  return (
    <div className={cls} data-testid="versus-intro" onPointerDown={skip} role="button" aria-label={canSkip ? 'Match intro — tap to skip' : 'Match intro'}>
      <div className="versus-shake">
        {model.mode === 'team' ? (
          <div className="versus-stage">
            {sides.map((s, i) => (
              <div key={i} className={`versus-side ${i === 0 ? 'left' : 'right'}`}>
                <div className="versus-team-name">{s.label}</div>
                <div className="versus-faces">
                  {s.members.map((m, j) => <VersusFace key={j} member={m} size={74} />)}
                </div>
                <div className="versus-side-names">{s.members.map((m) => m.name).join(' & ')}</div>
              </div>
            ))}
            <div className="versus-vs" aria-hidden={true}>VS</div>
            <div className="versus-flash" aria-hidden={true} />
          </div>
        ) : (
          <div className="versus-stage solo">
            {sides.map((s, i) => (
              <div key={i} className={`versus-quad q${i}`}>
                <div className="versus-faces">{s.members.map((m, j) => <VersusFace key={j} member={m} size={62} />)}</div>
                <div className="versus-side-names">{s.label}</div>
              </div>
            ))}
            <div className="versus-vs" aria-hidden={true}>VS</div>
            <div className="versus-flash" aria-hidden={true} />
          </div>
        )}

        <VersusTape mode={model.mode} sides={sides} pot={model.pot} />

        {done && !ready
          ? <div className="versus-wait" data-testid="versus-wait">Getting the table ready…</div>
          : !done && canSkip ? <div className="versus-skip">Tap to skip</div> : null}
      </div>
    </div>
  );
}

function TapeRow({ label, a, b, win, delay }: { label: string; a: string; b: string; win: 'a' | 'b' | null; delay: number }) {
  return (
    <div className="versus-row" style={{ animationDelay: `${VERSUS_TAPE_MS + 120 + delay * VERSUS_ROW_STAGGER_MS}ms` }}>
      <span className={`versus-cell a${win === 'a' ? ' gold' : ''}`}>{a}</span>
      <span className="versus-row-label">{label}</span>
      <span className={`versus-cell b${win === 'b' ? ' gold' : ''}`}>{b}</span>
    </div>
  );
}

function SoloRow({ label, values, nums, delay }: { label: string; values: string[]; nums: (number | null)[]; delay: number }) {
  const best = bestIndex(nums);
  return (
    <div className="versus-row solo" style={{ animationDelay: `${VERSUS_TAPE_MS + 120 + delay * VERSUS_ROW_STAGGER_MS}ms` }}>
      <span className="versus-row-label">{label}</span>
      {values.map((v, i) => <span key={i} className={`versus-cell${i === best ? ' gold' : ''}`}>{v}</span>)}
    </div>
  );
}
