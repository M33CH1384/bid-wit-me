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
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Bid, type GameResult, type HandRecord, type Phase, type TableRules, type Trick } from '@spades/rules';

/**
 * The slice of table state the layer reads. Both the offline GameState and
 * the online seat view satisfy it, so the same triggers work at every table.
 */
export interface AnimFxView {
  rules: TableRules; phase: Phase; handNo: number;
  bids: (Bid | null)[]; trick: Trick; tricks: Trick[];
  tricksWon: number[]; scores: number[]; bags: number[];
  history: HandRecord[]; result: GameResult | null; eliminated?: boolean[];
}
import { fx, useReduceEffects } from '../fx';
import { CoinIcon } from '../RepBlock';
import { fetchWagerList } from '../social/wagerApi';
import {
  bagPenaltySides, bigJokerSeat, blindNilSeats, bostonSides, comebackSides,
  matchPointSides, newlyEliminated, nilLiveSeats, runClaimerSeat,
  seatsOfSide, trickWasCut, wheelsSides,
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

interface BwmLayout { trick?: Rect[]; slots?: Rect[]; trickCards?: (Rect & { card: string })[] }
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

type ShotKind = 'bjring' | 'glint' | 'coinflip' | 'shock' | 'broom' | 'wheel' | 'bag' | 'crack' | 'potin' | 'potout';
interface CoinFlight { x: number; y: number; tx: number; ty: number; d: number }
interface Shot { id: number; kind: ShotKind; x: number; y: number; w?: number; h?: number; still?: boolean; label?: string; coins?: CoinFlight[] }

interface SeatSpot { seat: number; x: number; y: number; w: number; h: number; sx: number | null; sy: number | null }

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

export default function AnimFxLayer({ st, online = false }: { st: AnimFxView; online?: boolean }) {
  const reduceFx = useReduceEffects();
  const reduced = reduceFx || fx.osReducedMotion;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const [shots, setShots] = useState<Shot[]>([]);
  const [spots, setSpots] = useState<SeatSpot[]>([]);
  const [moons, setMoons] = useState<SeatSpot[]>([]);
  const [, setTick] = useState(0);

  const timers = useRef(new Set<number>());
  const idRef = useRef(0);
  const seenRef = useRef(new Set<string>());
  const wagerRef = useRef<{ id: string; pot: number } | null>(null);
  const potArmed = useRef(true);

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
  interface Snap { handNo: number; bids: (Bid | null)[]; hist: number; eliminated?: boolean[]; hasResult: boolean }
  const prevRef = useRef<Snap | null>(null);
  useEffect(() => {
    const snap: Snap = {
      handNo: st.handNo, bids: [...st.bids], hist: st.history.length,
      eliminated: st.eliminated ? [...st.eliminated] : undefined,
      hasResult: !!st.result,
    };
    const p = prevRef.current;
    prevRef.current = snap;
    if (!p) return;
    // a new game at the same table (rematch): history/hand counts rewind — resync silently
    if (snap.hist < p.hist || snap.handNo < p.handNo) { seenRef.current = new Set(); return; }

    // blind nil: the bid chip flips like a coin toss when the bid lands
    st.bids.forEach((b, seat) => {
      if (b === 'blindNil' && p.bids[seat] !== 'blindNil' && !calm()) fireAtPlate('coinflip', seat, 1000);
    });

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
    }

    // cutthroat elimination moment: the crack flash (the dead look itself is persistent, below)
    for (const seat of newlyEliminated(p.eliminated, snap.eliminated)) {
      if (calm()) continue;
      const r = plateRectOf(seat);
      if (r) addShot({ kind: 'crack', x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h }, 850);
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

  /* ------------------------------------------- measured persistent overlays */
  useLayoutEffect(() => {
    const measure = (seats: number[]): SeatSpot[] => seats.flatMap((seat) => {
      const el = plateEl(seat);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      const slot = layoutWin()?.slots?.[seat];
      return [{ seat, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, sx: slot ? slot.x + slot.w / 2 : null, sy: slot ? slot.y + slot.h / 2 : null }];
    });
    const ns = st.phase === 'playing' ? measure(nilLiveSeats(st)) : [];
    const nm = st.phase === 'playing' ? measure(blindNilSeats(st)) : [];
    setSpots((prev) => (JSON.stringify(prev) === JSON.stringify(ns) ? prev : ns));
    setMoons((prev) => (JSON.stringify(prev) === JSON.stringify(nm) ? prev : nm));
  });

  const dimBg = spots.length
    ? spots.flatMap((s) => [
      `radial-gradient(circle 205px at ${s.x}px ${s.y}px, rgba(2,4,12,0) 32%, rgba(2,4,12,0.55) 80%)`,
      `radial-gradient(circle 135px at ${s.sx ?? s.x}px ${s.sy ?? s.y}px, rgba(2,4,12,0) 32%, rgba(2,4,12,0.55) 80%)`,
    ]).join(', ')
    : null;
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

  return (
    <div className="animfx-layer" aria-hidden="true" data-testid="animfx">
      {narrow && <div className="animfx-narrow" style={{ background: narrow }} />}
      {dimBg && <div className="animfx-dim" data-testid="animfx-spotlight" style={{ background: dimBg }} />}
      {spots.map((s) => (
        <div key={`sp${s.seat}`} className={`animfx-spotring${reduced ? ' calm' : ''}`} style={{ left: s.x - s.w / 2 - 6, top: s.y - s.h / 2 - 6, width: s.w + 12, height: s.h + 12 }} />
      ))}
      {moons.map((s) => (
        <div key={`mn${s.seat}`}>
          <div className="animfx-moonring" style={{ left: s.x - s.w / 2 - 5, top: s.y - s.h / 2 - 5, width: s.w + 10, height: s.h + 10 }} />
          {s.sx !== null && <div className="animfx-moonedge" style={{ left: s.sx - 34, top: (s.sy ?? 0) - 48, width: 68, height: 96 }} />}
        </div>
      ))}
      {shots.map(renderShot)}
      <HeadlightSweep calm={reduced} />
    </div>
  );
}
