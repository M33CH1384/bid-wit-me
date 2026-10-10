import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Card, type GameState, type PlayerView, SUIT_NAME, type Suit, booksHand, cardLabel, cardPower, effectiveSuit, handSize, isTrump, trumpOrder } from '@spades/rules';
import { TERM_ORDER, type TermKey, glossary, parseTerms, topTrumps, trumpWords } from './glossary';
import { TIP_MAX_SHOWS, bumpTip, tipCount, tipDurationMs } from './tips';

/**
 * "Learn as you play": context-triggered coach marks (only for the player who turned tips on — online too, it's all
 * local). Tips keep coming across hands until the player turns them off ("I've got it"); each type pops up on its own
 * at most a few times (TIP_MAX_SHOWS, counted across games), then only on request via the "?" button.
 * One tip at a time, pointing at what it explains, placed clear of the name plates.
 */
export interface CoachCtx {
  st: GameState;
  view: PlayerView;
  hand: Card[] | null;
  legal: Card[];
  myTurn: boolean;
  me: number;
  partnerName: string | null;
  pause: boolean;
  /** local-seat names (0 = you) */
  names?: string[];
}
/** What a tip points at on screen: rings + tags over cards on the table / in your hand while the tip is open. */
export type MarkKind = 'led' | 'trump' | 'throw' | 'match' | 'strong' | 'won';
export interface Mark { card: Card; tag: string; kind: MarkKind }
export interface TipMarks { trick?: Mark[]; hand?: Mark[] }
interface Tip { id: string; title: string; text: string; anchor: string | 'hand' | 'trick'; when: (c: CoachCtx) => boolean; max?: number; marks?: TipMarks; basics?: boolean }

const label = (c: Card) => cardLabel(c);
export const SUIT_SYM: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
/** "Hearts ♥" */
export const suitWords = (s: Suit) => `${SUIT_NAME[s]} ${SUIT_SYM[s]}`;

/**
 * Tips for someone who has never played a trick-taking game: short, concrete, pointing at what's on screen.
 * `{term}` / `{shown|term}` become tappable definitions (see glossary.ts).
 */
