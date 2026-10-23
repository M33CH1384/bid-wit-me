import { useEffect, useMemo, useRef, useState } from 'react';
import { PERSONAS, type BotSkill, type PersonaId, type StoryTape } from '@spades/bots';
import { AvatarCircle, useAvatar } from './avatar';
import PersonaFace from './PersonaFace';
import StoryFace from './story/StoryFace';
import { CoinIcon } from './RepBlock';
import { sound, type Sfx } from './audio';
import { personaRecord, readPersonaLedger, type PersonaLedger, type PersonaLedgerSplit } from './personaLedger';

/**
 * Versus intro (owner, 2026-10-20): a boxing-style match card on the game loading
 * screen. The two sides' profile pics fly in from opposite edges and SMASH together
 * at center, then a Tale of the Tape card reveals the matchup's real numbers.
 *
 * DATA HONESTY (owner's standing rule): every number comes from the public cred
 * profile payload (GET /api/profile/:id) — the same payload ProfileView/Compare
 * read. Bots have no profiles and show no career numbers; the per-player cards
 * below the tape give a bot only its recorded head-to-head with the viewer
 * (device-local persona ledger) plus a scouting read derived from its real
 * configuration. A human whose payload doesn't carry a stat shows '—' on the
 * tape; nothing is ever invented.
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

/* ------------------------------------------------- per-player cards (2026-10-23) */
/**
 * Below the tape, each player gets ONE glanceable line (owner: "stats for each
 * player or team if it's an established team — but what can we put for bots?").
 * The answer, under the same data-honesty rule as the tape:
 * - HUMANS: the same real profile line the tape reads (rating / record / win% /
 *   streak), per player instead of side-summed.
 * - BOTS: no invented career numbers, ever. Two real things exist:
 *   (1) the HEAD-TO-HEAD with the viewer, from the device-local persona ledger
 *       (personaRecord vs/together splits) — a series score, or the honest
 *       "First meeting" at offline tables where the ledger's writer owns the
 *       record. At online tables a missing record stays silent.
 *   (2) a SCOUTING read derived from the bot's actual configuration — its
 *       effective skill tier for this game (when the client computes it) and
 *       the persona's encoded play leans (bid nudge, Nil willingness). Copy,
 *       never statistics; a tendency that isn't in the config doesn't ship.
 * - ESTABLISHED TEAM (the viewer's side only): a pair with a real shared
 *   record of 2+ games takes the headline slot above the member lines — the
 *   persona ledger's together split for a bot partner, or the server's pair
 *   record (GET /api/profile/pair/:id) for a human partner. Story co-op
 *   supplies its narrative pair line instead (model.pairNote).
 */
export interface PairRecord { games: number; wins: number; losses: number; streak: number }
/** A pair earns the headline at 2+ shared games (the pair leaderboards' floor). */
export const PAIR_HEADLINE_MIN_GAMES = 2;

const SKILL_LABEL: Record<BotSkill, string> = { novice: 'Novice', regular: 'Regular', pro: 'Pro', shark: 'Shark' };

/** Streaks read as a segment only when they're a run (2+), in W/L form. */
export function streakSegment(streak: number): string | null {
  if (streak >= 2) return `W${streak}`;
  if (streak <= -2) return `L${-streak}`;
  return null;
}

/**
 * The scouting read from raw persona configuration. Pure over the config so a
 * config change moves the copy (fixture-tested). A persona with a cover
 * (fakeTag — the Hustler acting green) scouts as "Unproven": the intro plays
 * before any reveal, and the table's own plates tell the same cover story.
 */
export function scoutFromConfig(cfg: { lean: { bid: number; nil: number }; fakeTag?: string | null }, skill: BotSkill | null): string[] {
  const segs: string[] = [];
  if (cfg.fakeTag) segs.push('Unproven');
  else if (skill) segs.push(SKILL_LABEL[skill]);
  if (cfg.lean.bid > 0) segs.push('bids heavy');
  else if (cfg.lean.bid < 0) segs.push('bids light');
  if (cfg.lean.nil >= 0.3) segs.push('hunts Nils');
  else if (cfg.lean.nil <= -0.3) segs.push('won’t Nil');
  return segs;
}
export function scoutSegments(persona: PersonaId, skill: BotSkill | null): string[] {
  return scoutFromConfig(PERSONAS[persona], skill);
}

