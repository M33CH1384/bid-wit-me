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
}
import { fx, useReduceEffects } from '../fx';
import { CoinIcon } from '../RepBlock';
import { fetchWagerList } from '../social/wagerApi';
import {
  UPSET_GAP, bagPenaltySides, bigJokerSeat, blindNilSeats, bostonSides, comebackSides,
  matchPointSides, newlyEliminated, nilLiveSeats, ratingGap, runClaimerSeat,
  seatsOfSide, setSides, sideIndexOf, syncSides, trickWasCut, wheelsSides,
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

type ShotKind = 'bjring' | 'glint' | 'coinflip' | 'shock' | 'broom' | 'wheel' | 'bag' | 'crack' | 'potin' | 'potout'
  | 'boardedge' | 'setbrick' | 'syncbeam' | 'firstbook' | 'misdeal' | 'ripple' | 'payback' | 'upset';
interface CoinFlight { x: number; y: number; tx: number; ty: number; d: number }
interface Shot { id: number; kind: ShotKind; x: number; y: number; w?: number; h?: number; still?: boolean; label?: string; coins?: CoinFlight[]; rects?: Rect[]; x2?: number; y2?: number }

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

export default function AnimFxLayer({ st, online = false, names }: { st: AnimFxView; online?: boolean; names?: string[] }) {
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
  const firstBookRef = useRef(false);
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
  interface Snap { handNo: number; bids: (Bid | null)[]; hist: number; eliminated?: boolean[]; hasResult: boolean; hasMisdeal: boolean }
  const prevRef = useRef<Snap | null>(null);
  useEffect(() => {
    const snap: Snap = {
      handNo: st.handNo, bids: [...st.bids], hist: st.history.length,
      eliminated: st.eliminated ? [...st.eliminated] : undefined,
      hasResult: !!st.result, hasMisdeal: !!st.misdealReveal,
    };
    const p = prevRef.current;
    prevRef.current = snap;
    if (!p) return;
    // a new game at the same table (rematch): history/hand counts rewind — resync silently
    if (snap.hist < p.hist || snap.handNo < p.handNo) { seenRef.current = new Set(); firstBookRef.current = false; return; }

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
    }

    // cutthroat elimination moment: the crack flash (the dead look itself is persistent, below)
    for (const seat of newlyEliminated(p.eliminated, snap.eliminated)) {
      if (calm()) continue;
      const r = plateRectOf(seat);
      if (r) addShot({ kind: 'crack', x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h }, 850);
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