export function tipsFor(c: CoachCtx): Tip[] {
  const r = c.st.rules;
  const g = glossary(r);
  const order = trumpOrder(r);
  const top = topTrumps(r);
  const tw = trumpWords(r);
  const jokers = order.includes('BJ' as Card);
  const lead = c.st.trick.plays[0];
  const led = lead?.card;
  const ledSuit = led ? effectiveSuit(led, r) : null;
  const hand = c.hand ?? [];
  const holdsLed = !!ledSuit && hand.some((x) => effectiveSuit(x, r) === ledSuit);
  const myTrumps = hand.filter((x) => isTrump(x, r));
  const holdsTrump = myTrumps.length > 0;
  const playing = c.myTurn && c.st.phase === 'playing' && !c.pause;
  const books = booksHand(c.st);
  const name = (seat: number) => (seat === c.me ? 'You' : c.names?.[seat] ?? `Seat ${seat + 1}`);
  const ledWords = ledSuit ? (ledSuit === 'S' && jokers ? 'Spades ♠ (trumps)' : suitWords(ledSuit)) : '';
  const ledPlural = ledSuit ? SUIT_NAME[ledSuit].toLowerCase() : '';
  const ledMark: Mark[] = led ? [{ card: led, tag: 'LED', kind: 'led' }] : [];
  // strongest card you hold, for the "your hand" tip
  const best = [...hand].sort((a, b) => cardPower(b, r) - cardPower(a, r))[0];
  const bestIsTop = !!best && best === order[0];
  const bestAce = hand.find((x) => !isTrump(x, r) && x[0] === 'A');
  const handPoint = !hand.length ? '' : bestIsTop
    ? `Your ${label(best!)} is the strongest card in the game: it can't lose.`
    : best && isTrump(best, r)
      ? `Your ${label(best)} ${effectiveSuit(best, r) === 'S' && best.endsWith('S') ? 'is a spade' : 'counts as a spade'} (a {trump}): it beats every heart, diamond and club.`
      : bestAce ? `Your ${label(bestAce)} is the {highest|high} ${SUIT_NAME[effectiveSuit(bestAce, r)].toLowerCase().replace(/s$/, '')}.` : '';
  const handMark = bestIsTop || (best && isTrump(best, r)) ? best : bestAce;
  const rankLine = jokers
    ? `{Bigger cards|high} win: 2 is lowest, Ace highest, and the Jokers${order.some((x) => x === '2D') ? ', 2♦' : ''}${order.some((x) => x === '2S') ? ' and 2♠' : ''} beat everything.`
    : '{Bigger cards|high} win: 2 is lowest, Ace is highest.';
  // the cut tip: trumps you could cut with vs. low cards you could throw away
  const throwaways = hand.filter((x) => !isTrump(x, r) && c.legal.includes(x)).sort((a, b) => cardPower(a, r) - cardPower(b, r)).slice(0, 2);
  const last = c.st.tricks[c.st.tricks.length - 1];
  const lastWin = last?.winner ?? null;
  const lastWinCard = last && lastWin !== null ? last.plays.find((p) => p.seat === lastWin)?.card : undefined;
  const lastLed = last?.plays[0] ? effectiveSuit(last.plays[0].card, r) : null;
  const whyWon = lastWinCard && lastLed
    ? isTrump(lastWinCard, r) && lastLed !== 'S'
      ? `the ${label(lastWinCard)} ${lastWinCard.endsWith('S') ? 'is a spade' : 'counts as a spade'} (a {trump}), and any spade beats any ${SUIT_NAME[lastLed].toLowerCase().replace(/s$/, '')}`
      : `the ${label(lastWinCard)} was the {highest card|high} of the suit that was {led|lead}`
    : '';
  const partnerSeat = (c.me + 2) % 4;
  const pBid = c.st.bids[partnerSeat];
  const n = handSize(r);
  return [
    {
      id: 'goal', title: 'The goal', anchor: '.scorebug .bug', max: 2,
      text: r.partnerships
        ? `You and ${c.partnerName ?? 'your partner'} (sitting across from you) are a team. Together you try to win {books|book}: one book = one round where everyone plays a card. First team to ${r.targetScore} points wins.`
        : `Every player for themselves. Try to win {books|book}: one book = one round where everyone plays a card. First to ${r.targetScore} points wins.`,
      when: (x) => x.st.phase === 'bidding' || x.st.phase === 'playing',
    },
    {
      id: 'books', title: 'First hand: no bidding', anchor: '.scorebug .bug', max: 2,
      text: 'This first hand skips the {bid}: just win as many {books|book} as you can. Each one is worth 10 points. From hand 2, you guess your books before playing.',
      when: (x) => booksHand(x.st) && x.st.phase === 'playing',
    },
    {
      id: 'hand', title: 'Your hand', anchor: 'hand', max: 1,
      text: `These are your cards, sorted by {suit} (♥ ♦ ♣ ♠). ${rankLine}${handPoint ? ` ${handPoint}` : ''}`,
      marks: handMark ? { hand: [{ card: handMark, tag: bestIsTop ? 'CAN\'T LOSE' : isTrump(handMark, r) ? 'TRUMP' : 'TOP', kind: 'strong' }] } : undefined,
      when: (x) => !!x.hand && x.hand.length > 0 && (x.st.phase === 'bidding' || x.st.phase === 'playing'),
    },
    {
      id: 'trumps', title: 'Spades beat everything', anchor: '.trump-strip, .bug-trumps', max: 2,
      text: `Any spade ♠ beats any heart, diamond or club (spades are the {trumps|trump}).${tw.extra ? ` ${tw.extra}` : ''} Strongest first: ${top}…`,
      marks: myTrumps.length ? { hand: myTrumps.slice(0, 4).map((x) => ({ card: x, tag: 'TRUMP', kind: 'trump' as const })) } : undefined,
      when: (x) => x.st.phase === 'bidding' || x.st.phase === 'playing',
    },
    {
      id: 'bid', title: 'Time to bid', anchor: '.bid-panel',
      text: `Guess how many {books|book} you'll win this hand: that's your {bid}. The coach below counts your strong cards for you.${r.nil.allowed ? ` {Nil|nil} = you bet you'll win none (±${r.nil.value}).` : ''}`,
      when: (x) => x.myTurn && x.st.phase === 'bidding' && !!x.view.bidOptions && !!x.hand,
    },
    {
      id: 'blind', title: 'Blind Nil?', anchor: '.bid-panel', max: 2,
      text: `Blind {Nil|nil} = bet you'll win zero {books|book} before you even look at your cards (±${r.blindNil.value}). Very risky: most players just tap "See my cards".`,
      when: (x) => x.myTurn && x.st.phase === 'bidding' && !!x.view.bidOptions?.blindNil && !x.hand,
    },
    {
      id: 'partnerBid', title: 'Your partner bid', anchor: '.bid-panel', max: 2,
      text: `${c.partnerName ?? 'Your partner'} bid ${typeof pBid === 'number' ? pBid : '—'}. Your {bid} plus theirs is the team's goal, and a hand only has ${n} {books|book}.`,
      when: (x) => x.myTurn && x.st.phase === 'bidding' && !!x.hand && r.partnerships && typeof x.st.bids[(x.me + 2) % 4] === 'number',
    },
    {
      id: 'follow', title: 'Follow suit', anchor: 'hand',
      text: led ? `${name(lead!.seat)} {led|lead} ${ledWords} (marked LED). You have ${ledPlural}, so you must play one: they're lifted in your hand. The {highest|high} one wins unless someone plays a spade (a {trump}).` : '',
      marks: led ? { trick: ledMark, hand: hand.filter((x) => effectiveSuit(x, r) === ledSuit).map((x) => ({ card: x, tag: SUIT_SYM[ledSuit!], kind: 'match' as const })) } : undefined,
      when: () => playing && !!led && holdsLed && c.legal.length < (c.hand?.length ?? 0),
    },
    {
      id: 'cut', title: "Can't follow? Cut!", anchor: 'hand',
      text: led ? `${ledWords} was {led|lead} and you have no ${ledPlural}. Play ${tw.one} (gold marks) to win the book (that's {cutting|cut}), or throw away a low card (grey marks).` : '',
      marks: led ? { trick: ledMark, hand: [...myTrumps.filter((x) => c.legal.includes(x)).map((x) => ({ card: x, tag: 'TRUMP', kind: 'trump' as const })), ...throwaways.map((x) => ({ card: x, tag: 'THROW', kind: 'throw' as const }))] } : undefined,
      when: () => playing && !!led && !holdsLed && holdsTrump,
    },
    {
      id: 'broken', title: 'Spades not broken', anchor: 'hand',
      text: `You can't {lead} with ${tw.one} until someone has played one on another suit (that's {'breaking' spades|broken}). Lead a different suit for now: your allowed cards are lifted.`,
      marks: { hand: c.legal.filter((x) => !isTrump(x, r)).slice(0, 4).map((x) => ({ card: x, tag: 'OK', kind: 'match' as const })) },
      when: () => playing && !led && r.spadesMustBeBroken && !c.st.spadesBroken && holdsTrump && c.legal.some((x) => !isTrump(x, r)) && c.legal.every((x) => !isTrump(x, r)),
    },
    {
      id: 'win', title: 'Who won that book', anchor: 'trick', max: 2,
      text: lastWin !== null ? `${name(lastWin)} won that {book}: ${whyWon}. The winner plays first next time.` : '',
      marks: lastWinCard ? { trick: [{ card: lastWinCard, tag: 'WON', kind: 'won' }] } : undefined,
      when: (x) => x.pause && x.st.tricks.length >= 1 && lastWin !== null,
    },
    {
      id: 'bags', title: 'Bags', anchor: '.scorebug .bug',
      text: `Every {book} you win over your bid is a {bag|bags}: +1 point now, but every ${r.bagsPerPenalty} bags cost ${Math.abs(r.bagPenalty)}. Already made your bid? Play low cards to stop winning.`,
      when: (x) => !books && x.st.phase === 'playing' && x.st.tricks.length >= 4 && !x.pause,
    },
    {
      id: 'score', title: 'Scoring', anchor: '.modal',
      text: books
        ? 'First hand: 10 points per {book}. From now on you {bid} first, and the bid coach helps you count.'
        : `Made your {bid}: 10 points per book you bid, +1 per extra. Fell short ({set}): minus 10 per book you bid.${r.nil.allowed ? ` {Nil|nil} made: +${r.nil.value}, missed: −${r.nil.value}.` : ''}`,
      when: (x) => x.st.phase === 'handOver' && !x.pause,
    },
    {
      id: 'basics', title: 'Card basics', anchor: '.scorebug .bug', basics: true, max: 0,
      text: TERM_ORDER.map((k) => `${g[k].term}: ${g[k].def}`).join(' '),
      when: () => false,
    },
  ];
}

