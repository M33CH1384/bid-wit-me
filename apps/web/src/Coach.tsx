import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Card, type GameState, type PlayerView, booksHand, cardLabel, effectiveSuit, isTrump, trumpOrder } from '@spades/rules';
import { TIP_MAX_SHOWS, bumpTip, tipCount } from './tips';

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
}
interface Tip { id: string; title: string; text: string; anchor: string | 'hand' | 'trick'; when: (c: CoachCtx) => boolean; max?: number }

const label = (c: Card) => cardLabel(c);

export function tipsFor(c: CoachCtx): Tip[] {
  const r = c.st.rules;
  const order = trumpOrder(r).slice(0, 5).map(label).join(' › ');
  const led = c.st.trick.plays[0]?.card;
  const ledSuit = led ? effectiveSuit(led, r) : null;
  const holdsLed = !!c.hand && !!ledSuit && c.hand.some((x) => effectiveSuit(x, r) === ledSuit);
  const holdsTrump = !!c.hand && c.hand.some((x) => isTrump(x, r));
  const playing = c.myTurn && c.st.phase === 'playing' && !c.pause;
  const books = booksHand(c.st);
  return [
    {
      id: 'goal', title: 'The goal', anchor: '.scorebug .bug', max: 2,
      text: r.partnerships
        ? `You and ${c.partnerName ?? 'your partner'} (across from you) are a team. Each hand you bid how many books (tricks) you'll take together — then make it. First to ${r.targetScore} wins.`
        : `Cutthroat: every player for themselves. Bid how many books (tricks) you'll take, then make it. First to ${r.targetScore} wins.`,
      when: (x) => x.st.phase === 'bidding' || x.st.phase === 'playing',
    },
    {
      id: 'books', title: 'First hand: no bidding', anchor: '.scorebug .bug', max: 2,
      text: 'The first hand bids itself: just take as many books as you can. Every book is worth 10 — no bags, no penalties. Watch which cards win; you\'ll bid from hand 2.',
      when: (x) => booksHand(x.st) && x.st.phase === 'playing',
    },
    {
      id: 'hand', title: 'Your hand', anchor: 'hand', max: 1,
      text: 'These are your cards, grouped by suit. High cards and trumps are what win books.',
      when: (x) => !!x.hand && x.hand.length > 0 && (x.st.phase === 'bidding' || x.st.phase === 'playing'),
    },
    {
      id: 'trumps', title: 'Trumps', anchor: '.trump-strip, .bug-trumps', max: 2,
      text: r.mode === 'joker'
        ? `Spades are trumps, led by the jokers: ${order}… A trump beats any other suit.`
        : r.mode === 'aceDown'
          ? `Standard deck, aces high. Spades are trumps: ${order}… A trump beats any other suit.`
          : `Every player for themselves. Trumps: ${order}… A trump beats any other suit.`,
      when: (x) => x.st.phase === 'bidding' || x.st.phase === 'playing',
    },
    {
      id: 'bid', title: 'Time to bid', anchor: '.bid-panel',
      text: `Count your books — the coach below adds up your winners and suggests a range.${r.nil.allowed ? ` Nil = take zero (±${r.nil.value}).` : ''}`,
      when: (x) => x.myTurn && x.st.phase === 'bidding' && !!x.view.bidOptions && !!x.hand,
    },
    {
      id: 'blind', title: 'Blind Nil?', anchor: '.bid-panel', max: 2,
      text: `Blind Nil = Nil without looking (±${r.blindNil.value}). Risky — usually just see your cards.`,
      when: (x) => x.myTurn && x.st.phase === 'bidding' && !!x.view.bidOptions?.blindNil && !x.hand,
    },
    {
      id: 'partnerBid', title: 'Partner bid first', anchor: '.bid-panel', max: 2,
      text: 'Your bid + your partner\'s = the team contract. Keep the total within 13.',
      when: (x) => x.myTurn && x.st.phase === 'bidding' && !!x.hand && r.partnerships && typeof x.st.bids[(x.me + 2) % 4] === 'number',
    },
    {
      id: 'follow', title: 'Follow suit', anchor: 'hand',
      text: 'You have to play the suit that was led if you can. Your playable cards are lifted and glowing.',
      when: () => playing && !!led && holdsLed && c.legal.length < (c.hand?.length ?? 0),
    },
    {
      id: 'cut', title: "Can't follow? Cut!", anchor: 'hand',
      text: "You're out of the suit that was led — play a trump to cut and steal the book, or throw away a low card.",
      when: () => playing && !!led && !holdsLed && holdsTrump,
    },
    {
      id: 'broken', title: 'Spades not broken', anchor: 'hand',
      text: "You can't lead a trump until someone has cut with one (spades are \"broken\"). Lead another suit for now.",
      when: () => playing && !led && r.spadesMustBeBroken && !c.st.spadesBroken && holdsTrump && c.legal.some((x) => !isTrump(x, r)) && c.legal.every((x) => !isTrump(x, r)),
    },
    {
      id: 'win', title: 'Who wins a book', anchor: 'trick', max: 2,
      text: 'Highest card of the suit led wins — unless someone trumped: then the highest trump takes it. The winner leads next.',
      when: (x) => x.pause && x.st.tricks.length >= 1,
    },
    {
      id: 'bags', title: 'Bags', anchor: '.scorebug .bug',
      text: `Every book over your bid is a bag: +1 point now, but ${r.bagsPerPenalty} bags cost you ${r.bagPenalty}. Made your bid already? Duck under!`,
      when: (x) => !books && x.st.phase === 'playing' && x.st.tricks.length >= 4 && !x.pause,
    },
    {
      id: 'score', title: 'Scoring', anchor: '.modal',
      text: books
        ? 'First hand: 10 points per book, nothing else. From now on you bid — and the bid coach helps you count.'
        : `Made your bid: 10 × bid, +1 per bag. Missed it: −10 × bid. ${r.nil.allowed ? `Nil made: +${r.nil.value}, busted: −${r.nil.value}.` : ''}`,
      when: (x) => x.st.phase === 'handOver' && !x.pause,
    },
  ];
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

export function Coach({ ctx, help, onOff, onSkip, onCloseHelp, onOpen }: {
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
  const helpList = help ? (all.filter((t) => t.when(ctx)).length ? all.filter((t) => t.when(ctx)) : all.filter((t) => ['goal', 'trumps', 'win', 'bags', 'score'].includes(t.id))) : [];
  // while your bid panel is up, only bidding tips (shown inside the panel, so nothing covers the plates)
  const bidPanelUp = ctx.myTurn && ctx.st.phase === 'bidding' && !!ctx.view.bidOptions;
  const fits = (t: Tip) => !bidPanelUp || t.anchor === '.bid-panel';
  const cur = current ? all.find((t) => t.id === current) : undefined;
  const auto = (cur && fits(cur) ? cur : undefined) || all.find((t) => fits(t) && !seen.includes(t.id) && t.when(ctx) && tipCount(t.id) < (t.max ?? TIP_MAX_SHOWS));
  const tip = help ? helpList[helpIdx % Math.max(1, helpList.length)] : auto;
  useLayoutEffect(() => {
    if (help || !auto || auto.id === current) return;
    setCurrent(auto.id);
    bumpTip(auto.id);
  }, [auto, current, help]);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrowX: number; below: boolean; width?: number } | null>(null);
  const [slot, setSlot] = useState<Element | null>(null);
  const tipId = tip?.id;

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
  }, [tipId, help, helpIdx]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const body = (
    <div
      ref={bubble}
      className={inline ? 'coach inline' : `coach glass slant ${pos?.below ? 'below' : 'above'}`}
      role="dialog" aria-label={`Tip: ${tip.title}`} data-testid="coach" data-tip={tip.id} data-help={help ? 'true' : 'false'}
      style={inline ? undefined : { left: pos?.left ?? -999, top: pos?.top ?? -999, width: pos?.width, ['--ax' as string]: `${pos?.arrowX ?? 40}px` }}
      onClick={dismiss}
    >
      <div className="coach-title"><span className="coach-badge">{help ? `TIP ${helpIdx + 1}/${helpList.length}` : 'TIP'}</span>{tip.title}</div>
      <p>{tip.text}</p>
      <div className="coach-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="coach-ok" data-testid="coach-ok" onClick={dismiss}>{help ? (helpIdx + 1 < helpList.length ? 'Next' : 'Done') : 'OK'}</button>
        {!help && <button type="button" className="link" data-testid="coach-skip" onClick={onSkip}>Not now</button>}
        {!help && <button type="button" className="link" data-testid="coach-never" onClick={onOff}>I've got it — tips off</button>}
        {help && <button type="button" className="link" onClick={onCloseHelp}>Close</button>}
      </div>
    </div>
  );
  return inline ? createPortal(body, slot) : body;
}