/** One recorded split as a segment list: "vs you 4–2" (+ a streak run). */
export function recordSegments(label: 'vs you' | 'with you', split: PersonaLedgerSplit): string[] {
  const segs = [`${label} ${split.wins}–${split.losses}`];
  const st = streakSegment(split.streak);
  if (st) segs.push(st);
  return segs;
}

export type BotRelation = 'vs' | 'together';
/**
 * A bot's member-line segments: its recorded history with the viewer (in the
 * given relationship), then its scouting read. No record at an offline table
 * is the honest "first meeting"; online, silence. Scouting always derives
 * from config, so a first-meeting bot still gets a read — never a record.
 */
export function botMemberSegments(o: {
  persona: PersonaId; skill: BotSkill | null; relation: BotRelation;
  ledger: PersonaLedger; online: boolean;
}): string[] {
  const entry = personaRecord(o.ledger, o.persona);
  const split = o.relation === 'vs' ? entry?.vs : entry?.together;
  const segs: string[] = [];
  if (split) segs.push(...recordSegments(o.relation === 'vs' ? 'vs you' : 'with you', split));
  else if (!o.online) segs.push(o.relation === 'vs' ? 'First meeting' : 'First time riding together');
  segs.push(...scoutSegments(o.persona, o.skill));
  return segs;
}

/** A human's member line from their real profile stat line; absent data = no line. */
export function humanMemberSegments(line: VersusStatLine | null): string[] {
  if (!line) return [];
  const segs: string[] = [];
  if (line.rating !== null) segs.push(`Rating ${line.rating.toLocaleString('en-US')}`);
  const games = line.wins + line.losses;
  if (games > 0) {
    segs.push(`${line.wins}–${line.losses}`);
    segs.push(`${Math.round((line.wins / games) * 100)}%`);
  }
  const st = streakSegment(line.streak);
  if (st) segs.push(st);
  return segs;
}

/** The established-team headline from a real pair record (either source), or null. */
export function pairHeadline(rec: PairRecord | PersonaLedgerSplit | null | undefined): string | null {
  if (!rec || rec.games < PAIR_HEADLINE_MIN_GAMES) return null;
  const segs = [`TOGETHER ${rec.wins}–${rec.losses}`, `${rec.games} games`];
  const st = streakSegment(rec.streak);
  if (st) segs.push(st);
  return segs.join(' · ');
}

/** Card reveal pacing: lines stagger after the tape's rows are in. Worst case
 *  (team, tape present, 6 card lines) the last line lands at ~7.7s — inside the
 *  10s story floor, so the dwell does not change. */
export const VERSUS_CARD_STAGGER_MS = 450;
export function versusCardsStartDelay(tapeRows: number): number {
  return VERSUS_TAPE_MS + 120 + tapeRows * VERSUS_ROW_STAGGER_MS;
}

export interface VersusCardMember { name: string; segments: string[] }
export interface VersusCardBlock { headline: string | null; headlineStory?: boolean; members: VersusCardMember[] }