/** Tip text with tappable terms (underlined; tap = quick definition) and red ♥ ♦ symbols. */
export function TipText({ text, rules, open, onOpen }: { text: string; rules: GameState['rules']; open: TermKey | null; onOpen: (k: TermKey | null) => void }) {
  const g = glossary(rules);
  const colour = (s: string, k: string) => s.split(/([♥♦])/).map((x, i) => (x === '♥' || x === '♦' ? <span key={`${k}-${i}`} className="suit-red">{x}</span> : x));
  return (
    <>
      <p>
        {parseTerms(text).map((part, i) => typeof part === 'string'
          ? colour(part, String(i))
          : <button key={i} type="button" className={`term ${open === part.key ? 'on' : ''}`} data-term={part.key} onClick={(e) => { e.stopPropagation(); onOpen(open === part.key ? null : part.key); }}>{part.text}</button>)}
      </p>
      {open && <p className="term-def" data-testid="term-def" onClick={(e) => e.stopPropagation()}><b>{g[open].term}:</b> {colour(g[open].def, 'd')}</p>}
    </>
  );
}

/** The "?" help's Card basics: every definition, worded for this table. */
function Basics({ rules }: { rules: GameState['rules'] }) {
  const g = glossary(rules);
  return (
    <dl className="basics" data-testid="card-basics" onClick={(e) => e.stopPropagation()}>
      {TERM_ORDER.filter((k) => k !== 'wheels' || rules.partnerships).map((k) => <div key={k}><dt>{g[k].term}</dt><dd>{g[k].def}</dd></div>)}
    </dl>
  );
}

