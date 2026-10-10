import { useLayoutEffect, useRef, useState } from 'react';
import { type Card, type GameState, type PlayerView, cardLabel, effectiveSuit, isTrump, trumpOrder } from '@spades/rules';
import { saveTips } from './tips';

/**
 * "Learn as you play": context-triggered coach marks during the first hand (only for the player who turned tips on —
 * online too, it's all local). One tip at a time, each pointing at the UI it explains; tap to dismiss.
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
interface Tip { id: string; title: string; text: string; anchor: string | 'hand' | 'trick'; when: (c: CoachCtx) => boolean }

const label = (c: Card) => (c === 'BJ' ? 'Big Joker' : c === 'LJ' ? 'Little Joker' : cardLabel(c));

function tipsFor(c: CoachCtx): Tip[] {
  const r = c.st.rules;
  const order = trumpOrder(r).slice(0, 5).map(label).join(' › ');
  const led = c.st.trick.plays[0]?.card;
  const ledSuit = led ? effectiveSuit(led, r) : null;
  const holdsLed = !!c.hand && !!ledSuit && c.hand.some((x) => effectiveSuit(x, r) === ledSuit);
  const holdsTrump = !!c.hand && c.hand.some((x) => isTrump(x, r));
  const playing = c.myTurn && c.st.phase === 'playing' && !c.pause;
  return [
    {
      id: 'goal', title: 'The goal', anchor: '.scorebug .bug',
      text: r.partnerships
        ? `You and ${c.partnerName ?? 'your partner'} (across from you) are a team. Bid how many tricks you'll take together — then make it. First to ${r.targetScore} wins.`
        : `Cutthroat: every player for themselves. Bid how many tricks you'll take, then make it. First to ${r.targetScore} wins.`,
      when: (x) => x.st.phase === 'bidding' || x.st.phase === 'playing',
    },
    {
      id: 'hand', title: 'Your hand', anchor: 'hand',
      text: 'These are your cards, grouped by suit. High cards and trumps are what win tricks.',
      when: (x) => !!x.hand && x.hand.length > 0 && (x.st.phase === 'bidding' || x.st.phase === 'playing'),
    },
    {
      id: 'trumps', title: 'Trumps', anchor: '.trump-strip, .bug-trumps',
      text: r.mode === 'joker'
        ? `Spades are trumps, led by the jokers: ${order}… A trump beats any other suit.`
        : r.mode === 'aceDown'
          ? `Standard deck, aces high. Spades are trumps: ${order}… A trump beats any other suit.`
          : `Every player for themselves. Trumps: ${order}… A trump beats any other suit.`,
      when: (x) => x.st.phase === 'bidding' || x.st.phase === 'playing',
    },
    {
      id: 'bid', title: 'Your bid', anchor: '.bid-panel',
      text: `Count the tricks you'll likely win: big trumps, aces, kings with backup. ${r.nil.allowed ? `Nil = you bet on taking zero (±${r.nil.value}).` : ''} ${r.blindNil.allowed ? `Blind Nil = Nil before looking (±${r.blindNil.value}).` : ''}`.trim(),
      when: (x) => x.myTurn && x.st.phase === 'bidding' && !!x.view.bidOptions,
    },
    {
      id: 'follow', title: 'Follow suit', anchor: 'hand',
      text: 'You have to play the suit that was led if you can. Your playable cards are lifted and glowing.',
      when: () => playing && !!led && holdsLed && c.legal.length < (c.hand?.length ?? 0),
    },
    {
      id: 'cut', title: "Can't follow? Cut!", anchor: 'hand',
      text: "You're out of the suit that was led — play a trump to cut and steal the trick, or throw away a low card.",
      when: () => playing && !!led && !holdsLed && holdsTrump,
    },
    {
      id: 'broken', title: 'Spades not broken', anchor: 'hand',
      text: "You can't lead a trump until someone has cut with one (spades are \"broken\"). Lead another suit for now.",
      when: () => playing && !led && r.spadesMustBeBroken && !c.st.spadesBroken && holdsTrump && c.legal.some((x) => !isTrump(x, r)) && c.legal.every((x) => !isTrump(x, r)),
    },
    {
      id: 'win', title: 'Who wins a trick', anchor: 'trick',
      text: 'Highest card of the suit led wins — unless someone trumped: then the highest trump takes it. The winner leads next.',
      when: (x) => x.pause && x.st.tricks.length >= 1,
    },
    {
      id: 'bags', title: 'Bags', anchor: '.scorebug .bug',
      text: `Every trick over your bid is a bag: +1 point now, but ${r.bagsPerPenalty} bags cost you ${r.bagPenalty}. Don't overshoot!`,
      when: (x) => x.st.phase === 'playing' && x.st.tricks.length >= 4 && !x.pause,
    },
    {
      id: 'score', title: 'Scoring', anchor: '.modal',
      text: `Made your bid: 10 × bid, +1 per bag. Missed it: −10 × bid. ${r.nil.allowed ? `Nil made: +${r.nil.value}, busted: −${r.nil.value}.` : ''} That's it — tips end here. Have fun!`,
      when: (x) => x.st.phase === 'handOver' && !x.pause,
    },
  ];
}

export function Coach({ ctx, onSkip }: { ctx: CoachCtx; onSkip: () => void }) {
  const [seen, setSeen] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const all = tipsFor(ctx);
  // a tip that has appeared stays until it's dismissed (even if the moment that triggered it has passed)
  const tip = (current && all.find((t) => t.id === current)) || all.find((t) => !seen.includes(t.id) && t.when(ctx));
  useLayoutEffect(() => { if (tip && tip.id !== current) setCurrent(tip.id); }, [tip, current]);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrowX: number; below: boolean } | null>(null);
  const tipId = tip?.id;

  useLayoutEffect(() => {
    if (!tipId || !tip) { setPos(null); return; }
    let raf = 0;
    const place = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const L = (window as unknown as { __bwmLayout?: { trick: Rect[]; hand: Rect[] } }).__bwmLayout;
      let a: { x: number; y: number; w: number; h: number } | null = null;
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
      const cx = a.x + a.w / 2;
      const left = Math.min(W - bw - 8, Math.max(8, cx - bw / 2));
      // prefer below the anchor if it's in the top half, else above
      const below = a.y + a.h / 2 < H / 2;
      let top = below ? a.y + a.h + 12 : a.y - bh - 12;
      top = Math.min(H - bh - 8, Math.max(8, top));
      setPos({ left, top, arrowX: Math.min(bw - 18, Math.max(18, cx - left)), below });
    };
    raf = requestAnimationFrame(() => { raf = requestAnimationFrame(place); });
    return () => cancelAnimationFrame(raf);
  }, [tipId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tip) return null;
  const dismiss = () => { setSeen((s) => [...s, tip.id]); setCurrent(null); };
  return (
    <div
      ref={bubble}
      className={`coach glass slant ${pos?.below ? 'below' : 'above'}`}
      role="dialog" aria-label={`Tip: ${tip.title}`} data-testid="coach" data-tip={tip.id}
      style={{ left: pos?.left ?? -999, top: pos?.top ?? -999, ['--ax' as string]: `${pos?.arrowX ?? 40}px` }}
      onClick={dismiss}
    >
      <div className="coach-title"><span className="coach-badge">TIP</span>{tip.title}</div>
      <p>{tip.text}</p>
      <div className="coach-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="coach-ok" data-testid="coach-ok" onClick={dismiss}>Got it</button>
        <button type="button" className="link" data-testid="coach-skip" onClick={onSkip}>Skip tips</button>
        <button type="button" className="link" data-testid="coach-never" onClick={() => { saveTips({ on: false, asked: true }); onSkip(); }}>Don't show again</button>
      </div>
    </div>
  );
}
type Rect = { x: number; y: number; w: number; h: number };