/* ------------------------------------------------------------ model */
export interface VersusMember {
  name: string; uid: string | null; isBot: boolean; direct?: string | null;
  /** story character id — renders the story portrait (art pass) with medallion fallback */
  storyId?: string | null;
  /** bot persona identity (packages/bots PERSONAS) — keys the persona ledger and
   *  the scouting read. Null for humans and for story-cast seats (their tape is
   *  narrative, not persona data). */
  persona?: PersonaId | null;
  /** the bot's REAL effective skill for this game, when the client computes it
   *  itself (offline tables — the same levelFor the table plays with). Null at
   *  online tables, where the server owns the seed: scouting there leans on
   *  persona configuration only, never a guessed tier. */
  skill?: BotSkill | null;
  /** the viewing player themself (the local seat) — anchors "vs you / with you"
   *  relationships and pair-record headlines. Absent everywhere = spectating. */
  me?: boolean;
}
export interface VersusSideInput { label: string; members: VersusMember[] }
export interface VersusModel {
  /** team = partnership (two duo sides); solo = cutthroat (four one-player sides) */
  mode: 'team' | 'solo';
  sides: VersusSideInput[];
  kind: VersusStatKind;
  /** Big Bank pot, only when the client actually knows it (wager row for this table). */
  pot?: number | null;
  /** true when this table is an online room. Matters for honesty: the persona
   *  ledger is device-local and records the contexts its writer owns, so at an
   *  online table a missing record stays silent instead of claiming a
   *  "first meeting" that may have happened on another device/context. */
  online?: boolean;
  /** Story co-op: the pair's narrative line for this stop (attempts/clears from
   *  the server's pair context, in story register) — rendered as the viewer
   *  side's headline. Computed by the story room from data already at hand. */
  pairNote?: string | null;
  /**
   * Story mode: the stop's narrative Tale of the Tape (built by buildStoryTape —
   * the same content source the sit-down tape renders). When present the intro
   * is a story card: the narrative tape replaces the league stat rows, no
   * profiles are fetched, and the gold team-name headers are dropped — the
   * pairing names under the portraits already carry the sides.
   */
  story?: { tape: StoryTape };
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

/**
 * The per-player cards under the tape: an optional established-team headline
 * per side, then one line per player (real profile numbers for humans; the
 * recorded series + a config-derived scouting read for bots). Lines reveal
 * staggered after the tape rows; a line with no honest content doesn't render.
 */
export function VersusCards({ blocks, startDelay }: { blocks: VersusCardBlock[]; startDelay: number }) {
  if (!blocks.some((b) => b.headline || b.members.some((m) => m.segments.length))) return null;
  let step = 0;
  const delay = () => startDelay + step++ * VERSUS_CARD_STAGGER_MS;
  return (
    <div className={`versus-cards${blocks.length === 2 ? ' team' : ' solo'}`} data-testid="versus-cards">
      {blocks.map((b, bi) => (
        <div key={bi} className="versus-card-side">
          {b.headline && (
            <div className={`versus-card-headline${b.headlineStory ? ' story' : ''}`} style={{ animationDelay: `${delay()}ms` }}>{b.headline}</div>
          )}
          {b.members.map((m, mi) => (m.segments.length ? (
            <div key={mi} className="versus-card-line" style={{ animationDelay: `${delay()}ms` }}>
              <span className="versus-card-name">{m.name}</span>
              <span className="versus-card-segs">{m.segments.join(' · ')}</span>
            </div>
          ) : null))}
        </div>
      ))}
    </div>
  );
}

/**
 * The story Tale of the Tape: a faithful condensed form of the sit-down
 * narrative tape — the stop's stakes up top, then the seated pair and Dee
 * (her entry banded by route progress, exactly as buildStoryTape built it),
 * the threat line, and the history row when a stored fact supports one.
 * Every string comes from the StoryTape the builder produced: no league
 * rows, no invented numbers, no second copy of the content.
 */
export function VersusStoryTape({ tape }: { tape: StoryTape }) {
  const rows = [...tape.pair, tape.dee];
  return (
    <div className="versus-tape story" data-testid="versus-story-tape">
      <div className="versus-tape-title">TALE OF THE TAPE</div>
      <p className="versus-story-line stakes" style={{ animationDelay: `${VERSUS_TAPE_MS + 120}ms` }}>{tape.stakes}</p>
      {rows.map((e, i) => (
        <div key={e.id} className="versus-story-row" style={{ animationDelay: `${VERSUS_TAPE_MS + 120 + (i + 1) * VERSUS_ROW_STAGGER_MS}ms` }}>
          <span className="versus-story-name">{e.name}</span>
          <span className="versus-story-text">{e.knownFor} {e.style}</span>
        </div>
      ))}
      <p className="versus-story-line threat" style={{ animationDelay: `${VERSUS_TAPE_MS + 120 + (rows.length + 1) * VERSUS_ROW_STAGGER_MS}ms` }}>{tape.threat}</p>
      {tape.terms && (
        <p className="versus-story-line terms" style={{ animationDelay: `${VERSUS_TAPE_MS + 120 + (rows.length + 2) * VERSUS_ROW_STAGGER_MS}ms` }}>{tape.terms}</p>
      )}
      {tape.history && (
        <p className="versus-story-line history" style={{ animationDelay: `${VERSUS_TAPE_MS + 120 + (rows.length + 2 + (tape.terms ? 1 : 0)) * VERSUS_ROW_STAGGER_MS}ms` }}>{tape.history}</p>
      )}
    </div>
  );
}

function VersusFace({ member, size }: { member: VersusMember; size: number }) {
  const pic = useAvatar(member.uid, member.direct ?? null);
  return (
    <span className="versus-face" style={{ width: size, height: size }}>
      {member.storyId
        ? <StoryFace characterId={member.storyId} name={member.name} className="versus-story-face" />
        : member.isBot
          ? <PersonaFace name={member.name} className="versus-story-face" />
          : <AvatarCircle pic={pic} name={member.name} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} />}
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
  // Story mode never fetches: its tape is narrative, and league numbers at a
  // story table would be the player's overall stats against bots — meaningless.
  const uids = useMemo(() => {
    if (model.story) return [];
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

  // Per-player cards: the persona ledger is device-local and synchronous —
  // read once at mount; the intro never waits on it.
  const ledger = useMemo<PersonaLedger>(() => readPersonaLedger(), []);
  // Established-team headline for a HUMAN partner: the server's caller-scoped
  // pair record. The fetch rides alongside the profile fetches; the headline
  // appears when it lands and is simply absent if it never does.
  const pairPartnerUid = useMemo(() => {
    if (model.story || model.mode !== 'team') return null;
    const mySide = model.sides.find((s) => s.members.some((m) => m.me));
    const me = mySide?.members.find((m) => m.me);
    const partner = mySide?.members.find((m) => !m.me && !m.isBot && m.uid);
    return partner?.uid && me?.uid && partner.uid !== me.uid ? partner.uid : null;
  }, [model]);
  const [pairRec, setPairRec] = useState<PairRecord | null>(null);
  useEffect(() => {
    if (!pairPartnerUid) return;
    let alive = true;
    fetch(`/api/profile/pair/${encodeURIComponent(pairPartnerUid)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PairRecord | null) => {
        if (alive && j && typeof j.games === 'number') {
          setPairRec({ games: j.games, wins: j.wins ?? 0, losses: j.losses ?? 0, streak: j.streak ?? 0 });
        }
      })
      .catch(() => { /* absent record = no headline; never a blocker */ });
    return () => { alive = false; };
  }, [pairPartnerUid]);

  const cardBlocks: VersusCardBlock[] = useMemo(() => {
    const viewerSide = model.sides.findIndex((s) => s.members.some((m) => m.me));
    return model.sides.map((s, si) => {
      const isViewerSide = si === viewerSide && viewerSide >= 0;
      let headline: string | null = null;
      let headlineStory = false;
      if (model.mode === 'team' && isViewerSide) {
        if (model.pairNote) { headline = model.pairNote; headlineStory = true; }
        else {
          const partner = s.members.find((m) => !m.me);
          if (partner?.isBot && partner.persona) headline = pairHeadline(personaRecord(ledger, partner.persona)?.together);
          else if (partner && !partner.isBot) headline = pairHeadline(pairRec);
        }
      }
      const members = s.members.map((m): VersusCardMember => {
        if (m.isBot) {
          if (!m.persona) return { name: m.name, segments: [] };
          if (viewerSide < 0) return { name: m.name, segments: scoutSegments(m.persona, m.skill ?? null) };
          const relation: BotRelation = model.mode === 'team' && isViewerSide ? 'together' : 'vs';
          return { name: m.name, segments: botMemberSegments({ persona: m.persona, skill: m.skill ?? null, relation, ledger, online: !!model.online }) };
        }
        return { name: m.name, segments: humanMemberSegments(m.uid ? statLineFromCredProfile(profiles.get(m.uid), model.kind) : null) };
      });
      return { headline, headlineStory, members };
    });
  }, [model, profiles, pairRec, ledger]);
  const tapeHasRows = sides.some((s) => s.stats && (s.stats.rating !== null || s.stats.wins !== null));

  const skip = () => { if (!doneRef.current && canSkipRef.current) finish(true); };
  const cls = `versus ${model.mode}${play ? ' play' : ''}${done ? ' done' : ''}${reduced ? ' reduced' : ''}`;

  return (
    <div className={cls} data-testid="versus-intro" onPointerDown={skip} role="button" aria-label={canSkip ? 'Match intro — tap to skip' : 'Match intro'}>
      <div className="versus-shake">
        {model.mode === 'team' ? (
          <div className="versus-stage">
            {sides.map((s, i) => (
              <div key={i} className={`versus-side ${i === 0 ? 'left' : 'right'}`}>
                {!model.story && <div className="versus-team-name">{s.label}</div>}
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

        {model.story
          ? <VersusStoryTape tape={model.story.tape} />
          : <VersusTape mode={model.mode} sides={sides} pot={model.pot} />}

        {!model.story && <VersusCards blocks={cardBlocks} startDelay={versusCardsStartDelay(tapeHasRows ? 4 : 0)} />}

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