type LRect = { card: string; x: number; y: number; w: number; h: number };
/** Rings + tags over the cards a tip talks about (screen rects published by the 3D scene). */
export function TipMarkLayer({ marks }: { marks: TipMarks | undefined }) {
  const [L, setL] = useState<{ trickCards?: LRect[]; handCards?: LRect[] } | null>(null);
  useEffect(() => {
    if (!marks) return;
    const read = () => setL({ ...((window as unknown as { __bwmLayout?: { trickCards?: LRect[]; handCards?: LRect[] } }).__bwmLayout ?? {}) });
    read();
    const iv = window.setInterval(read, 250);
    return () => clearInterval(iv);
  }, [marks]);
  if (!marks || !L) return null;
  const at = (list: LRect[] | undefined, m: Mark) => list?.find((x) => x.card === m.card);
  return (
    <div className="tip-marks" aria-hidden data-testid="tip-marks">
      {(marks.trick ?? []).map((m) => { const q = at(L.trickCards, m); return q ? (
        <div key={`t${m.card}`} className={`tip-ring ${m.kind}`} data-mark={`trick:${m.card}:${m.kind}`} style={{ left: q.x - 4, top: q.y - 4, width: q.w + 8, height: q.h + 8 }}><span className="tip-tag">{m.tag}</span></div>
      ) : null; })}
      {(marks.hand ?? []).map((m) => {
        const q = at(L.handCards, m);
        if (!q) return null;
        // fanned cards overlap: a word tag only where this card's visible strip is wide enough, else a coloured pip
        const xs = (L.handCards ?? []).map((x) => x.x).sort((a, b) => a - b);
        const next = xs.find((x) => x > q.x + 0.5);
        const strip = next !== undefined ? next - q.x : q.w;
        const tight = strip < 50;
        return <span key={`h${m.card}`} className={`tip-tag hand ${m.kind} ${tight ? 'pip' : ''}`} data-mark={`hand:${m.card}:${m.kind}`} title={m.tag} style={{ left: q.x + (tight ? Math.max(4, strip / 2 - 7) : Math.min(10, q.w * 0.12)), top: q.y - (tight ? 9 : 12) }}>{tight ? '' : m.tag}</span>;
      })}
    </div>
  );
}

