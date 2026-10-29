/**
 * Animation package layer (owner, 2026-10-20 — "Build all of them").
 *
 * A single presentational overlay mounted inside the table. It watches the
 * seat view's state transitions and fires the scenario animations from
 * detect.ts: nil spotlight, blind-nil moonlight, Run it! shockwave, Big
 * Joker slam ring, spade-cut glint, bag drop, Boston broom, Wheels spin,
 * comeback surge, cutthroat elimination, match-point pulse, the Big Bank
 * pot, and the Pj's calm headlight drive-by.
 *
 * Rules it lives by:
 *  - purely presentational: pointer-events none, it never touches input,
 *    the deal, timers, or any state transition;
 *  - triggers come from real state only (see detect.ts);
 *  - Reduce effects (Settings) or the OS reduce-motion setting collapses
 *    the dramatic motion to a brief static highlight or skips it — the
 *    persistent state looks (dead plate, moon ring, match-point outline)
 *    stay, because they ARE the information;
 *  - sounds are left to the systems that already own them (joker rumble,
 *    cut cues, bag toast cue, collection sweeps, tornado) — this layer is
 *    silent except the ambience scheduler's own headlight pass (audio.ts).
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Bid, type GameResult, type HandRecord, type Phase, type TableRules, type Trick } from '@spades/rules';
import { useSocial } from '../social/store';

/**
 * The slice of table state the layer reads. Both the offline GameState and
 * the online seat view satisfy it, so the same triggers work at every table.
 */
export interface AnimFxView {
  rules: TableRules; phase: Phase; handNo: number;
  bids: (Bid | null)[]; trick: Trick; tricks: Trick[];
  tricksWon: number[]; scores: number[]; bags: number[];
  history: HandRecord[]; result: GameResult | null; eliminated?: boolean[];
  misdealReveal?: { seat: number } | null;
  /** the viewing seat (online seat views carry it; the offline human is 0) */
  seat?: number;
  /** the match key (GameState.seed, offline; online seat views don't carry
   *  it, so there the tornado ladder keys off hand/history rewinds alone) */
  seed?: string;
  /** non-standard trick counts (short/cut variants) ride the view, when present */
  trickCount?: number;
}
import { fx, useReduceEffects } from '../fx';
import { CoinIcon } from '../RepBlock';
import { fetchWagerList } from '../social/wagerApi';
import {
  UPSET_GAP, bagBrinkSides, bagPenaltySides, bigJokerSeat, blindNilSeats, bostonSides,
  comebackSides, contractDeadSides, doubleMoonSides, heatSides, matchPointSides,
  mirrorBidSides, newlyEliminated, nineLivesSides, paybackColdPairs, shushSides,
  silentAssassinSeats, textbookSides, trickStreak,
  nilBustedSeats, nilLiveSeats, ratingGap, runClaimerSeat, saveInTrick,
  sealedNilSeats, seatsOfSide, setSides, sideIndexOf, spadePlayed, syncSides,
  trickWasCut, wheelsSides, wireSides,
} from './detect';
/* Wave B dedupe (coordinator ruling): Down to the Wire renders through
 * the rebuilt recapfx renderer — the layer keeps its trigger and held
 * timing, the renderer owns the pixels (pure seekable models in
 * recapfx.ts). Photo Finish and Victory Confetti used to render here
 * too; since 2026-10-28 they live on the presenting surfaces (see the
 * game-over block below). DOM/canvas only: no three.js, so the entry
 * graph stays clean. */
import { WireOverlay } from '../RecapFx';
import FireCanvas from '../fire/FireCanvas';
import { SMOLDER_PARAMS, TRICK_FIRE_TIERS, trickFire, trickFireLabel } from '../streakFire';
import { TORNADO_LEVEL_NAMES, TornadoLadderTracker } from '../three/tornadoLevel';
import './animfx.css';

/* ------------------------------------------------------------ positioning */

