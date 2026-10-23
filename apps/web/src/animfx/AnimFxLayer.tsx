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
  /** non-standard trick counts (short/cut variants) ride the view, when present */
  trickCount?: number;
}
import { fx, useReduceEffects } from '../fx';
import { CoinIcon } from '../RepBlock';
import { fetchWagerList } from '../social/wagerApi';
import {
  UPSET_GAP, bagBrinkSides, bagPenaltySides, bigJokerSeat, blindNilSeats, bostonSides,
  comebackSides, fireSeat, heatSides, matchPointSides, newlyEliminated,
  nilBustedSeats, nilLiveSeats, photoFinish, ratingGap, runClaimerSeat, saveInTrick,
  sealedNilSeats, seatsOfSide, setSides, sideIndexOf, spadePlayed, syncSides,
  trickWasCut, wheelsSides, wireSides,
} from './detect';
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
  | 'savebeam' | 'nilseal' | 'ember' | 'wire' | 'photofinish' | 'confetti';
interface CoinFlight { x: number; y: number; tx: number; ty: number; d: number }
interface ConfettiPiece { l: number; dx: number; d: number; r: number; s: number; c: string }
interface Shot { id: number; kind: ShotKind; x: number; y: number; w?: number; h?: number; still?: boolean; label?: string; coins?: CoinFlight[]; rects?: Rect[]; x2?: number; y2?: number; pieces?: ConfettiPiece[] }

interface CellFx { side: number; x: number; y: number; w: number; h: number; heat: boolean; brink: boolean }

/* victory confetti: gold spades for the winning side's viewer only. The
 * scatter is a deterministic function of the piece index (sin hashing) —
 * no Math.random, so the rain is identical on every render and testable. */
const CONFETTI_COLORS = ['#ffd940', '#f5c542', '#fff0c4', '#ffb52e'];
function confettiPieces(still: boolean): ConfettiPiece[] {
  const n = still ? 8 : 24;
  return Array.from({ length: n }, (_, i) => {
    const h1 = Math.abs(Math.sin(i * 127.1 + 311.7));
    const h2 = Math.abs(Math.sin(i * 269.5 + 183.3));
    const h3 = Math.abs(Math.sin(i * 113.5 + 47.9));
    return {
      l: 3 + h1 * 94,
      dx: Math.round((h2 - 0.5) * 130),
      d: Math.round(h3 * 550),
      r: Math.round((h1 - 0.5) * 560),
      s: 13 + Math.round(h2 * 9),
      c: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
    };
  });
}

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
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="crack-svg" aria-hidden="true">
      <polyline points="50,-2 44,26 57,42 45,64 53,102" />
      <polyline points="57,42 76,50" />
      <polyline points="45,64 26,72" />
      <polyline points="44,26 29,34" />
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
  return <div key={n} data-testid="pj-headlights" className={`animfx-headlights${calm ? ' calm' : ''}`} aria-hidden="true" />;
}

/* -------------------------------------------------------------------- main */