/** While tips are on: a quiet "♥ HEARTS LED" chip next to the trick, so the suit to follow is always clear. */
export function LedSuitChip({ st }: { st: GameState }) {
  const led = st.trick.plays[0]?.card;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!led) return;
    const read = () => {
      const L = (window as unknown as { __bwmLayout?: { trickCards?: LRect[] } }).__bwmLayout;
      const rs = L?.trickCards ?? [];
      if (!rs.length) { setPos(null); return; }
      const x0 = Math.min(...rs.map((q) => q.x)), x1 = Math.max(...rs.map((q) => q.x + q.w)), y0 = Math.min(...rs.map((q) => q.y));
      setPos({ x: (x0 + x1) / 2, y: y0 });
    };
    read();
    const iv = window.setInterval(read, 300);
    return () => clearInterval(iv);
  }, [led]);
  if (!led || st.phase !== 'playing' || !pos) return null;
  const s = effectiveSuit(led, st.rules);
  return <div className={`led-chip ${s === 'H' || s === 'D' ? 'red' : ''}`} data-testid="led-chip" style={{ left: pos.x, top: Math.max(60, pos.y - 30) }}>{SUIT_SYM[s]} {SUIT_NAME[s].toUpperCase()} LED</div>;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where a bubble goes: next to its anchor, but never over the name plates, the bid panel/coach or the scorebug —
 * tries below/above the anchor, sliding sideways, and keeps the spot with the least overlap.
 */
export function placeBubble(anchor: Rect, bw: number, bh: number, W: number, H: number, obstacles: Rect[]): { left: number; top: number; below: boolean } {
  const preferBelow = anchor.y + anchor.h / 2 < H / 2;
  const cx = anchor.x + anchor.w / 2;
  const clampX = (x: number) => Math.min(W - bw - 8, Math.max(8, x));
  const clampY = (y: number) => Math.min(H - bh - 8, Math.max(8, y));
  const tries: { left: number; top: number; below: boolean }[] = [];
  for (const below of preferBelow ? [true, false] : [false, true]) {
    const top0 = below ? anchor.y + anchor.h + 12 : anchor.y - bh - 12;
    for (let d = 0; d <= 240; d += 24) for (const dir of d ? [-1, 1] : [1]) for (const dy of [0, below ? 40 : -40, below ? 90 : -90]) {
      tries.push({ left: clampX(cx - bw / 2 + dir * d), top: clampY(top0 + dy), below });
    }
  }
  let best = tries[0]!, bestCost = Infinity;
  for (const t of tries) {
    const box = { x: t.left, y: t.top, w: bw, h: bh };
    const cost = obstacles.reduce((s, o) => s + overlap(box, o), 0) + overlap(box, anchor) * 0.5;
    if (cost < bestCost) { best = t; bestCost = cost; if (cost === 0) break; }
  }
  return best;
}

const OBSTACLES = '.badge-layer .plate, .me-plate, .bid-panel, .bid-coach, .scorebug .bug, .ctl-cluster, .sound-dock';