interface Pt { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

const centerOf = (r: DOMRect): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const plateEl = (seat: number): Element | null => document.querySelector(`[data-testid="seat-${seat}"]`);
const platePt = (seat: number): Pt | null => { const el = plateEl(seat); return el ? centerOf(el.getBoundingClientRect()) : null; };
const plateRectOf = (seat: number): Rect | null => { const el = plateEl(seat); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const bugTeamEl = (side: number): Element | null => document.querySelectorAll('.bug-teams .bug-team')[side] ?? null;
const bugTeamPt = (side: number): Pt | null => { const el = bugTeamEl(side); return el ? centerOf(el.getBoundingClientRect()) : null; };

interface BwmLayout { trick?: Rect[]; hand?: Rect[]; slots?: Rect[]; trickCards?: (Rect & { card: string })[] }
const layoutWin = (): BwmLayout | null => (window as unknown as { __bwmLayout?: BwmLayout }).__bwmLayout ?? null;

function trickCenterPt(): Pt {
  const L = layoutWin();
  if (L?.trick?.length) {
    return { x: L.trick.reduce((a, t) => a + t.x + t.w / 2, 0) / L.trick.length, y: L.trick.reduce((a, t) => a + t.y + t.h / 2, 0) / L.trick.length };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
}
const cardRectOf = (card: string): Rect | null => layoutWin()?.trickCards?.find((t) => t.card === card) ?? null;
const slotPt = (seat: number): Pt | null => { const s = layoutWin()?.slots?.[seat]; return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : null; };

/* ------------------------------------------------------------------ shots */

type ShotKind = 'bjring' | 'glint' | 'coinflip' | 'shock' | 'broom' | 'wheel' | 'bag' | 'crack' | 'potin' | 'potout'
  | 'boardedge' | 'setbrick' | 'syncbeam' | 'firstbook' | 'misdeal' | 'ripple' | 'payback' | 'upset'
  | 'savebeam' | 'nilseal' | 'ember' | 'wire' | 'photofinish' | 'confetti' | 'tornchip'
  /* wave B §C: the eight new scenarios */
  | 'doublemoon' | 'shush' | 'ninelives' | 'assassin' | 'guillotine' | 'textbook';
interface CoinFlight { x: number; y: number; tx: number; ty: number; d: number }
interface Shot { id: number; kind: ShotKind; x: number; y: number; w?: number; h?: number; still?: boolean; label?: string; coins?: CoinFlight[]; rects?: Rect[]; x2?: number; y2?: number; level?: number; name?: string; seat?: number; cold?: boolean; scores?: [number, number, number] }

interface CellFx { side: number; x: number; y: number; w: number; h: number; heat: boolean; brink: boolean; cycle?: number }

/* Deterministic particle scatter (the confetti pattern, generalized):
 * a pure function of the piece index — sin hashing, never Math.random —
 * so bursts are identical on every render, seekable and testable. */
interface BurstPiece { dx: number; dy: number; d: number; s: number; r: number }
function burstPieces(n: number, spread: number, seed = 0): BurstPiece[] {
  return Array.from({ length: n }, (_, i) => {
    const h1 = Math.abs(Math.sin(i * 127.1 + 311.7 + seed * 57.3));
    const h2 = Math.abs(Math.sin(i * 269.5 + 183.3 + seed * 91.7));
    const a = (i / n) * Math.PI * 2 + h1 * 0.7;
    const dist = spread * (0.45 + h2 * 0.55);
    return {
      dx: Math.round(Math.cos(a) * dist),
      dy: Math.round(Math.sin(a) * dist * 0.62),
      d: Math.round(h1 * 90),
      s: 3 + Math.round(h2 * 4),
      r: Math.round((h1 - 0.5) * 300),
    };
  });
}

/* spotlight dust motes: deterministic drift positions inside a pool
 * (sin-hash of the index, the confetti discipline) */
function motePieces(n = 9): { l: number; t: number; d: number; s: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const h1 = Math.abs(Math.sin(i * 197.3 + 71.7));
    const h2 = Math.abs(Math.sin(i * 149.5 + 23.3));
    return { l: 18 + h1 * 64, t: 16 + h2 * 62, d: Math.round(h1 * 3400), s: 2 + Math.round(h2 * 3) };
  });
}
const MOTES = motePieces();

interface SeatSpot { seat: number; x: number; y: number; w: number; h: number; sx: number | null; sy: number | null; sw: number; sh: number }

/* ------------------------------------------------------- nil spotlight ----
 * Rebalanced 2026-10-21 (owner: the first cut "makes it hard to see
 * anything"). The emphasis moved from darkness to light:
 *  - the shade is ONE vignette whose peak alpha is a hard cap (SPOT_PEAK),
 *    reached only at the far corners — the felt, plates and trick stay
 *    readable everywhere, always;
 *  - guaranteed-clear zones are punched out of it as feathered holes:
 *    the bidder's plate + trick slot, the WHOLE trick area, the viewer's
 *    own hand, and the scorebug — those pixels get zero shade, ever;
 *  - a warm pool of light around the bidder's plate + slot does the
 *    pointing, on top of the gold ring;
 *  - when the viewer IS the nil bidder the treatment is the lightest of
 *    all (SPOT_PEAK_MINE); under Reduce effects the shade halves again and
 *    the pool holds still.
 *
 * RENDERING (regression fix, 2026-10-21): the shade is rasterized on a
 * <canvas> by paintSpotlightShade() — source-over for the vignette,
 * destination-out for the holes. The rebalance above first shipped the
 * holes as gradient-filled circles inside an SVG <mask>, and on the
 * owner's iPhone (iOS WebKit) the mask rendered ALL-OPAQUE: the lighter
 * vignette showed, the cutouts never punched. That is a documented
 * WebKit failure class — an SVG mask whose luminance comes from url()
 * paint-server (gradient) content can composite as solid white in the
 * offscreen mask buffer (and a mask WebKit drops fails open the same
 * way: element visible, mask ignored); the in-DOM pins could not see it
 * because happy-dom rasterizes nothing. Canvas 2D compositing has no
 * mask machinery and no paint-server references — it is the same plain
 * raster op on every engine, iOS included — so the whole class is gone.
 */
export const SPOT_PEAK = 0.3;
export const SPOT_PEAK_MINE = 0.18;
export const SPOT_REDUCED_SCALE = 0.5;

export interface ShadeZone { x: number; y: number; w: number; h: number }
export interface ShadeHole { cx: number; cy: number; r: number; feather: number }
export interface ShadePool { cx: number; cy: number; r: number }
export interface ShadeSpec { peak: number; holes: ShadeHole[]; pools: ShadePool[] }

const circleHole = (z: ShadeZone, inflate: number, feather = 46): ShadeHole => ({
  cx: z.x + z.w / 2, cy: z.y + z.h / 2, r: Math.max(z.w, z.h) / 2 + inflate, feather,
});

/** Compose the spotlight shade from measured geometry. Pure: the numbers ARE the readability contract. */
export function buildSpotlightShade(input: {
  seats: { plate: ShadeZone; slot: ShadeZone | null }[];
  trick: ShadeZone | null; hand: ShadeZone | null; scorebug: ShadeZone | null;
  mine: boolean; reduced: boolean;
}): ShadeSpec {
  const holes: ShadeHole[] = [];
  for (const s of input.seats) {
    holes.push(circleHole(s.plate, 24));
    if (s.slot) holes.push(circleHole(s.slot, 18));
  }
  if (input.trick) holes.push(circleHole(input.trick, 20));
  if (input.hand) holes.push(circleHole(input.hand, 16));
  if (input.scorebug) holes.push(circleHole(input.scorebug, 14));
  const pools: ShadePool[] = input.seats.map((s) => {
    const pc = { x: s.plate.x + s.plate.w / 2, y: s.plate.y + s.plate.h / 2 };
    const sc = s.slot ? { x: s.slot.x + s.slot.w / 2, y: s.slot.y + s.slot.h / 2 } : pc;
    return { cx: (pc.x + sc.x) / 2, cy: (pc.y + sc.y) / 2, r: 195 };
  });
  const peak = Number(((input.mine ? SPOT_PEAK_MINE : SPOT_PEAK) * (input.reduced ? SPOT_REDUCED_SCALE : 1)).toFixed(3));
  return { peak, holes, pools };
}

const bboxOf = (rs: Rect[]): ShadeZone | null => {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/* -------------------------------------------- the shade, rasterized ----
 * Paints a ShadeSpec into a 2D context at CSS-pixel scale (the caller sets
 * the canvas backing store to viewport × dpr and passes that dpr here).
 * A pure function of (spec, w, h, dpr) against the standard Canvas2D API,
 * so tests can run it against a software rasterizer and assert actual
 * PIXELS — zone centers at 0 alpha, far corners at the cap — instead of
 * pinning DOM structure that says nothing about what a screen shows. */
const SHADE_INK = '3, 5, 14'; // #03050e — the vignette ink the SVG stops used
export function paintSpotlightShade(ctx: CanvasRenderingContext2D, spec: ShadeSpec, w: number, h: number, dpr = 1): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // the vignette: the same radial profile the SVG gradient encoded —
  // centred at (50%, 42%), radius 78% of the normalized diagonal (so the
  // peak lands on the far corners and nowhere else), clear until 55% of
  // the radius, 40% of peak at 80%, peak at the rim.
  const cx = w / 2, cy = h * 0.42;
  const radius = 0.78 * (Math.hypot(w, h) / Math.SQRT2);
  const vig = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  vig.addColorStop(0, `rgba(${SHADE_INK}, 0)`);
  vig.addColorStop(0.55, `rgba(${SHADE_INK}, 0)`);
  vig.addColorStop(0.8, `rgba(${SHADE_INK}, ${Number((spec.peak * 0.4).toFixed(3))})`);
  vig.addColorStop(1, `rgba(${SHADE_INK}, ${spec.peak})`);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  // the guaranteed-clear zones, erased: destination-out scales the painted
  // alpha by (1 − source alpha), so a radial gradient that is fully opaque
  // out to the hole radius and eases to transparent across the feather
  // band punches a hole that is FULLY clear inside the radius and feathers
  // back into the vignette — identically on every canvas implementation.
  ctx.globalCompositeOperation = 'destination-out';
  for (const hole of spec.holes) {
    const outer = hole.r + hole.feather;
    const g = ctx.createRadialGradient(hole.cx, hole.cy, hole.r, hole.cx, hole.cy, outer);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(hole.cx - outer, hole.cy - outer, outer * 2, outer * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ------------------------------------------------------------------- svgs */

function BroomSvg() {
  return (
    <svg viewBox="0 0 160 80" className="broom-svg" aria-hidden="true">
      <path d="M92 40 L138 20 Q152 38 144 54 L130 68 Q112 54 92 40 Z" fill="#e8c86a" />
      <path d="M100 44 L134 30 M104 50 L140 40 M102 56 L132 58" stroke="#b98a2f" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="84" y="33" width="16" height="12" rx="3" transform="rotate(24 92 39)" fill="#8a6a1f" />
      <line x1="12" y1="14" x2="90" y2="40" stroke="#d8b25c" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

function CrackSvg() {
  // pathLength=100 on every vein so the CSS dash-draw (the crack drawing
  // ITSELF, radiating from the impact point) is one shared timing
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="crack-svg" aria-hidden="true">
      <polyline pathLength={100} points="50,-2 44,26 57,42 45,64 53,102" />
      <polyline pathLength={100} points="57,42 76,50" />
      <polyline pathLength={100} points="45,64 26,72" />
      <polyline pathLength={100} points="44,26 29,34" />
      <polyline pathLength={100} points="57,42 66,24" />
      <polyline pathLength={100} points="45,64 58,82" />
      {/* two loose shards that catch the light once as they settle */}
      <polygon className="crack-shard" points="60,46 66,50 61,54" />
      <polygon className="crack-shard s2" points="38,58 43,61 37,65" />
    </svg>
  );
}

/* --------------------------------------------------------- headlight sweep */

/** Pj's calm drive-by: the audio bed dispatches 'pj-headlights'; the sweep crosses the table background. */
function HeadlightSweep({ calm }: { calm: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = () => setN((x) => x + 1);
    window.addEventListener('pj-headlights', h);
    return () => window.removeEventListener('pj-headlights', h);
  }, []);
  if (!n) return null;
  // Wave D (§A1 row 13): two beams + fence-shadow striping + taillight
  // afterglow, keyframed from venueLife.headlightSweepAt — the event and
  // the 4.6 s held duration are the audio scheduler's, unchanged.
  return (
    <div key={n} data-testid="pj-headlights" className={`animfx-headlights${calm ? ' calm' : ''}`} aria-hidden="true">
      <div className="animfx-hl-beam b1" />
      <div className="animfx-hl-beam b2" />
      <div className="animfx-hl-fence" />
      <div className="animfx-hl-tail" />
    </div>
  );
}

/* -------------------------------------------------------------------- main */

export default function AnimFxLayer({ st, online = false, names, resultPresented = false }: {
  st: AnimFxView;
  online?: boolean;
  names?: string[];
  /** A game-over surface (decided recap / final-results modal / victory
   *  screen) is actually PRESENTED. The game-over stamps below gate on
   *  this, never on the result state's arrival: the state lands while
   *  the finished trick is still in its hold — 1,150 ms plain, ~5 s
   *  behind a nuked or Run-It final trick — so a stamp fired on the
   *  state spent its whole life before the surface existed (owner,
   *  2026-10-28: the victory animation was never seen in landscape). */
  resultPresented?: boolean;
}) {
  const reduceFx = useReduceEffects();
  const reduced = reduceFx || fx.osReducedMotion;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const [shots, setShots] = useState<Shot[]>([]);
  const [spots, setSpots] = useState<SeatSpot[]>([]);
  const [shade, setShade] = useState<ShadeSpec | null>(null);
  const [moons, setMoons] = useState<SeatSpot[]>([]);
  /* STREAK FIRE (owner, 2026-10-27): the wave-3 ON FIRE look, upgraded —
   * the CSS rim is now a photoreal canvas fire around the streaking
   * seat's plate (fire/FireCanvas), fed by the SAME detector the rim
   * used (trickStreak over the current hand's completed tricks). */
  const [fireFx, setFireFx] = useState<{ seat: number; count: number; spot: SeatSpot } | null>(null);
  const [cells, setCells] = useState<CellFx[]>([]);
  /* wave B §C state: the persistent NIL seal marks (Nil, Sealed leaves a
   * small seal at the plate for the rest of the hand), the Mirror Bids
   * frames over both scorebug cells (lit until the first trick resolves),
   * the measured spots for both, and the Guillotine's dead-contract sides
   * (their bug-cell numbers grey for the rest of the hand — information). */
  const [sealedSeats, setSealedSeats] = useState<{ hand: number; seats: number[] } | null>(null);
  const [sealedSpots, setSealedSpots] = useState<SeatSpot[]>([]);
  const [mirrorCells, setMirrorCells] = useState<CellFx[]>([]);
  const [deadSides, setDeadSides] = useState<number[]>([]);
  /* SESSION TALK LOG (§C/§D.5 — client session-derived, labelled as such):
   * per-seat callout counts for the CURRENT hand, tallied by the
   * trash-talk pop observer below from the callouts the table actually
   * displayed. Feeds THE SHUSH and SILENT ASSASSIN only. */
  const talkRef = useRef<{ hand: number; bySeat: number[] }>({ hand: -1, bySeat: [] });
  const talkBySide = (rules: TableRules): number[] => {
    const out: number[] = [];
    talkRef.current.bySeat.forEach((n, seat) => {
      const side = sideIndexOf(rules, seat);
      out[side] = (out[side] ?? 0) + n;
    });
    return out;
  };
  /* the spotlight shade canvas: painted imperatively (see
   * paintSpotlightShade) whenever the composed spec changes, and repainted
   * on viewport resize — the canvas element itself carries no React props
   * that change, so a spec change is the only repaint trigger */
  const shadeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shadeSpecRef = useRef<ShadeSpec | null>(null);
  shadeSpecRef.current = shade;
  const paintShade = useCallback(() => {
    const canvas = shadeCanvasRef.current;
    const spec = shadeSpecRef.current;
    if (!canvas || !spec) return;
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext('2d');
    if (ctx) paintSpotlightShade(ctx, spec, w, h, dpr);
  }, []);
  useLayoutEffect(() => { paintShade(); }, [shade, paintShade]);
  useEffect(() => {
    // Rotation streams dozens of resize events; repaint once per frame, not per event.
    let raf = 0;
    const onResize = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintShade(); }); };
    window.addEventListener('resize', onResize);
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [paintShade]);
  const [, setTick] = useState(0);

  const timers = useRef(new Set<number>());
  const idRef = useRef(0);
  const seenRef = useRef(new Set<string>());
  const wagerRef = useRef<{ id: string; pot: number } | null>(null);
  const potArmed = useRef(true);
  const firstBookRef = useRef(false);
  // SPADES BROKEN arming: null = not yet seeded by an observed snapshot;
  // seeded (silently) from the first view and from every resync, so a
  // mid-match resume never replays the ember — only a live flip fires it
  const spadeRef = useRef<boolean | null>(null);
  // RUN IT TORNADO LADDER: the per-side, per-match claim tracker. Seeded
  // silently from the first view (like the ember above) — a claim already
  // resolved in the first held snapshot is marked counted, never ticked —
  // and reset on rematch rewind / match-key change. Nothing is persisted.
  const tornadoRef = useRef(new TornadoLadderTracker());
  const tornadoSeedRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  // presence ratings (UPSET) + names ride the social store; read via a ref so
  // social ticks never re-run the transition diffing below
  const social = useSocial();
  const socialRef = useRef(social);
  socialRef.current = social;
  const namesRef = useRef(names);
  namesRef.current = names;

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => { timers.current.delete(t); fn(); }, ms);
    timers.current.add(t);
  };
  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);
  useEffect(() => {
    // Same rotation-stream guard as the shade repaint above: one tick per frame.
    let raf = 0;
    const onResize = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setTick((x) => x + 1); }); };
    window.addEventListener('resize', onResize);
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  const addShot = (shot: Omit<Shot, 'id'>, ms: number) => {
    const id = ++idRef.current;
    setShots((ss) => [...ss.slice(-11), { ...shot, id }]);
    later(() => setShots((ss) => ss.filter((x) => x.id !== id)), ms);
  };
  const calm = () => reducedRef.current;

  /* Game-over stamps (UPSET / PAYBACK) are presentation graphics: they
   * queue here and fire only when the host reports the result surface
   * presented (see the prop note). Anything queued for a result that
   * clears before presentation is dropped with it. */
  const pendingStamps = useRef<Array<{ shot: Omit<Shot, 'id'>; ms: number }>>([]);
  const presentedRef = useRef(false);
  const stampOrQueue = (shot: Omit<Shot, 'id'>, ms: number) => {
    if (presentedRef.current) addShot(shot, ms);
    else pendingStamps.current.push({ shot, ms });
  };
  useEffect(() => {
    presentedRef.current = resultPresented;
    if (!resultPresented) return;
    const queued = pendingStamps.current;
    pendingStamps.current = [];
    for (const s of queued) addShot(s.shot, s.ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultPresented]);

  const fireAtPlate = (kind: ShotKind, seat: number, ms: number) => {
    const pt = platePt(seat);
    if (!pt) return;
    addShot({ kind, x: pt.x, y: pt.y }, ms);
  };
  const fireBj = (seat: number) => {
    if (calm()) return;
    const c = cardRectOf('BJ');
    const pt = c ? { x: c.x + c.w / 2, y: c.y + c.h / 2 } : slotPt(seat) ?? platePt(seat) ?? trickCenterPt();
    addShot({ kind: 'bjring', x: pt.x, y: pt.y, w: c?.w ?? 86, h: c?.h ?? 120 }, 950);
  };
  const fireGlint = () => {
    if (calm()) return;
    const pt = trickCenterPt();
    addShot({ kind: 'glint', x: pt.x, y: pt.y }, 650);
  };
  const firePot = (kind: 'potin' | 'potout') => {
    const w = wagerRef.current;
    if (!w) return;
    const c = trickCenterPt();
    const still = calm();
    const coins: CoinFlight[] = [];
    if (!still) {
      if (kind === 'potin') {
        for (let seat = 0; seat < st.rules.playerCount; seat++) {
          const p = platePt(seat);
          if (!p) continue;
          for (let k = 0; k < 3; k++) coins.push({ x: p.x, y: p.y, tx: c.x - p.x, ty: c.y - p.y, d: seat * 90 + k * 110 });
        }
      } else {
        for (const side of st.result?.winners ?? []) {
          for (const seat of seatsOfSide(st.rules, side)) {
            const p = platePt(seat);
            if (!p) continue;
            for (let k = 0; k < 4; k++) coins.push({ x: c.x, y: c.y, tx: p.x - c.x, ty: p.y - c.y, d: k * 120 });
          }
        }
      }
    }
    addShot({ kind, x: c.x, y: c.y, still, coins, label: w.pot.toLocaleString() }, still ? 1700 : 2600);
  };

  /* ------------------------------------------------------ wager discovery */
  const [wager, setWager] = useState<{ id: string; pot: number } | null>(null);
  wagerRef.current = wager;
  useEffect(() => {
    if (!online) return;
    const m = window.location.pathname.match(/^\/t\/([^/]+)/);
    if (!m) return;
    let live = true;
    fetchWagerList()
      .then((j) => {
        const rows = (j.challenges ?? []).filter((c) => c.tableCode === m[1]);
        rows.sort((a, b) => b.createdAt - a.createdAt);
        if (live && rows[0]) setWager({ id: rows[0].id, pot: rows[0].pot });
      })
      .catch(() => { /* not a wager table (or signed out): no pot, honestly */ });
    return () => { live = false; };
  }, [online]);

  useEffect(() => { if (st.result) potArmed.current = true; }, [st.result]);
  useEffect(() => {
    if (!wager || !potArmed.current) return;
    if (st.handNo === 1 && st.phase === 'bidding' && st.history.length === 0) {
      potArmed.current = false;
      firePot('potin');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wager, st]);

  /* -------------------------------------------------- transition triggers */
  interface Snap { handNo: number; bids: (Bid | null)[]; tricksWon: number[]; hist: number; eliminated?: boolean[]; hasResult: boolean; hasMisdeal: boolean }
  const prevRef = useRef<Snap | null>(null);
  useEffect(() => {
    const snap: Snap = {
      handNo: st.handNo, bids: [...st.bids], tricksWon: [...st.tricksWon], hist: st.history.length,
      eliminated: st.eliminated ? [...st.eliminated] : undefined,
      hasResult: !!st.result, hasMisdeal: !!st.misdealReveal,
    };
    const p = prevRef.current;
    prevRef.current = snap;
    // first observed view: seed the spade-broken arm from reality (a resumed
    // match already past its first spade must not replay the ember)
    if (!p) {
      talkRef.current = { hand: st.handNo, bySeat: [] };
      // GUILLOTINE seeding (the spade-ember discipline): a resumed hand's
      // already-dead contracts restore their grey (information) but the
      // blade never replays for a cut the layer didn't watch land.
      if (st.bids.every((b) => b !== null) && st.tricks.length) {
        const dead = contractDeadSides(
          { rules: st.rules, bids: st.bids, tricks: st.tricks, trickCount: st.trickCount } as never,
          st.tricksWon,
        );
        dead.forEach((side) => seenRef.current.add(`guil:${st.handNo}:${side}`));
        if (dead.length) setDeadSides(dead);
      }
      spadeRef.current = spadePlayed(st.tricks, st.trick);
      // …and seed the tornado ladder the same way: a claim already resolved
      // in the first held snapshot counts as seen, never as a new tick —
      // pre-arrival claims are not reconstructed and not fabricated
      tornadoRef.current.seedFrom(st.handNo, st.tricks);
      tornadoSeedRef.current = st.seed;
      return;
    }
    // a new game at the same table (rematch): history/hand counts rewind — resync silently
    if (snap.hist < p.hist || snap.handNo < p.handNo) {
      seenRef.current = new Set(); firstBookRef.current = false; spadeRef.current = spadePlayed(st.tricks, st.trick);
      talkRef.current = { hand: st.handNo, bySeat: [] };
      setDeadSides([]); setSealedSeats(null);
      tornadoRef.current.reset(st.seed);
      tornadoSeedRef.current = st.seed;
      fx.clearTornadoClaim();
      return;
    }
    // a fresh hand: the session talk log and the per-hand persistent
    // §C looks (dead-contract greys, seal marks) start clean
    if (snap.handNo !== p.handNo) {
      talkRef.current = { hand: snap.handNo, bySeat: [] };
      setDeadSides([]); setSealedSeats(null);
    }

    // RUN IT TORNADO LADDER: count the claim on the very state change that
    // resolves it (a completed run-flagged trick with a winner). This runs
    // ~1.5 s before Table's slam timer sets fx.tornado, so the stamp is
    // waiting when the funnel assignment lands. A changed match key (a new
    // match whose hand/history happened not to rewind) resets the ladder.
    if (st.seed !== undefined && tornadoSeedRef.current !== undefined && st.seed !== tornadoSeedRef.current) {
      tornadoRef.current.reset(st.seed);
      fx.clearTornadoClaim();
    }
    if (st.seed !== undefined) tornadoSeedRef.current = st.seed;
    const tornClaim = tornadoRef.current.observe(st.handNo, st.tricks, st.rules, st.seed);
    if (tornClaim) {
      fx.noteTornadoClaim(tornClaim);
      const pt = platePt(tornClaim.seat);
      if (pt) {
        addShot(
          { kind: 'tornchip', x: pt.x, y: pt.y, still: calm(), level: tornClaim.level, name: TORNADO_LEVEL_NAMES[tornClaim.level - 1] },
          calm() ? 1700 : 2700, // the ranIt hold; the still variant just reads, shorter
        );
      }
    }

    // bids landing inside THIS hand's bidding (a new hand's opening snapshot
    // is a resync, not a bid — books hands start at 'books' without a slam)
    if (snap.handNo === p.handNo) {
      st.bids.forEach((b, seat) => {
        // blind nil: the bid chip flips like a coin toss when the bid lands
        if (b === 'blindNil' && p.bids[seat] !== 'blindNil' && !calm()) fireAtPlate('coinflip', seat, 1000);
        // BOARD BID: every card edge on the table lights gold and the bid slams home
        if (b === 'books' && p.bids[seat] !== 'books') {
          if (!calm()) {
            const rects = (layoutWin()?.slots ?? []).filter(Boolean);
            if (rects.length) addShot({ kind: 'boardedge', x: 0, y: 0, rects, seat }, 1000);
            plateEl(seat)?.classList.add('animfx-slam');
            later(() => plateEl(seat)?.classList.remove('animfx-slam'), 560);
          } else {
            plateEl(seat)?.classList.add('animfx-slam-still');
            later(() => plateEl(seat)?.classList.remove('animfx-slam-still'), 950);
          }
        }
      });
    }

    // tricks: Big Joker slam + spade-cut glint
    const seen = seenRef.current;
    const scan = (t: Trick, idx: number, finalized: boolean) => {
      const bj = bigJokerSeat(t);
      if (bj !== null) {
        const k = `bj:${st.handNo}:${bj}`;
        if (!seen.has(k)) { seen.add(k); fireBj(bj); }
      }
      if (finalized && t.winner !== null) {
        const k = `tk:${st.handNo}:${idx}`;
        if (!seen.has(k)) { seen.add(k); if (trickWasCut(t, st.rules)) fireGlint(); }
        // "Run it!" resolved tricks carry the engine's run flag: the first
        // one to land bursts the shockwave off the claimant's plate
        const rk = `run:${st.handNo}`;
        if (!seen.has(rk) && t.plays.some((pl) => pl.run)) {
          seen.add(rk);
          if (!calm()) {
            const seat = runClaimerSeat(st.tricks);
            if (seat !== null) {
              // the pressure ring scales with the claimant side's tornado
              // ladder level for this run (the tracker's real count)
              const pt = platePt(seat);
              if (pt) addShot({ kind: 'shock', x: pt.x, y: pt.y, level: tornadoRef.current.levelForSide(sideIndexOf(st.rules, seat)) }, 1150);
            }
          }
        }
      }
    };
    st.tricks.forEach((t, i) => scan(t, i, true));
    scan(st.trick, st.tricks.length, false);

    // THE SAVE: the nil bidder's card was standing when they played it and
    // their partner took the trick — a gold thread snaps plate to plate.
    // wonBefore is rebuilt per render by walking the hand's tricks in order.
    if (st.rules.partnerships) {
      const wonBefore: number[] = new Array(st.rules.playerCount).fill(0);
      st.tricks.forEach((t, i) => {
        const sv = saveInTrick(t, st.bids, st.rules, wonBefore);
        const k = `save:${st.handNo}:${i}`;
        if (sv && !seen.has(k)) {
          seen.add(k);
          const pa = platePt(sv.saver);
          const pb = platePt(sv.bidder);
          if (pa && pb) addShot({ kind: 'savebeam', x: pa.x, y: pa.y, x2: pb.x, y2: pb.y, still: calm() }, calm() ? 700 : 950);
        }
        if (t.winner !== null) wonBefore[t.winner] = (wonBefore[t.winner] ?? 0) + 1;
      });
    }

    // SPADES BROKEN: once per match — the ember sweeps on the first flip
    if (spadePlayed(st.tricks, st.trick)) {
      if (spadeRef.current === false && !calm()) addShot({ kind: 'ember', x: 0, y: trickCenterPt().y }, 950);
      spadeRef.current = true;
    }

    // DOWN TO THE WIRE: the last book decides a contract — one edge pulse
    // per qualifying hand, armed the moment the final trick is entered
    if (st.phase === 'playing') {
      const wk = `wire:${st.handNo}`;
      if (!seen.has(wk) && wireSides(st).length) {
        seen.add(wk);
        addShot({ kind: 'wire', x: 0, y: 0, still: calm() }, calm() ? 750 : 900);
      }
    }

    // FIRST BOOK of the match: hand 1's first completed trick stamps the lower third, once per game
    if (st.handNo === 1 && !firstBookRef.current && st.tricks.length > 0 && st.tricks[0]!.winner !== null) {
      firstBookRef.current = true;
      const wseat = st.tricks[0]!.winner!;
      const wname = namesRef.current?.[wseat];
      addShot({ kind: 'firstbook', x: 0, y: 0, still: calm(), label: wname ?? undefined }, calm() ? 1500 : 2300);
    }

    // THE SHUSH (§C N2): a side on a 4+ trick run whose opponents fired
    // 2+ callouts THIS hand (the session talk log above). Fires once per
    // hand per side, the moment the run and the receipt are both real.
    if (st.phase === 'playing') {
      for (const side of shushSides(st, talkBySide(st.rules))) {
        const k = `shush:${st.handNo}:${side}`;
        if (seen.has(k)) continue;
        seen.add(k);
        document.querySelectorAll('.trash-callout').forEach((el) => {
          el.classList.add('animfx-deflate');
          later(() => el.classList.remove('animfx-deflate'), 700);
        });
        for (const seat of seatsOfSide(st.rules, side)) {
          const pt = platePt(seat);
          if (pt) addShot({ kind: 'shush', x: pt.x, y: pt.y, still: calm() }, calm() ? 1100 : 1600);
        }
      }
    }

    // THE GUILLOTINE (§C N9): walk the hand's tricks; on a CUT after which
    // a side's contract is mathematically dead (engine arithmetic) and
    // wasn't before, the blade falls on that side's bug cell and its
    // number greys for the rest of the hand.
    if (st.phase === 'playing' && st.bids.every((b) => b !== null)) {
      const won: number[] = new Array(st.rules.playerCount).fill(0);
      let deadBefore = new Set<number>();
      st.tricks.forEach((t, i) => {
        if (t.winner !== null) won[t.winner] = (won[t.winner] ?? 0) + 1;
        const slice = { rules: st.rules, bids: st.bids, tricks: st.tricks.slice(0, i + 1), trickCount: st.trickCount };
        const deadAfter = new Set(contractDeadSides(slice as never, won));
        if (trickWasCut(t, st.rules)) {
          for (const side of deadAfter) {
            if (deadBefore.has(side)) continue;
            const k = `guil:${st.handNo}:${side}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const el = bugTeamEl(side);
            if (el) {
              const r = el.getBoundingClientRect();
              addShot({ kind: 'guillotine', x: r.left, y: r.top, w: r.width, h: r.height, still: calm() }, calm() ? 800 : 950);
            }
          }
        }
        deadBefore = deadAfter;
      });
      const deadNow = [...deadBefore];
      setDeadSides((prev) => (JSON.stringify(prev) === JSON.stringify(deadNow) ? prev : deadNow));
    }

    // hand end: bag drop (+ wobble), Boston broom, Wheels spin, comeback surge
    if (snap.hist > p.hist) {
      const rec = st.history[st.history.length - 1]!;
      for (const side of bagPenaltySides(rec)) {
        const pt = bugTeamPt(side);
        if (pt) addShot({ kind: 'bag', x: pt.x, y: pt.y, still: calm() }, 1050);
        const el = bugTeamEl(side);
        if (el) { el.classList.add('animfx-wobble'); later(() => el.classList.remove('animfx-wobble'), 780); }
      }
      if (bostonSides(rec).length && !calm()) addShot({ kind: 'broom', x: 0, y: 0 }, 2500);
      for (const side of wheelsSides(rec, st.rules)) {
        for (const seat of seatsOfSide(st.rules, side)) {
          const pt = platePt(seat);
          if (pt) addShot({ kind: 'wheel', x: pt.x, y: pt.y, still: calm() }, calm() ? 1300 : 1900);
        }
      }
      for (const side of comebackSides(rec)) {
        const el = bugTeamEl(side);
        if (el) { el.classList.add(calm() ? 'animfx-surge-still' : 'animfx-surge'); later(() => el.classList.remove('animfx-surge', 'animfx-surge-still'), 1500); }
      }
      // THE SET: the set side's contract chip cracks and drops like a brick;
      // every side that shot them stomps its books down on the scorebug.
      // PAYBACK SERVED COLD (§C N3): when this set repays an earlier set
      // by the same pair, the brick lands in a cold blue grade with a
      // frost edge and the SERVED COLD sub-stamp.
      const coldVictims = new Set(paybackColdPairs(st.history).map((pr) => pr.victim));
      const set = setSides(rec);
      for (const side of set) {
        const pt = bugTeamPt(side) ?? platePt(seatsOfSide(st.rules, side)[0] ?? 0);
        if (pt) addShot({ kind: 'setbrick', x: pt.x, y: pt.y, still: calm(), cold: coldVictims.has(side) }, calm() ? 1300 : 1500);
      }
      if (set.length) {
        for (const sRec of rec.sides) {
          if (set.includes(sRec.side)) continue;
          const el = bugTeamEl(sRec.side);
          if (el) { el.classList.add('animfx-stomp'); later(() => el.classList.remove('animfx-stomp'), 680); }
        }
      }
      // IN SYNC: partners who made the contract with both bids real get a flash of light between their plates
      for (const side of syncSides(rec, st.rules)) {
        const [a, b] = seatsOfSide(st.rules, side);
        const pa = a !== undefined ? platePt(a) : null;
        const pb = b !== undefined ? platePt(b) : null;
        if (pa && pb) addShot({ kind: 'syncbeam', x: pa.x, y: pa.y, x2: pb.x, y2: pb.y, still: calm() }, calm() ? 700 : 1000);
      }
      // NIL, SEALED: a bidder who made their nil clean blooms gold at their plate
      const sealed = sealedNilSeats(rec);
      for (const seat of sealed) {
        const pt = platePt(seat);
        if (pt) addShot({ kind: 'nilseal', x: pt.x, y: pt.y, still: calm() }, calm() ? 1000 : 1350);
      }
      // …and the seal STAYS as a small mark at the plate for the rest of
      // the hand (the bloom is the moment; the mark is the information)
      if (sealed.length) setSealedSeats({ hand: st.handNo, seats: sealed });
      // DOUBLE MOON (§C N1): both partners made their nil, one of them
      // blind — two crescents rise from their plates and merge into one
      // full moon over the table centre
      for (const side of doubleMoonSides(rec, st.rules)) {
        const seats = seatsOfSide(st.rules, side);
        const pa = seats[0] !== undefined ? platePt(seats[0]) : null;
        const pb = seats[1] !== undefined ? platePt(seats[1]) : null;
        if (pa && pb) addShot({ kind: 'doublemoon', x: pa.x, y: pa.y, x2: pb.x, y2: pb.y, still: calm() }, calm() ? 1200 : 2100);
      }
      // SILENT ASSASSIN (§C N5): a made blind nil from a side that said
      // nothing all hand (session talk log) — no stamp, no burst: the
      // plate goes still and dark-edged while a thin line traces the seal
      for (const seat of silentAssassinSeats(rec, talkBySide(st.rules))) {
        const r = plateRectOf(seat);
        if (r) addShot({ kind: 'assassin', x: r.x, y: r.y, w: r.w, h: r.h, still: calm() }, calm() ? 1400 : 2000);
      }
      // NINE LIVES (§C N4): a side that was buried by 400+ earlier in the
      // match takes the lead — the bug cell cracks like dry earth and a
      // green shoot grows through it as the number sits on top
      for (const side of nineLivesSides(st.history)) {
        const el = bugTeamEl(side);
        if (el) {
          const r = el.getBoundingClientRect();
          addShot({ kind: 'ninelives', x: r.left, y: r.top, w: r.width, h: r.height, still: calm() }, calm() ? 1200 : 2000);
        }
      }
      // TEXTBOOK (§C N10): contract made EXACTLY, zero bags — a ledger
      // line draws under the cell and stamps EXACT in registrar ink
      for (const side of textbookSides(rec)) {
        const el = bugTeamEl(side);
        if (el) {
          const r = el.getBoundingClientRect();
          addShot({ kind: 'textbook', x: r.left, y: r.top, w: r.width, h: r.height, still: calm() }, calm() ? 1100 : 1800);
        }
      }
    }

    // cutthroat elimination moment: the crack flash (the dead look itself is persistent, below)
    for (const seat of newlyEliminated(p.eliminated, snap.eliminated)) {
      if (calm()) continue;
      const r = plateRectOf(seat);
      if (r) addShot({ kind: 'crack', x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h }, 850);
    }

    // NIL, BUSTED: the moment a live nil takes its first trick — the same
    // resolve edge the spotlight ends on — the plate cracks like glass.
    // Detected off the tricksWon transition, independent of the spotlight's
    // rendering; like the elimination crack, Reduce effects skip it outright.
    if (snap.handNo === p.handNo) {
      for (const seat of nilBustedSeats(p, snap)) {
        if (calm()) continue;
        // the crack radiates from the taken card's LANDING point (the
        // seat's trick slot) when the layout knows it, else the plate
        const sp = slotPt(seat);
        const slot = layoutWin()?.slots?.[seat];
        if (sp && slot) addShot({ kind: 'crack', x: sp.x, y: sp.y, w: slot.w, h: slot.h }, 780);
        else {
          const r = plateRectOf(seat);
          if (r) addShot({ kind: 'crack', x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h }, 780);
        }
      }
    }

    // MISDEAL: the dealt cards scatter and swirl back into the deck before the re-deal
    if (snap.hasMisdeal && !p.hasMisdeal && !calm()) addShot({ kind: 'misdeal', x: 0, y: 0 }, 1050);

    // a result that clears before its surface ever presented takes its
    // queued stamps with it — they belong to that result, not the next
    if (!snap.hasResult && p.hasResult) pendingStamps.current = [];

    // game over: THE WINNING BOOK ripples out of the final trick with a brief
    // time-stretch beat (presentational only — the victory handoff is untouched)
    if (snap.hasResult && !p.hasResult && st.result) {
      const c = trickCenterPt();
      addShot({ kind: 'ripple', x: c.x, y: c.y, still: calm() }, calm() ? 1100 : 1000);
      if (!calm()) {
        const scr = document.querySelector('.table-screen');
        scr?.classList.add('animfx-slowmo');
        later(() => scr?.classList.remove('animfx-slowmo'), 1000);
      }
      // PHOTO FINISH + VICTORY CONFETTI no longer fire here (owner,
      // 2026-10-28). They were decided from the result alone and fired
      // on this state transition — but the result state lands while the
      // finished trick is still in its hold (1,150 ms plain; TRICK_HOLD
      // + up to 4,000 ms nuke allowance; ~5.35 s for a Run-It ending),
      // and the result surface cannot present until the hold releases.
      // Their whole bounded life (confetti 2.3 s, tape 3 s) elapsed over
      // the table before the sheet existed, so the player never saw
      // them — in landscape the flow then moved to /rewards, which had
      // no celebration at all. Both now live on the presenting surfaces
      // (Intermission's decided recap, Table's game-over modal and
      // online victory screen, the /rewards screen), gated on those
      // surfaces' own presented states. The UPSET / PAYBACK stamps
      // below share the disease and the cure: they queue through
      // stampOrQueue and fire on the presented edge.
      const nm = namesRef.current;
      if (online && nm) {
        // UPSET: every seat's rating must resolve from presence — one missing
        // rating and there is no stamp, never an invented number
        const users = Object.values(socialRef.current.users ?? {});
        const ratingOf = (seat: number): number | null => {
          const name = nm[seat];
          if (!name) return null;
          const u = users.find((x) => x.name === name);
          const r = st.rules.partnerships ? u?.rating?.team : u?.rating?.cutthroat;
          return typeof r === 'number' ? r : null;
        };
        const winnerSeats = st.result.winners.flatMap((side) => seatsOfSide(st.rules, side));
        const loserSeats = [...Array(st.rules.playerCount).keys()].filter((s) => !winnerSeats.includes(s));
        const wr = winnerSeats.map(ratingOf);
        const lr = loserSeats.map(ratingOf);
        const gap = wr.length && lr.length && wr.every((r) => r !== null) && lr.every((r) => r !== null)
          ? ratingGap(wr as number[], lr as number[]) : 0;
        if (gap >= UPSET_GAP) {
          // the chyron prints the REAL rating gap under the word
          stampOrQueue({ kind: 'upset', x: 0, y: 0, label: String(Math.round(gap)) }, 3000);
        }
        // PAYBACK: the viewer lost, and a winner's own profile payload says
        // they've been losing this head-to-head (vsYou reads from the viewer's
        // side: wins = times the viewer beat them) — today they got one back
        if (!st.result.winners.includes(sideIndexOf(st.rules, 0))) {
          let stamped = false;
          for (const seat of winnerSeats) {
            const name = nm[seat];
            if (!name) continue;
            fetch(`/api/social/profile/${encodeURIComponent(name)}`, { credentials: 'same-origin' })
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => {
                const vy = (j as { vsYou?: { games: number; wins: number; losses: number } } | null)?.vsYou;
                if (!stamped && mountedRef.current && vy && vy.games >= 1 && vy.wins > vy.losses) {
                  stamped = true;
                  stampOrQueue({ kind: 'payback', x: 0, y: 0 }, 3200);
                }
              })
              .catch(() => { /* no reachable profile: no stamp, never invented */ });
          }
        }
      }
    }

    // Big Bank: the pot pours to the winners when the match settles
    if (snap.hasResult && !p.hasResult && wagerRef.current) firePot('potout');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  /* ------------------------------------------- persistent state looks */
  // eliminated plates stay dead for the rest of the game; match-point teams pulse
  useEffect(() => {
    const dead = st.eliminated ?? [];
    for (let seat = 0; seat < st.rules.playerCount; seat++) plateEl(seat)?.classList.toggle('animfx-dead', !!dead[seat]);
    const mp = new Set(matchPointSides(st));
    const deadContract = new Set(deadSides);
    document.querySelectorAll('.bug-teams .bug-team').forEach((el, side) => {
      el.classList.toggle('animfx-mp', mp.has(side) && !reducedRef.current);
      el.classList.toggle('animfx-mp-still', mp.has(side) && reducedRef.current);
      // THE GUILLOTINE's persistent read: a mathematically dead contract's
      // cell greys for the rest of the hand (information, calm included)
      el.classList.toggle('animfx-deadcontract', deadContract.has(side));
    });
  }, [st, deadSides]);
  useEffect(() => () => {
    document.querySelectorAll('.animfx-dead').forEach((el) => el.classList.remove('animfx-dead'));
    document.querySelectorAll('.animfx-mp, .animfx-mp-still, .animfx-deadcontract').forEach((el) => el.classList.remove('animfx-mp', 'animfx-mp-still', 'animfx-deadcontract'));
  }, []);

  /* TRASH-TALK POP: the table's banter bubble (Table's .trash-callout, keyed
     per line) pops comic-style when a line lands, and the speaker's plate —
     the one nearest the bubble — bounces once. The callout is Table's own
     element; the layer only decorates it, via a mutation observer. */
  useEffect(() => {
    const seenText = new WeakMap<Element, string>();
    const pop = (el: Element) => {
      // SESSION TALK LOG (§C/§D.5): every callout the table displays is
      // tallied against its speaker's seat (the plate nearest the bubble —
      // the same attribution the bounce below uses), calm or not: the log
      // is a record, not an effect. Feeds THE SHUSH / SILENT ASSASSIN.
      const r0 = el.getBoundingClientRect();
      const cx0 = r0.left + r0.width / 2;
      const cy0 = r0.top + r0.height / 2;
      let speaker: Element | null = null;
      let bd0 = Infinity;
      document.querySelectorAll('.plate[data-testid]').forEach((pl) => {
        const pr = pl.getBoundingClientRect();
        const d = Math.hypot(pr.left + pr.width / 2 - cx0, pr.top + pr.height / 2 - cy0);
        if (d < bd0) { bd0 = d; speaker = pl; }
      });
      const seatAttr = (speaker as Element | null)?.getAttribute('data-testid')?.match(/^seat-(\d+)$/);
      if (seatAttr) {
        const seat = Number(seatAttr[1]);
        talkRef.current.bySeat[seat] = (talkRef.current.bySeat[seat] ?? 0) + 1;
      }
      if (reducedRef.current) return;
      el.classList.add('animfx-pop');
      // a one-pixel table shake on the pop's beat (the `translate`
      // property, so it never fights the screen's own transforms)
      const scr = document.querySelector('.table-screen');
      if (scr) {
        scr.classList.add('animfx-tableshake');
        window.setTimeout(() => scr.classList.remove('animfx-tableshake'), 320);
      }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let best: Element | null = null;
      let bd = Infinity;
      document.querySelectorAll('.plate[data-testid]').forEach((pl) => {
        const pr = pl.getBoundingClientRect();
        const d = Math.hypot(pr.left + pr.width / 2 - cx, pr.top + pr.height / 2 - cy);
        if (d < bd) { bd = d; best = pl; }
      });
      if (best) {
        const plate = best as Element;
        plate.classList.add('animfx-bounce');
        window.setTimeout(() => plate.classList.remove('animfx-bounce'), 580);
      }
    };
    const check = (el: Element) => {
      const t = el.textContent ?? '';
      if (seenText.get(el) !== t) { seenText.set(el, t); pop(el); }
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n instanceof Element) {
            if (n.classList.contains('trash-callout')) check(n);
            n.querySelectorAll?.('.trash-callout').forEach(check);
          }
        });
        if (m.target instanceof Element && m.target.classList.contains('trash-callout')) check(m.target);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, []);

  /* ------------------------------------------- measured persistent overlays */
  useLayoutEffect(() => {
    const measure = (seats: number[]): SeatSpot[] => seats.flatMap((seat) => {
      const el = plateEl(seat);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      const slot = layoutWin()?.slots?.[seat];
      return [{ seat, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, sx: slot ? slot.x + slot.w / 2 : null, sy: slot ? slot.y + slot.h / 2 : null, sw: slot?.w ?? 0, sh: slot?.h ?? 0 }];
    });
    const ns = st.phase === 'playing' ? measure(nilLiveSeats(st)) : [];
    const nm = st.phase === 'playing' ? measure(blindNilSeats(st)) : [];
    setSpots((prev) => (JSON.stringify(prev) === JSON.stringify(ns) ? prev : ns));
    setMoons((prev) => (JSON.stringify(prev) === JSON.stringify(nm) ? prev : nm));
    // the spotlight shade: composed from the same measurements, plus the
    // clear zones the readability contract guarantees (trick, hand, scorebug)
    let shadeNext: ShadeSpec | null = null;
    if (ns.length) {
      const L = layoutWin();
      const bug = document.querySelector('.scorebug')?.getBoundingClientRect();
      shadeNext = buildSpotlightShade({
        seats: ns.map((s) => ({
          plate: { x: s.x - s.w / 2, y: s.y - s.h / 2, w: s.w, h: s.h },
          slot: s.sx !== null ? { x: s.sx - s.sw / 2, y: (s.sy ?? 0) - s.sh / 2, w: s.sw, h: s.sh } : null,
        })),
        trick: bboxOf([...(L?.trick ?? []), ...(L?.trickCards ?? []).map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h }))]),
        hand: bboxOf(L?.hand ?? []),
        scorebug: bug && bug.height > 0 ? { x: bug.left, y: bug.top, w: bug.width, h: bug.height } : null,
        mine: ns.some((s) => s.seat === (st.seat ?? 0)),
        reduced,
      });
    }
    setShade((prev) => (JSON.stringify(prev) === JSON.stringify(shadeNext) ? prev : shadeNext));
    /* wave 3 persistent looks, measured the same way: STREAK FIRE over
       the streaking seat's plate (2 straight trick wins = smolder
       pre-fire, 3+ = real flames by tier — streakFire.ts); STREAK HEAT /
       BAG BRINK overlays over the scorebug cells */
    const ts = st.phase === 'playing' ? trickStreak(st.tricks) : null;
    const tf = ts ? trickFire(ts.count) : null;
    const nf = ts && tf && tf.kind !== 'none'
      ? (measure([ts.seat]).map((spot) => ({ seat: ts.seat, count: ts.count, spot })))[0] ?? null
      : null;
    setFireFx((prev) => (JSON.stringify(prev) === JSON.stringify(nf) ? prev : nf));
    const heat = heatSides(st.history);
    const brink = st.result ? [] : bagBrinkSides(st.bags);
    const nc: CellFx[] = [...new Set([...heat, ...brink])].flatMap((side) => {
      const el = bugTeamEl(side);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{
        side, x: r.left, y: r.top, w: r.width, h: r.height,
        heat: heat.includes(side), brink: brink.includes(side),
        cycle: brink.includes(side) ? (((st.bags[side] ?? 0) % 10) + 10) % 10 : undefined,
      }];
    });
    setCells((prev) => (JSON.stringify(prev) === JSON.stringify(nc) ? prev : nc));
    /* wave B §C persistent overlays, measured the same way: the NIL seal
       marks that stay for the rest of the hand, and the MIRROR BIDS twin
       frames — lit from the close of bidding until the first trick
       resolves, then gone (the hand has started for real) */
    const ss = sealedSeats && sealedSeats.hand === st.handNo ? measure(sealedSeats.seats) : [];
    setSealedSpots((prev) => (JSON.stringify(prev) === JSON.stringify(ss) ? prev : ss));
    const mirror = st.phase === 'playing' && st.tricks.length === 0 && !st.result ? mirrorBidSides(st) : [];
    const nmc: CellFx[] = mirror.flatMap((side) => {
      const el = bugTeamEl(side);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ side, x: r.left, y: r.top, w: r.width, h: r.height, heat: false, brink: false }];
    });
    setMirrorCells((prev) => (JSON.stringify(prev) === JSON.stringify(nmc) ? prev : nmc));
  });
  const deadCount = (st.eliminated ?? []).filter(Boolean).length;
  const narrow = deadCount > 0 && st.phase !== 'gameOver'
    ? `radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,${Math.min(0.32, 0.1 + deadCount * 0.09).toFixed(2)}) 100%)`
    : null;

  const renderShot = (s: Shot) => {
    switch (s.kind) {
      case 'bjring':
        // weight, not confetti: the ring slams DOWN onto the felt, a dent
        // shadow flashes under the card at the impact frame and a dust
        // burst ring rolls out along the felt
        return (
          <div key={s.id} data-testid="animfx-bjring" className="animfx-bjring" style={{ left: s.x - (s.w ?? 86) / 2, top: s.y - (s.h ?? 120) / 2, width: s.w ?? 86, height: s.h ?? 120 }}>
            <span className="bj-dent" />
            <span className="bj-dust" />
            {burstPieces(7, 54, 3).map((p, i) => (
              <span key={i} className="fx-dust" style={{ left: '50%', top: '88%', width: p.s, height: p.s, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${Math.abs(p.dy) * 0.4}px`, animationDelay: `${p.d}ms` }} />
            ))}
          </div>
        );
      case 'glint':
        // one blade-bright slash along the winning card's diagonal + the
        // sparks it throws — 650 ms, no residue
        return (
          <div key={s.id} data-testid="animfx-glint" className="animfx-glint" style={{ left: s.x, top: s.y }}>
            {burstPieces(5, 44, 7).map((p, i) => (
              <span key={i} className="fx-spark" style={{ left: '50%', top: '50%', width: p.s - 1, height: p.s - 1, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, animationDelay: `${p.d}ms` }} />
            ))}
          </div>
        );
      case 'coinflip':
        return <div key={s.id} data-testid="animfx-coinflip" className="animfx-coinflip" style={{ left: s.x, top: s.y }}><span /></div>;
      case 'shock':
        // a gold pressure ring + a soft felt ripple inside it + card dust;
        // the ring's reach scales with the run's tornado ladder level
        return (
          <div key={s.id} data-testid="animfx-shock" className="animfx-shock" style={{ left: s.x, top: s.y, ['--lvl' as string]: String(s.level ?? 1) }}>
            <span className="shock-ripple" />
            {burstPieces(8, 62, 11).map((p, i) => (
              <span key={i} className="fx-dust gold" style={{ left: '50%', top: '50%', width: p.s, height: p.s, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, animationDelay: `${p.d}ms` }} />
            ))}
          </div>
        );
      case 'broom':
        return (
          <div key={s.id} data-testid="animfx-broom" className="animfx-broom">
            <BroomSvg />
            {burstPieces(7, 30, 19).map((p, i) => (
              <span key={i} className="broom-dust" style={{ left: `${8 + i * 13}%`, width: 14 + p.s * 2, height: 10 + p.s, animationDelay: `${200 + i * 260}ms` }} />
            ))}
          </div>
        );
      case 'wheel':
        return (
          <div key={s.id} data-testid="animfx-wheel" className={`animfx-wheel${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="wheel-tire" />
            <span className="wheel-spark" />
          </div>
        );
      case 'bag':
        return (
          <div key={s.id} data-testid="animfx-bag" className={`animfx-bag${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="sack" />
            <span className="bag-dust d1" />
            <span className="bag-dust d2" />
          </div>
        );
      case 'crack':
        return <div key={s.id} data-testid="animfx-crack" className="animfx-crack" style={{ left: s.x - (s.w ?? 0) / 2, top: s.y - (s.h ?? 0) / 2, width: s.w, height: s.h }}><CrackSvg /></div>;
      case 'boardedge':
        // the gold light RUNS the edges in a wave out from the bidder's
        // slot (delay by slot distance), then the slam lands
        return (
          <div key={s.id} data-testid="animfx-boardedge" className="animfx-boardwrap">
            {(s.rects ?? []).map((r, i) => (
              <div key={i} className="animfx-boardedge" style={{ left: r.x - 3, top: r.y - 3, width: r.w + 6, height: r.h + 6, animationDelay: `${Math.abs(i - (s.seat ?? 0)) * 80}ms` }} />
            ))}
          </div>
        );
      case 'setbrick':
        // a real brick now: terracotta body, mortar seams, bevel — it
        // falls, the crack draws itself on impact, dust rings out. The
        // SERVED COLD variant (§C N3) grades the whole brick blue with a
        // frost edge and hangs the sub-stamp under it.
        return (
          <div key={s.id} data-testid="animfx-setbrick" className={`animfx-setbrick${s.still ? ' still' : ''}${s.cold ? ' cold' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="brick-label">SET</span>
            <CrackSvg />
            {s.cold && <span data-testid="animfx-servedcold" className="brick-coldtag">SERVED COLD</span>}
          </div>
        );
      case 'syncbeam':
        // a taut strand: it draws in, snaps bright, rings ONCE at the
        // midpoint like a plucked string settling, and decays
        return (
          <svg key={s.id} data-testid="animfx-syncbeam" className={`animfx-beamsvg${s.still ? ' still' : ''}`}>
            <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} className="animfx-beamline" />
            <circle cx={(s.x + (s.x2 ?? s.x)) / 2} cy={(s.y + (s.y2 ?? s.y)) / 2} r="6" className="animfx-syncring" />
          </svg>
        );
      case 'firstbook':
        return (
          <div key={s.id} data-testid="animfx-firstbook" className={`animfx-firstbook${s.still ? ' still' : ''}`}>
            <span className="fb-kicker">BID WIT ME</span>
            <span className="fb-title">FIRST BOOK</span>
            <span className="fb-sub">{s.label ? `${s.label} takes it` : 'of the match'}</span>
          </div>
        );
      case 'misdeal':
        return (
          <div key={s.id} data-testid="animfx-misdeal" className="animfx-misdeal">
            {Array.from({ length: 9 }, (_, i) => {
              const a = (i / 9) * Math.PI * 2;
              const dist = 120 + (i % 3) * 46;
              return <span key={i} className="md-card" style={{ ['--sx' as string]: `${Math.cos(a) * dist}px`, ['--sy' as string]: `${Math.sin(a) * dist * 0.62}px`, ['--sr' as string]: `${(i * 47) % 160 - 80}deg`, animationDelay: `${i * 24}ms` }} />;
            })}
          </div>
        );
      case 'ripple':
        return <div key={s.id} data-testid="animfx-ripple" className={`animfx-ripple${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }} />;
      case 'payback':
        return <div key={s.id} data-testid="animfx-payback" className="animfx-stamp payback" data-text="PAYBACK">PAYBACK</div>;
      case 'upset':
        // a broadcast chyron, not a stamp: the bar slides in league-clean
        // with the REAL rating gap printed under the word
        return (
          <div key={s.id} data-testid="animfx-upset" className="animfx-stamp upset">
            <span className="upset-word">UPSET</span>
            {s.label && <span className="upset-gap">RATING GAP {s.label}</span>}
          </div>
        );
      case 'savebeam': {
        // a lifeline THROWN, not a ruler line: it leaves the saver's plate
        // with a falling sag and CATCHES at the bidder's plate — the sag
        // path is the fall, the catch ring is the grab
        const mx = (s.x + (s.x2 ?? s.x)) / 2;
        const my = (s.y + (s.y2 ?? s.y)) / 2 + 34;
        return (
          <svg key={s.id} data-testid="animfx-savebeam" className={`animfx-beamsvg save${s.still ? ' still' : ''}`}>
            <path d={`M ${s.x} ${s.y} Q ${mx} ${my} ${s.x2 ?? s.x} ${s.y2 ?? s.y}`} className="animfx-beamline" fill="none" />
            <circle cx={s.x2} cy={s.y2} r="5" className="animfx-savedot" />
            <circle cx={s.x2} cy={s.y2} r="6" className="animfx-catchring" />
          </svg>
        );
      }
      case 'nilseal':
        // a wax-seal bloom: the ring stamps down and embosses, the NIL
        // sits IN the wax (inset shadow), one foil shine sweeps it
        return (
          <div key={s.id} data-testid="animfx-nilseal" className={`animfx-nilseal${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="seal-ring" />
            <span className="seal-disc">NIL</span>
          </div>
        );
      case 'tornchip':
        // the Run It ladder badge: the prototype caption plaque, riding
        // ABOVE the claimant's plate (CSS translate −185%), never over the
        // name or the cards. Five pips tick up to the rung, one by one.
        return (
          <div key={s.id} data-testid="animfx-tornchip" className={`animfx-tornchip${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="tornchip-name">Level {s.level} · {s.name}</span>
            <span className="tornchip-pips">
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={`tornchip-pip${i <= (s.level ?? 0) ? ' lit' : ''}`} style={{ animationDelay: `${(i - 1) * 170}ms` }} />
              ))}
            </span>
          </div>
        );
      case 'ember':
        // a single ember cracks at the trick centre and sheds sparks
        // that gutter out along its sweep — then nothing remains
        return (
          <div key={s.id} data-testid="animfx-ember" className="animfx-ember" style={{ top: s.y }}>
            <span className="ember-streak" />
            {burstPieces(9, 74, 23).map((p, i) => (
              <span key={i} className="fx-spark ember-spark" style={{ left: '50%', top: 0, width: p.s - 1, height: p.s - 1, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, animationDelay: `${120 + p.d}ms` }} />
            ))}
          </div>
        );
      case 'wire':
        // rebuilt renderer (recapfx): the edge light tightens like a held
        // breath — inhale, HOLD at the peak, slow exhale; calm = one low
        // outline. The layer keeps the trigger + the 900/750 ms timing.
        return (
          <div key={s.id} data-testid="animfx-wire">
            <WireOverlay still={!!s.still} />
          </div>
        );
      /* ------------------------------------------------ §C new scenarios */
      case 'doublemoon': {
        // two crescents rise from the partners' plates, travel to the
        // table centre and merge into ONE full moon, hold a beat, set
        const cx = (s.x + (s.x2 ?? s.x)) / 2;
        const cy = Math.min(s.y, s.y2 ?? s.y) - 90;
        return (
          <div key={s.id} data-testid="animfx-doublemoon" className={`animfx-doublemoon${s.still ? ' still' : ''}`}>
            <span className="dm-crescent a" style={{ left: s.x, top: s.y, ['--tx' as string]: `${cx - s.x}px`, ['--ty' as string]: `${cy - s.y}px` }} />
            <span className="dm-crescent b" style={{ left: s.x2, top: s.y2, ['--tx' as string]: `${cx - (s.x2 ?? s.x)}px`, ['--ty' as string]: `${cy - (s.y2 ?? s.y)}px` }} />
            <span className="dm-full" style={{ left: cx, top: cy }} />
          </div>
        );
      }
      case 'shush':
        return (
          <div key={s.id} data-testid="animfx-shush" className={`animfx-shush${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="shush-ring" />
            <span className="shush-glyph" aria-hidden="true">🤫</span>
          </div>
        );
      case 'ninelives':
        return (
          <div key={s.id} data-testid="animfx-ninelives" className={`animfx-ninelives${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
            <CrackSvg />
            <span className="nl-shoot"><span className="nl-leaf l1" /><span className="nl-leaf l2" /></span>
          </div>
        );
      case 'assassin':
        return (
          <div key={s.id} data-testid="animfx-assassin" className={`animfx-assassin${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
            <span className="as-line" />
          </div>
        );
      case 'guillotine':
        return (
          <div key={s.id} data-testid="animfx-guillotine" className={`animfx-guillotine${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
            <span className="guil-blade" />
          </div>
        );
      case 'textbook':
        return (
          <div key={s.id} data-testid="animfx-textbook" className={`animfx-textbook${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
            <span className="tb-line" />
            <span className="tb-exact">EXACT</span>
          </div>
        );
      case 'potin':
      case 'potout':
        return (
          <div key={s.id} data-testid={`animfx-${s.kind}`} className="animfx-potwrap">
            <div className="animfx-pot" style={{ left: s.x, top: s.y }}>
              <span className="pot-coins"><CoinIcon size={19} /><CoinIcon size={19} /></span>
              <span className="pot-label">POT {s.label}</span>
            </div>
            {(s.coins ?? []).map((c, i) => (
              <span key={i} className={`animfx-coin ${s.kind}`} style={{ left: c.x, top: c.y, ['--tx' as string]: `${c.tx}px`, ['--ty' as string]: `${c.ty}px`, animationDelay: `${c.d}ms` }}><CoinIcon size={17} /></span>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  const isStamp = (s: Shot) => s.kind === 'ripple' || s.kind === 'payback' || s.kind === 'upset';
  return (
    <>
      <div className="animfx-layer" aria-hidden="true" data-testid="animfx">
        {narrow && <div className="animfx-narrow" style={{ background: narrow }} />}
        {shade && (
          <canvas
            ref={shadeCanvasRef}
            className="animfx-dim"
            data-testid="animfx-spotlight"
            style={{ width: '100%', height: '100%' }}
            aria-hidden="true"
          />
        )}
        {shade?.pools.map((p, i) => (
          <div key={`pool${i}`} data-testid="animfx-spotpool" className={`animfx-spotpool${reduced ? ' calm' : ''}`} style={{ left: p.cx - p.r, top: p.cy - p.r, width: p.r * 2, height: p.r * 2 }}>
            {/* dust motes drifting in the beam — deterministic positions,
                held still under calm (the pool is light, not weather) */}
            {!reduced && MOTES.map((m, j) => (
              <span key={j} className="spot-mote" style={{ left: `${m.l}%`, top: `${m.t}%`, width: m.s, height: m.s, animationDelay: `${m.d}ms` }} />
            ))}
          </div>
        ))}
        {sealedSpots.map((s) => (
          <div key={`seal${s.seat}`} data-testid="animfx-sealmark" className="animfx-sealmark" style={{ left: s.x + s.w / 2 - 26, top: s.y - s.h / 2 - 7 }}>NIL</div>
        ))}
        {mirrorCells.map((c) => (
          <div key={`mir${c.side}`} data-testid="animfx-mirrorframe" className={`animfx-mirrorframe${reduced ? ' calm' : ''}`} style={{ left: c.x - 3, top: c.y - 3, width: c.w + 6, height: c.h + 6 }} />
        ))}
        {spots.map((s) => (
          <div key={`sp${s.seat}`} className={`animfx-spotring${reduced ? ' calm' : ''}`} style={{ left: s.x - s.w / 2 - 6, top: s.y - s.h / 2 - 6, width: s.w + 12, height: s.h + 12 }} />
        ))}
        {moons.map((s) => (
          <div key={`mn${s.seat}`}>
            <div className="animfx-moonring" style={{ left: s.x - s.w / 2 - 5, top: s.y - s.h / 2 - 5, width: s.w + 10, height: s.h + 10 }} />
            {s.sx !== null && <div className="animfx-moonedge" style={{ left: s.sx - 34, top: (s.sy ?? 0) - 48, width: 68, height: 96 }} />}
          </div>
        ))}
        {fireFx && (() => {
          const f = trickFire(fireFx.count);
          const s = fireFx.spot;
          const padX = 12;
          const padB = 12;
          const rise = f.kind === 'smolder' ? 22 : 38 + f.tier * 12;
          return (
            <div key={`fr${s.seat}`} className="animfx-platefire" style={{ left: s.x - s.w / 2 - padX, top: s.y - s.h / 2 - rise, width: s.w + padX * 2, height: s.h + rise + padB }}>
              <FireCanvas
                mode="plate"
                testId={f.kind === 'fire' ? 'animfx-firering' : 'animfx-smolder'}
                params={f.kind === 'smolder' ? SMOLDER_PARAMS : TRICK_FIRE_TIERS[f.tier]}
                mask={{ x: padX, y: rise, w: s.w, h: s.h }}
                calm={reduced}
                label={trickFireLabel(fireFx.count)}
                labelTestId="animfx-firelabel"
                chipStyle={{ top: rise - 9, right: padX - 6 }}
              />
            </div>
          );
        })()}
        {cells.map((c) => (
          <Fragment key={`cell${c.side}`}>
            {c.heat && <div data-testid="animfx-cellheat" className={`animfx-cellheat${reduced ? ' calm' : ''}`} style={{ left: c.x, top: c.y, width: c.w, height: c.h }} />}
            {c.brink && (
              <div data-testid="animfx-cellbrink" className={`animfx-cellbrink${reduced ? ' calm' : ''}${c.cycle === 9 ? ' at9' : ' at8'}`} style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
                {/* the bag stack itself: it leans as the cycle strains —
                    at 9 one bag has slid to the very edge of the cell */}
                <span className="brink-bag b1" />
                <span className="brink-bag b2" />
              </div>
            )}
          </Fragment>
        ))}
        {shots.filter((s) => !isStamp(s)).map(renderShot)}
        <HeadlightSweep calm={reduced} />
      </div>
      {/* game-over graphics ride ABOVE the victory screen (z 1000): the
          winning-book ripple and the PAYBACK / UPSET stamps */}
      <div className="animfx-stamps" aria-hidden="true">
        {shots.filter(isStamp).map(renderShot)}
      </div>
    </>
  );
}