export default function AnimFxLayer({ st, online = false, names }: { st: AnimFxView; online?: boolean; names?: string[] }) {
  const reduceFx = useReduceEffects();
  const reduced = reduceFx || fx.osReducedMotion;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const [shots, setShots] = useState<Shot[]>([]);
  const [spots, setSpots] = useState<SeatSpot[]>([]);
  const [shade, setShade] = useState<ShadeSpec | null>(null);
  const [moons, setMoons] = useState<SeatSpot[]>([]);
  const [fireSpots, setFireSpots] = useState<SeatSpot[]>([]);
  const [cells, setCells] = useState<CellFx[]>([]);
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
    const onResize = () => paintShade();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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
    const onResize = () => setTick((x) => x + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const addShot = (shot: Omit<Shot, 'id'>, ms: number) => {
    const id = ++idRef.current;
    setShots((ss) => [...ss.slice(-11), { ...shot, id }]);
    later(() => setShots((ss) => ss.filter((x) => x.id !== id)), ms);
  };
  const calm = () => reducedRef.current;

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
    if (!p) { spadeRef.current = spadePlayed(st.tricks, st.trick); return; }
    // a new game at the same table (rematch): history/hand counts rewind — resync silently
    if (snap.hist < p.hist || snap.handNo < p.handNo) { seenRef.current = new Set(); firstBookRef.current = false; spadeRef.current = spadePlayed(st.tricks, st.trick); return; }

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
            if (rects.length) addShot({ kind: 'boardedge', x: 0, y: 0, rects }, 1000);
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
          if (!calm()) { const seat = runClaimerSeat(st.tricks); if (seat !== null) fireAtPlate('shock', seat, 1150); }
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
      addShot({ kind: 'firstbook', x: 0, y: 0, still: calm() }, calm() ? 1500 : 2300);
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
      // every side that shot them stomps its books down on the scorebug
      const set = setSides(rec);
      for (const side of set) {
        const pt = bugTeamPt(side) ?? platePt(seatsOfSide(st.rules, side)[0] ?? 0);
        if (pt) addShot({ kind: 'setbrick', x: pt.x, y: pt.y, still: calm() }, calm() ? 1300 : 1500);
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
      for (const seat of sealedNilSeats(rec)) {
        const pt = platePt(seat);
        if (pt) addShot({ kind: 'nilseal', x: pt.x, y: pt.y, still: calm() }, calm() ? 1000 : 1350);
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
        const r = plateRectOf(seat);
        if (r) addShot({ kind: 'crack', x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h }, 780);
      }
    }

    // MISDEAL: the dealt cards scatter and swirl back into the deck before the re-deal
    if (snap.hasMisdeal && !p.hasMisdeal && !calm()) addShot({ kind: 'misdeal', x: 0, y: 0 }, 1050);

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
      // PHOTO FINISH + VICTORY CONFETTI: decided from the result alone, so
      // they fire in BOTH game-over views (offline included), unlike the
      // online-gated PAYBACK/UPSET stamps below. Confetti rains only for a
      // viewer on a winning side — losers get none.
      if (photoFinish(st.result)) addShot({ kind: 'photofinish', x: 0, y: 0 }, 3000);
      if (st.result.winners.includes(sideIndexOf(st.rules, st.seat ?? 0))) {
        addShot({ kind: 'confetti', x: 0, y: 0, still: calm(), pieces: confettiPieces(calm()) }, calm() ? 1300 : 2300);
      }
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
        if (wr.length && lr.length && wr.every((r) => r !== null) && lr.every((r) => r !== null)
          && ratingGap(wr as number[], lr as number[]) >= UPSET_GAP) {
          addShot({ kind: 'upset', x: 0, y: 0 }, 3000);
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
                  addShot({ kind: 'payback', x: 0, y: 0 }, 3200);
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
    document.querySelectorAll('.bug-teams .bug-team').forEach((el, side) => {
      el.classList.toggle('animfx-mp', mp.has(side) && !reducedRef.current);
      el.classList.toggle('animfx-mp-still', mp.has(side) && reducedRef.current);
    });
  }, [st]);
  useEffect(() => () => {
    document.querySelectorAll('.animfx-dead').forEach((el) => el.classList.remove('animfx-dead'));
    document.querySelectorAll('.animfx-mp, .animfx-mp-still').forEach((el) => el.classList.remove('animfx-mp', 'animfx-mp-still'));
  }, []);

  /* TRASH-TALK POP: the table's banter bubble (Table's .trash-callout, keyed
     per line) pops comic-style when a line lands, and the speaker's plate —
     the one nearest the bubble — bounces once. The callout is Table's own
     element; the layer only decorates it, via a mutation observer. */
  useEffect(() => {
    const seenText = new WeakMap<Element, string>();
    const pop = (el: Element) => {
      if (reducedRef.current) return;
      el.classList.add('animfx-pop');
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
    /* wave 3 persistent looks, measured the same way: ON FIRE rim over the
       streaking seat's plate; STREAK HEAT / BAG BRINK overlays over the
       scorebug cells */
    const fp = st.phase === 'playing' ? fireSeat(st) : null;
    const nf = fp !== null ? measure([fp]) : [];
    setFireSpots((prev) => (JSON.stringify(prev) === JSON.stringify(nf) ? prev : nf));
    const heat = heatSides(st.history);
    const brink = st.result ? [] : bagBrinkSides(st.bags);
    const nc: CellFx[] = [...new Set([...heat, ...brink])].flatMap((side) => {
      const el = bugTeamEl(side);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ side, x: r.left, y: r.top, w: r.width, h: r.height, heat: heat.includes(side), brink: brink.includes(side) }];
    });
    setCells((prev) => (JSON.stringify(prev) === JSON.stringify(nc) ? prev : nc));
  });
  const deadCount = (st.eliminated ?? []).filter(Boolean).length;
  const narrow = deadCount > 0 && st.phase !== 'gameOver'
    ? `radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,${Math.min(0.32, 0.1 + deadCount * 0.09).toFixed(2)}) 100%)`
    : null;

  const renderShot = (s: Shot) => {
    switch (s.kind) {
      case 'bjring':
        return <div key={s.id} data-testid="animfx-bjring" className="animfx-bjring" style={{ left: s.x - (s.w ?? 86) / 2, top: s.y - (s.h ?? 120) / 2, width: s.w ?? 86, height: s.h ?? 120 }} />;
      case 'glint':
        return <div key={s.id} data-testid="animfx-glint" className="animfx-glint" style={{ left: s.x, top: s.y }} />;
      case 'coinflip':
        return <div key={s.id} data-testid="animfx-coinflip" className="animfx-coinflip" style={{ left: s.x, top: s.y }}><span /></div>;
      case 'shock':
        return <div key={s.id} data-testid="animfx-shock" className="animfx-shock" style={{ left: s.x, top: s.y }} />;
      case 'broom':
        return <div key={s.id} data-testid="animfx-broom" className="animfx-broom"><BroomSvg /></div>;
      case 'wheel':
        return <div key={s.id} data-testid="animfx-wheel" className={`animfx-wheel${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }} />;
      case 'bag':
        return <div key={s.id} data-testid="animfx-bag" className={`animfx-bag${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}><span className="sack" /></div>;
      case 'crack':
        return <div key={s.id} data-testid="animfx-crack" className="animfx-crack" style={{ left: s.x - (s.w ?? 0) / 2, top: s.y - (s.h ?? 0) / 2, width: s.w, height: s.h }}><CrackSvg /></div>;
      case 'boardedge':
        return (
          <div key={s.id} data-testid="animfx-boardedge" className="animfx-boardwrap">
            {(s.rects ?? []).map((r, i) => (
              <div key={i} className="animfx-boardedge" style={{ left: r.x - 3, top: r.y - 3, width: r.w + 6, height: r.h + 6 }} />
            ))}
          </div>
        );
      case 'setbrick':
        return (
          <div key={s.id} data-testid="animfx-setbrick" className={`animfx-setbrick${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="brick-label">SET</span>
            <CrackSvg />
          </div>
        );
      case 'syncbeam':
        return (
          <svg key={s.id} data-testid="animfx-syncbeam" className={`animfx-beamsvg${s.still ? ' still' : ''}`}>
            <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} className="animfx-beamline" />
          </svg>
        );
      case 'firstbook':
        return (
          <div key={s.id} data-testid="animfx-firstbook" className={`animfx-firstbook${s.still ? ' still' : ''}`}>
            <span className="fb-kicker">BID WIT ME</span>
            <span className="fb-title">FIRST BOOK</span>
            <span className="fb-sub">of the match</span>
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
        return <div key={s.id} data-testid="animfx-payback" className="animfx-stamp payback">PAYBACK</div>;
      case 'upset':
        return <div key={s.id} data-testid="animfx-upset" className="animfx-stamp upset">UPSET</div>;
      case 'savebeam':
        return (
          <svg key={s.id} data-testid="animfx-savebeam" className={`animfx-beamsvg save${s.still ? ' still' : ''}`}>
            <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} className="animfx-beamline" />
            <circle cx={s.x2} cy={s.y2} r="5" className="animfx-savedot" />
          </svg>
        );
      case 'nilseal':
        return (
          <div key={s.id} data-testid="animfx-nilseal" className={`animfx-nilseal${s.still ? ' still' : ''}`} style={{ left: s.x, top: s.y }}>
            <span className="seal-ring" />
            <span className="seal-label">NIL</span>
          </div>
        );
      case 'ember':
        return <div key={s.id} data-testid="animfx-ember" className="animfx-ember" style={{ top: s.y }}><span className="ember-streak" /></div>;
      case 'wire':
        return <div key={s.id} data-testid="animfx-wire" className={`animfx-wire${s.still ? ' still' : ''}`} />;
      case 'photofinish':
        return <div key={s.id} data-testid="animfx-photofinish" className="animfx-stamp photofinish">PHOTO FINISH</div>;
      case 'confetti':
        return (
          <div key={s.id} data-testid="animfx-confetti" className={`animfx-confetti${s.still ? ' still' : ''}`}>
            {(s.pieces ?? []).map((p, i) => (
              <span key={i} className="cf-piece" style={{ left: `${p.l}%`, color: p.c, fontSize: p.s, ['--dx' as string]: `${p.dx}px`, ['--rot' as string]: `${p.r}deg`, animationDelay: `${p.d}ms` }}>♠</span>
            ))}
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

  const isStamp = (s: Shot) => s.kind === 'ripple' || s.kind === 'payback' || s.kind === 'upset' || s.kind === 'photofinish' || s.kind === 'confetti';
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
          <div key={`pool${i}`} data-testid="animfx-spotpool" className={`animfx-spotpool${reduced ? ' calm' : ''}`} style={{ left: p.cx - p.r, top: p.cy - p.r, width: p.r * 2, height: p.r * 2 }} />
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
        {fireSpots.map((s) => (
          <div key={`fr${s.seat}`} data-testid="animfx-firering" className={`animfx-firering${reduced ? ' calm' : ''}`} style={{ left: s.x - s.w / 2 - 5, top: s.y - s.h / 2 - 5, width: s.w + 10, height: s.h + 10 }} />
        ))}
        {cells.map((c) => (
          <Fragment key={`cell${c.side}`}>
            {c.heat && <div data-testid="animfx-cellheat" className={`animfx-cellheat${reduced ? ' calm' : ''}`} style={{ left: c.x, top: c.y, width: c.w, height: c.h }} />}
            {c.brink && <div data-testid="animfx-cellbrink" className={`animfx-cellbrink${reduced ? ' calm' : ''}`} style={{ left: c.x, top: c.y, width: c.w, height: c.h }} />}
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