export function Coach({ ctx, help, onOff, onSkip, onCloseHelp, onOpen, onMarks }: {
  /** the cards the open tip points at (the table glows them too) */
  onMarks?: (cards: Card[]) => void;
  /** a tip bubble is showing (learning mode holds the bots while it is) */
  onOpen?: (open: boolean) => void;
  ctx: CoachCtx;
  /** "?" pressed: show every tip that fits this moment, ignoring the per-tip limits. */
  help: boolean;
  onOff: () => void;
  onSkip: () => void;
  onCloseHelp: () => void;
}) {
  const all = tipsFor(ctx);
  const hand = ctx.st.handNo;
  // tips already shown (or dismissed) this hand: a tip can come back next hand until it hits its limit
  const [seen, setSeen] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [helpIdx, setHelpIdx] = useState(0);
  const seenHand = useRef(hand);
  useEffect(() => { if (seenHand.current !== hand) { seenHand.current = hand; setSeen([]); } }, [hand]);
  useEffect(() => { setHelpIdx(0); }, [help]);
  // "?" help: Card basics first, then the tips that fit this moment (or the core ones)
  const basics = all.find((t) => t.id === 'basics')!;
  const helpList = help ? [basics, ...(all.filter((t) => t.when(ctx)).length ? all.filter((t) => t.when(ctx)) : all.filter((t) => ['goal', 'trumps', 'win', 'bags', 'score'].includes(t.id)))] : [];
  // while your bid panel is up, only bidding tips (shown inside the panel, so nothing covers the plates)
  const bidPanelUp = ctx.myTurn && ctx.st.phase === 'bidding' && !!ctx.view.bidOptions;
  const fits = (t: Tip) => !bidPanelUp || t.anchor === '.bid-panel';
  // A tip belongs to the moment it opened in (whose turn, which book, how many cards are down). As soon as that
  // moment passes (you played / bid, the turn moved on, the book was swept, the hand ended) it closes, counted as seen.
  const st = ctx.st;
  const moment = `${hand}|${ctx.hand ? 1 : 0}|${st.phase}|${st.tricks.length}|${st.trick.plays.length}|${st.turn}|${st.bids.filter((b) => b !== null).length}`;
  const openedAt = useRef<string | null>(null);
  const stale = !!current && openedAt.current !== null && openedAt.current !== moment;
  const cur = current && !stale ? all.find((t) => t.id === current) : undefined;
  const auto = (cur && fits(cur) && cur.when(ctx) ? cur : undefined) || all.find((t) => fits(t) && !seen.includes(t.id) && t.id !== (stale ? current : null) && t.when(ctx) && tipCount(t.id) < (t.max ?? TIP_MAX_SHOWS));
  const tip = help ? helpList[helpIdx % Math.max(1, helpList.length)] : auto;
  useLayoutEffect(() => {
    if (stale) { const id = current!; setSeen((xs) => (xs.includes(id) ? xs : [...xs, id])); }
    if (help || !auto) { if (stale) { setCurrent(null); openedAt.current = null; } return; }
    if (auto.id === current && !stale) return;
    setCurrent(auto.id);
    openedAt.current = moment;
    bumpTip(auto.id);
  }, [auto, current, help, stale, moment]);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrowX: number; below: boolean; width?: number } | null>(null);
  const [slot, setSlot] = useState<Element | null>(null);
  const tipId = tip?.id;
  const [term, setTerm] = useState<TermKey | null>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => { setHover(false); }, [tipId]);
  useEffect(() => { setTerm(null); }, [tipId]);
  const markKey = tip?.marks ? JSON.stringify(tip.marks) : '';
  useEffect(() => { onMarks?.(tip?.marks ? [...(tip.marks.trick ?? []), ...(tip.marks.hand ?? [])].map((m) => m.card) : []); }, [markKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onMarks?.([]), []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!tipId || !tip) { setPos(null); return; }
    let raf = 0;
    const place = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const L = (window as unknown as { __bwmLayout?: { trick: Rect[]; hand: Rect[] } }).__bwmLayout;
      let a: Rect | null = null;
      if (tip.anchor === 'hand' || tip.anchor === 'trick') {
        const rs = (tip.anchor === 'hand' ? L?.hand : L?.trick) ?? [];
        if (rs.length) { const x0 = Math.min(...rs.map((q) => q.x)), y0 = Math.min(...rs.map((q) => q.y)); a = { x: x0, y: y0, w: Math.max(...rs.map((q) => q.x + q.w)) - x0, h: Math.max(...rs.map((q) => q.y + q.h)) - y0 }; }
      } else {
        const el = [...document.querySelectorAll(tip.anchor)].find((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed');
        if (el) { const q = el.getBoundingClientRect(); a = { x: q.left, y: q.top, w: q.width, h: q.height }; }
      }
      const b = bubble.current;
      const bw = b?.offsetWidth ?? 280, bh = b?.offsetHeight ?? 120;
      if (!a) a = { x: W / 2, y: H / 2, w: 0, h: 0 };
      const anchorEl = tip.anchor === 'hand' || tip.anchor === 'trick' ? null : tip.anchor;
      const obstacles = [...document.querySelectorAll(OBSTACLES)]
        .filter((e) => !(anchorEl && e.matches(anchorEl)) && !e.closest('.coach'))
        .map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0)
        .map((q) => ({ x: q.left - 4, y: q.top - 4, w: q.width + 8, h: q.height + 8 }))
        .concat(tip.anchor === 'hand' ? [] : (L?.hand ?? []));
      // no room? try a narrower bubble before accepting any overlap
      let best: { p: ReturnType<typeof placeBubble>; w: number; cost: number } | null = null;
      for (const w of [bw, Math.min(bw, 250), Math.min(bw, 210)]) {
        const h = Math.round((bh * bw) / w);
        const p = placeBubble(a, w, h, W, H, obstacles);
        const box = { x: p.left, y: p.top, w, h };
        const cost = obstacles.reduce((s, o) => s + overlap(box, o), 0);
        if (!best || cost < best.cost - 1) best = { p, w, cost };
        if (cost === 0) break;
      }
      const cx = a.x + a.w / 2;
      setPos({ ...best!.p, width: best!.w, arrowX: Math.min(best!.w - 18, Math.max(18, cx - best!.p.left)) });
    };
    raf = requestAnimationFrame(() => { raf = requestAnimationFrame(place); });
    return () => cancelAnimationFrame(raf);
  }, [tipId, help, helpIdx, term]); // eslint-disable-line react-hooks/exhaustive-deps

  // bidding tips sit inside the bid panel (its .bid-tip-slot) instead of floating over the table
  const wantInline = !!tip && tip.anchor === '.bid-panel' && bidPanelUp;
  useEffect(() => { onOpen?.(!!tip); }, [!!tip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onOpen?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { setSlot(wantInline ? document.querySelector('.bid-tip-slot') : null); }, [wantInline, tipId]);
  if (!tip) return null;
  const dismiss = () => {
    if (help) { if (helpIdx + 1 >= helpList.length) onCloseHelp(); else setHelpIdx(helpIdx + 1); return; }
    setSeen((s) => [...s, tip.id]); setCurrent(null);
  };
  const inline = wantInline && slot;
  const bar = !help && !tip.basics ? <AutoDismiss key={`${tip.id}-${hand}`} ms={tipDurationMs(tip.text)} paused={hover || !!term} onDone={dismiss} /> : null;
  const body = (
    <div
      ref={bubble}
      className={inline ? 'coach inline' : `coach glass slant ${pos?.below ? 'below' : 'above'}`}
      role="dialog" aria-label={`Tip: ${tip.title}`} data-testid="coach" data-tip={tip.id} data-help={help ? 'true' : 'false'}
      style={inline ? undefined : { left: pos?.left ?? -999, top: pos?.top ?? -999, width: pos?.width, ['--ax' as string]: `${pos?.arrowX ?? 40}px` }}
      onClick={dismiss}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(false); }}
      onTouchStart={() => setHover(true)}
      onTouchEnd={() => setHover(false)}
      onTouchCancel={() => setHover(false)}
    >
      <div className="coach-title"><span className="coach-badge">{help ? `TIP ${helpIdx + 1}/${helpList.length}` : 'TIP'}</span>{tip.title}</div>
      {tip.basics ? <Basics rules={ctx.st.rules} /> : <TipText text={tip.text} rules={ctx.st.rules} open={term} onOpen={setTerm} />}
      <div className="coach-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="coach-ok" data-testid="coach-ok" onClick={dismiss}>{help ? (helpIdx + 1 < helpList.length ? 'Next' : 'Done') : 'OK'}</button>
        {!help && <button type="button" className="link" data-testid="coach-skip" onClick={onSkip}>Not now</button>}
        {!help && <button type="button" className="link" data-testid="coach-never" onClick={onOff}>I've got it — tips off</button>}
        {help && <button type="button" className="link" onClick={onCloseHelp}>Close</button>}
      </div>
      {bar}
    </div>
  );
  const marks = <TipMarkLayer marks={tip.marks} />;
  return <>{inline ? createPortal(body, slot) : body}{marks}</>;
}

/** Thin draining bar along the tip's bottom edge; calls onDone when it runs out (paused while `paused`). */
function AutoDismiss({ ms, paused, onDone }: { ms: number; paused: boolean; onDone: () => void }) {
  const [left, setLeft] = useState(ms);
  const done = useRef(onDone);
  done.current = onDone;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    let last = performance.now();
    let rem = ms;
    const iv = window.setInterval(() => {
      const now = performance.now();
      if (!pausedRef.current && document.visibilityState === 'visible') rem -= now - last;
      last = now;
      setLeft(Math.max(0, rem));
      if (rem <= 0) { clearInterval(iv); done.current(); }
    }, 100);
    return () => clearInterval(iv);
  }, [ms]);
  return (
    <div className={`coach-timer ${paused ? 'paused' : ''}`} aria-hidden data-testid="coach-timer" data-ms={Math.round(left)}>
      <i style={{ transform: `scaleX(${left / ms})` }} />
    </div>
  );
}
