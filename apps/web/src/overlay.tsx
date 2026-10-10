import { useEffect, useRef, useState } from 'react';
import { type GameState, type HandRecord, type TableRules, bidLabel } from '@spades/rules';

/** Number that counts up/down to its value (scorebug tick-ups). */
export function TickNumber({ value, className = '' }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<'' | 'up' | 'down'>('');
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    setFlash(value > start ? 'up' : 'down');
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      setShown(Math.round(start + (value - start) * e));
      if (k < 1) raf = requestAnimationFrame(step);
      else { from.current = value; setTimeout(() => setFlash(''), 400); }
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className={`tick ${flash} ${className}`}>{shown}</span>;
}

export interface Toast { id: number; text: string; kind: 'made' | 'set' | 'nil' | 'bust' | 'bags' | 'info'; sub?: string }

/** Toasts for a scored hand: BID MADE / SET / NIL! / NIL BUSTED / BAG PENALTY. */
export function toastsFor(rec: HandRecord, rules: TableRules, names: string[], mySide: number): Omit<Toast, 'id'>[] {
  const out: Omit<Toast, 'id'>[] = [];
  const sideLabel = (side: number) => (rules.partnerships ? (side === mySide ? 'YOUR TEAM' : 'THEM') : side === mySide ? 'YOU' : names[side]!.toUpperCase());
  const ordered = [...rec.sides].sort((a, b) => (a.side === mySide ? -1 : b.side === mySide ? 1 : 0));
  for (const s of ordered) {
    for (const nl of s.nils) {
      const who = nl.seat === 0 ? 'YOU' : names[nl.seat]!.toUpperCase();
      out.push(nl.made ? { text: nl.kind === 'blindNil' ? 'BLIND NIL!' : 'NIL!', kind: 'nil', sub: `${who} +${nl.points}` } : { text: 'NIL BUSTED', kind: 'bust', sub: `${who} ${nl.points}` });
    }
    if (s.bookPoints) out.push({ text: s.side === mySide ? 'BOOKS BANKED' : 'BOOKS', kind: s.side === mySide ? 'made' : 'info', sub: `${sideLabel(s.side)} ${s.tricks} books · +${s.bookPoints}` });
    if (s.contractMade === true) out.push({ text: 'BID MADE', kind: 'made', sub: `${sideLabel(s.side)} ${s.contract}/${s.contractTricks} · +${s.contractPoints}` });
    if (s.contractMade === false) out.push({ text: 'SET!', kind: 'set', sub: `${sideLabel(s.side)} ${s.contractTricks}/${s.contract} · ${s.contractPoints}` });
    if (s.bagPenaltyCount) out.push({ text: 'BAG PENALTY', kind: 'bags', sub: `${sideLabel(s.side)} ${s.bagPenaltyPoints}` });
  }
  return out.slice(0, 4);
}

/* ------------------------------------------------------------------ chat */

export interface ChatMsg { id: number; user: string; color: string; text: string; system?: boolean; badge?: string; /** a bot's trash talk (raw text; masked per Clean talk when shown, hidden with 'Hide bot trash talk') */ bot?: boolean }

export const USER_COLORS: Record<string, string> = { You: '#f5c542', System: '#b892ff' };
/** plate / chat colour by local seat (0 = you); bot names are random, so colours follow the seat */
export const SEAT_COLORS = ['#f5c542', '#4fd1ff', '#ff6ad5', '#7dff9b'];

const LINES = {
  set: ['nice set 😤', 'SET THEM 🔥', 'they got greedy lol', 'books don\'t lie 📚', 'ouch 💀'],
  setOnUs: ['my bad partner 😩', 'we gotta tighten up', 'that hurt 💀', 'ugh'],
  nil: ['NIL!! 🔥🔥', 'clean nil 👀', 'ice cold 🧊', 'respect'],
  bust: ['nil busted 😂', "caught 'em 🎣", 'gotcha'],
  bigJoker: ['big joker don\'t lie 🃏', 'BIG JOKER 👑', 'that\'s the boss card'],
  cut: ['cut! ✂️', 'spades broke 👀', 'here we go'],
  start: ['glhf', 'let\'s gooo', 'shuffle up 🃏', 'deal em'],
  gg: ['gg', 'gg wp', 'good game 🤝', 'rematch? 😤'],
  bidBig: ['big bid 😳', 'confident huh', 'ok ok I see you'],
};

export function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}
export { LINES };

export function bidLine(name: string, bid: Parameters<typeof bidLabel>[0]): string {
  return `${name} bid ${bidLabel(bid)}`;
}

export function stateSummary(st: GameState): string {
  return `${st.phase}:${st.handNo}:${st.tricks.length}:${st.trick.plays.length}`;
}

/** Between-hands banter (offline Table Talk). */
export const TALK_LINES = {
  won: ['too easy 😮‍💨', 'run it back', "that's how we do it", 'keep that same energy 🔥', 'cards love me today'],
  lost: ['we coming back 😤', 'lucky deal', 'nah this next one ours', 'okay okay…', 'shuffle better 😭'],
  even: ['tight game', 'anybody\'s game', 'locked in 🔒'],
  replies: {
    gg: ['gg', 'gg 🤝', 'not over yet 😏'],
    'run it back': ['say less', 'deal em 🃏', 'bet'],
    'too easy': ['talk is cheap 😤', 'we\'ll see', 'lol relax'],
    '🔥': ['🔥🔥', 'heating up 🌶️', 'cooking'],
    '😭': ['😂😂', 'it\'s ok bro', 'pain'],
  } as Record<string, string[]>,
};
