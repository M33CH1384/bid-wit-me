import { type FormEvent, type ReactNode, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type Card, type GameState, type TableRules, bidLabel, booksHand, cardLabel, isJoker, isNilBid, isTrump, partnerOf, sideOf, sortHand, trumpOrder,
} from '@spades/rules';
import { ScorePad, sideName } from './Modals';
import { Intermission, calloutsFor } from './Intermission';
import Hype from './Hype';
import { landCueFor } from './landCue';
import { OfflineMediaBar } from './online/Media';
import { fx, useReduceEffects } from './fx';
import { type Sfx, sound } from './audio';
import { type ChatMsg, LINES, SEAT_COLORS, TALK_LINES, type Toast, TickNumber, USER_COLORS, pick, toastsFor } from './overlay';
import { type Settings, modeTitle } from './settings';
import type { SeatPos } from './three/layout';
import { HUMAN, useGame } from './useGame';
import { type SavedGame, clearGame, saveGame } from './save';

import { useViewport } from './viewport';
import { Coach } from './Coach';
import { type TipsPref, bumpTip, loadTips, saveTips, tipCount } from './tips';
import { BidCoach } from './BidCoach';
import { pickBotNames } from '@spades/bots';
const Scene = lazy(() => import('./three/Scene'));

/**
 * "X TAKES IT": placed just above the trick (measured from the 3D layout), or below it when there's no room —
 * never over the cards. Brief: fades out on its own.
 */
function TrickBanner({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number } | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      const L = (window as unknown as { __bwmLayout?: { trick: { x: number; y: number; w: number; h: number }[]; hand: { x: number; y: number; w: number; h: number }[]; h: number } }).__bwmLayout;
      const el = ref.current;
      if (!L || !L.trick.length || !el) { setPos({ top: window.innerHeight * 0.44 }); return; }
      const top = Math.min(...L.trick.map((t) => t.y)), bottom = Math.max(...L.trick.map((t) => t.y + t.h));
      const bh = el.offsetHeight || 28, bw = el.offsetWidth || 160;
      const x0 = (window.innerWidth - bw) / 2;
      const obstacles = [...document.querySelectorAll('.scorebug > :not(.dock-slot), .trump-strip, .badge-layer .plate, .me-plate, .last-trick, .ctl-cluster, .bid-panel')]
        .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
        .concat((L.hand ?? []).map((c) => ({ left: c.x, right: c.x + c.w, top: c.y, bottom: c.y + c.h }) as DOMRect));
      const free = (y: number) => y >= 0 && y + bh <= window.innerHeight && obstacles.every((r) => r.right <= x0 || r.left >= x0 + bw || r.bottom <= y || r.top >= y + bh);
      // nearest free slot just above the trick, else just below it, else the old centre spot
      for (let d = 0; d < 160; d += 4) {
        if (free(top - bh - 6 - d)) { setPos({ top: top - bh - 6 - d }); return; }
        if (free(bottom + 6 + d)) { setPos({ top: bottom + 6 + d }); return; }
      }
      setPos({ top: top - bh - 6 });
    };
    raf = requestAnimationFrame(() => { raf = requestAnimationFrame(place); });
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="trick-banner-wrap" style={{ top: pos?.top ?? -999, visibility: pos ? 'visible' : 'hidden' }}>
      <div ref={ref} className="center-note win">{text}</div>
    </div>
  );
}

/** Online play: the table renders server state through the same UI (see online/OnlineTable.tsx). */
export interface OnlineBinding {
  /** shape-compatible with useGame()'s result */
  source: ReturnType<typeof useGame> & { locked?: boolean };
  /** local-seat names (0 = you) */
  names: string[];
  chat: { msgs: ChatMsg[]; push: (user: string, text: string) => void };
  /** video bubble / timer chip etc. inside a seat's name plate (local seat index) */
  seatExtra: (seat: number) => ReactNode;
  /** scorebug label for a (local) side */
  sideLabel: (side: number) => string;
  /** Extra buttons for the bottom-right control cluster (camera / mic). */
  controls?: ReactNode;
  /** Table Talk (between hands): countdown, who's ready, and the enlarged video / avatar tile per local seat */
  /** tips on → ask the server for longer turn timers for this player */
  setLearning?: (on: boolean) => void;
  talk?: { secs: number | null; ready: { mine: boolean; count: number; of: number }; tile: (seat: number) => ReactNode };
}

interface Props {
  rules: TableRules;
  seed: string;
  settings: Settings;
  onExit: () => void;
  onRematch: () => void;
  onQuality: (q: Settings['quality']) => void;
  /** A saved in-progress game to resume at exactly the same point. */
  resume?: SavedGame;
  online?: OnlineBinding;
  /** Game over → straight to the splash screen (offline: the finished save is cleared; online: leaves the table). */
  onMainMenu?: () => void;
  /** Offline: back to the menu keeping the save (Resume on the start screen). */
  onSuspend?: () => void;
}

/** Offline bot names: random per game (derived from the game seed), never your own online name; kept in the save. */
function offlineNames(n: number, seed: string): string[] {
  let mine = '';
  try { mine = (localStorage.getItem('bwm.online.name') ?? '').replace(/^"|"$/g, ''); } catch { /* ignore */ }
  return ['You', ...pickBotNames(n - 1, mine ? [mine, 'You'] : ['You'], seed)];
}

function positions(n: number): SeatPos[] {
  return n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'];
}

/* -------------------------------------------------------------- chat feed */
function useChat(st: GameState, names: string[], initial?: ChatMsg[]) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => initial ?? []);
  const prev = useRef<GameState | null>(initial ? st : null);
  const idRef = useRef(initial && initial.length ? Math.max(...initial.map((m) => m.id)) + 1 : 1);
  const timers = useRef<number[]>([]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const push = useCallback((user: string, text: string, system = false, delay = 0) => {
    const add = () => setMsgs((m) => [...m.slice(-60), { id: idRef.current++, user, text, system, color: USER_COLORS[user] ?? SEAT_COLORS[namesRef.current.indexOf(user)] ?? '#ddd' }]);
    if (delay) timers.current.push(window.setTimeout(add, delay));
    else add();
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const bots = names.slice(1);
  const n = names.length;

  useEffect(() => {
    const p = prev.current;
    prev.current = st;
    const r = st.rules;
    if (!p) {
      push('System', `Table open · ${modeTitle(r)} · first to ${r.targetScore}`, true);
      push(pick(bots), pick(LINES.start), false, 900);
      push(pick(bots), pick(['yo', 'what up', '👋', 'ready']), false, 1700);
      return;
    }
    if (st.handNo !== p.handNo) push('System', `Hand ${st.handNo} · ${names[st.dealer]} deals`, true);
    // bids
    st.bids.forEach((b, s) => {
      if (b !== null && p.bids[s] === null && p.handNo === st.handNo) {
        push('System', `${names[s]} bid ${bidLabel(b)}`, true);
        if (typeof b === 'number' && b >= 6 && Math.random() < 0.5) push(pick(bots.filter((x) => x !== names[s])), pick(LINES.bidBig), false, 700);
        if (isNilBid(b) && s !== HUMAN && Math.random() < 0.6) push(names[s]!, pick(['going nil 🤫', 'nil. cover me', 'trust me 😏']), false, 500);
      }
    });
    // tricks
    if (st.tricks.length > p.tricks.length && st.handNo === p.handNo) {
      const t = st.tricks[st.tricks.length - 1]!;
      const winCard = t.plays.find((x) => x.seat === t.winner)!.card;
      const led = t.plays[0]!.card;
      if (winCard === 'BJ' && t.winner !== HUMAN && Math.random() < 0.55) push(names[t.winner!]!, pick(LINES.bigJoker), false, 300);
      else if (!p.spadesBroken && st.spadesBroken && !isTrump(led, r) && Math.random() < 0.45) push(pick(bots), pick(LINES.cut), false, 400);
    }
    // hand scored
    if (st.history.length > p.history.length) {
      const rec = st.history[st.history.length - 1]!;
      push('System', `Hand ${rec.handNo}: ${rec.sides.map((s) => `${sideName(r, s.side, names)} ${s.points >= 0 ? '+' : ''}${s.points}`).join(' · ')}`, true);
      const mySide = sideOf(HUMAN, r);
      for (const s of rec.sides) {
        for (const nl of s.nils) {
          const speaker = pick(bots.filter((x) => x !== names[nl.seat]));
          if (Math.random() < 0.7) push(speaker, pick(nl.made ? LINES.nil : LINES.bust), false, 900);
        }
        if (s.contractMade === false && Math.random() < 0.65) {
          if (s.side === mySide && r.partnerships) push(names[partnerOf(HUMAN, r)!]!, pick(LINES.setOnUs), false, 1200);
          else {
            const others = bots.filter((_, i) => sideOf(i + 1, r) !== s.side);
            push(others.length ? pick(others) : pick(bots), pick(LINES.set), false, 1200);
          }
        }
      }
    }
    if (st.history.length > p.history.length && st.phase === 'handOver') {
      // Table Talk banter between hands
      const rec = st.history[st.history.length - 1]!;
      const top = Math.max(...rec.sides.map((s) => s.points));
      for (const [i, b] of bots.entries()) {
        if (Math.random() < 0.45 && i < 2) continue;
        const side = sideOf(names.indexOf(b), r);
        const pts = rec.sides[side]!.points;
        const pool = rec.sides.every((s) => s.points === top) ? TALK_LINES.even : pts === top ? TALK_LINES.won : TALK_LINES.lost;
        push(b, pick(pool), false, 2200 + i * 1400);
      }
    }
    if (st.phase === 'gameOver' && p.phase !== 'gameOver') {
      push('System', 'Game over', true);
      push(pick(bots), pick(LINES.gg), false, 800);
      push(pick(bots), pick(LINES.gg), false, 1600);
    }
  }, [st, names, bots, n, push]);

  return { msgs, push };
}

function ChatPanel({ msgs, open, onToggle, onSend, unread, scope = 'local only', extra }: { msgs: ChatMsg[]; open: boolean; onToggle: () => void; onSend: (t: string) => void; unread: number; scope?: string; extra?: ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useEffect(() => { listRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [msgs, open]);
  const last = msgs.filter((m) => !m.system).slice(-1)[0];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim().slice(0, 200));
    setText('');
  };
  return (
    <>
      <div className="ctl-cluster" role="group" aria-label="Table controls">
        {extra}
        <button type="button" className={`chat-toggle ${open ? 'open' : ''}`} onClick={onToggle} aria-label="Toggle chat">
          💬{!open && unread > 0 && <span className="unread">{unread}</span>}
        </button>
      </div>
      {!open && last && <div key={last.id} className="chat-ticker"><b style={{ color: last.color }}>{last.user}</b> {last.text}</div>}
      <aside className={`chat glass slant ${open ? 'open' : ''}`} aria-label="Table chat">
        <header><span className="live-dot" /> LIVE CHAT <small>{scope}</small></header>
        <div className="chat-list" ref={listRef}>
          {msgs.map((m) => (
            <div key={m.id} className={`chat-line ${m.system ? 'system' : ''}`}>
              {m.system ? <span>{m.text}</span> : <><b style={{ color: m.color }}>{m.user}</b><span>{m.text}</span></>}
            </div>
          ))}
        </div>
        <form onSubmit={submit} className="chat-input">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={200} aria-label="Chat message" />
          <button type="submit" aria-label="Send">➤</button>
        </form>
        <div className="emotes">
          {['🔥', '😂', '😤', '🃏', 'gg'].map((e) => <button key={e} type="button" onClick={() => onSend(e)}>{e}</button>)}
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ table */
/* -------------------------------------------------------------- sound cues */
function useGameSounds(st: GameState, myTurn: boolean, mySide: number, msgs: ChatMsg[]) {
  const prev = useRef<{ st: GameState; myTurn: boolean; msgs: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = { st, myTurn, msgs: msgs.length };
    // card sounds (shuffle, deal, play/cut/broken, sweep) are fired by the 3D animations themselves — see Scene/Card3D
    if (!p) return;
    st.bids.forEach((b, s) => { if (b !== null && p.st.bids[s] === null && p.st.handNo === st.handNo) sound.play(s === HUMAN ? 'bid' : 'bidSoft'); });
    if (myTurn && !p.myTurn && (st.phase === 'playing' || st.phase === 'bidding')) sound.play('turn', { delay: 0.05 });
    if (msgs.length > p.msgs) { const m = msgs[msgs.length - 1]!; if (!m.system && m.user !== 'You') sound.play('pop'); }
    if (st.phase === 'gameOver' && p.st.phase !== 'gameOver' && st.result) sound.play(st.result.winners.includes(mySide) ? 'win' : 'lose', { delay: 0.3 });
  }, [st, myTurn, mySide, msgs]);
}

export { landCueFor } from './landCue';

export default function Table({ rules: initialRules, seed, settings, onExit, onSuspend, onRematch, onQuality, resume, online, onMainMenu }: Props) {
  // `online` never changes for a mounted Table, so this is always the same hook path per instance
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const vp = useViewport();
  // "Learning mode": while tips are on the game runs at Slow (unless the player already picked Slow / tests use turbo),
  // and an open tip holds the bots + trick sweep until it's dismissed. Tips off → back to the chosen speed.
  const [tips, setTips] = useState<TipsPref>(loadTips);
  const [tipsSkipped, setTipsSkipped] = useState(false);
  const learning = tips.on && !tipsSkipped;
  const [tipOpen, setTipOpen] = useState(false);
  const speed = learning && settings.speed !== 'turbo' ? 'slow' : settings.speed;
  const { st, view, pause, error, apply, introHand, dealing, k } = online ? online.source : useGame(initialRules, seed, settings.botLevel, speed, resume?.state, learning && tipOpen);
  useEffect(() => { online?.setLearning?.(learning); }, [learning]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = st.rules;
  const n = r.playerCount;
  const [botNames] = useState(() => (resume?.names?.length === n ? resume.names : offlineNames(n, seed)));
  const names = online?.names ?? botNames;
  const pos = useMemo(() => positions(n), [n]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [exchangePick, setExchangePick] = useState<Card[]>([]);
  const [showPad, setShowPad] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 900 && window.innerHeight > 600);
  const [seenMsgs, setSeenMsgs] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const localChat = useChat(st, names, resume?.chat);
  const { msgs, push } = online ? online.chat : localChat;
  const [confirmLeave, setConfirmLeave] = useState(false);

  const shownTrick = pause ? st.tricks[st.tricks.length - 1]! : st.trick;
  const piles = pause ? st.tricks.slice(0, -1) : st.tricks;
  // online: `locked` while our move is in flight (until the server acks it), so it can't be sent twice
  const myTurn = !pause && !dealing && !(online?.source.locked) && st.turn === HUMAN;
  const hand = useMemo(() => (view.hand ? sortHand(view.hand, r) : null), [view.hand, r]);
  // cards stay face-down only while Blind Nil is actually on offer; otherwise just turn them over (no button)
  const autoReveal = myTurn && !dealing && st.phase === 'bidding' && view.hand === null && !!view.bidOptions && !view.bidOptions.blindNil;
  useEffect(() => { if (autoReveal) apply({ type: 'reveal', seat: HUMAN }); }, [autoReveal]); // eslint-disable-line react-hooks/exhaustive-deps
  const legal = myTurn && st.phase === 'playing' ? view.legal : [];
  const exchangeStep = st.phase === 'exchange' ? st.exchange[0] : undefined;
  const humanExchanging = myTurn && exchangeStep?.from === HUMAN;
  const mySide = sideOf(HUMAN, r);
  const winnerSeat = pause ? shownTrick.winner : null;
  useGameSounds(st, myTurn, mySide, msgs);
  const landCue = useCallback((c: Card) => landCueFor(st, c), [st]);
  // "Learn as you play": coach marks across hands until the player turns tips off (local to this player, online too)
  const [help, setHelp] = useState(false);
  const coachOn = tips.on && !tipsSkipped && st.phase !== 'gameOver';
  const hintLegal = coachOn;
  const tipsOff = () => { const t = { on: false, asked: true }; saveTips(t); setTips(loadTips()); };
  // bid coach: inside the bid panel while tips are on (open the first couple of times), or on request ("?")
  const bidTurn = myTurn && !dealing && st.phase === 'bidding' && !!view.bidOptions && !!view.hand;
  const coachBid = bidTurn && (coachOn || help);
  const bcKey = `${st.seed}:${st.handNo}`;
  const bcOpen = false; void tipCount;
  const bcCounted = useRef<string | null>(null);
  useEffect(() => { if (coachBid && coachOn && bcCounted.current !== bcKey) { bcCounted.current = bcKey; bumpTip('bidcoach'); } }, [coachBid, coachOn, bcKey]);
  const helpButton = (
    <button type="button" className={`bug-btn help-btn ${help ? 'on' : ''}`} data-testid="help" aria-label="Help: tips and book counting" aria-pressed={help} onClick={() => setHelp(!help)}>?</button>
  );

  // persist after every action (and chat line); a finished game clears the save
  useEffect(() => {
    if (online) return; // online games live on the server (seat token in localStorage), not in the offline save
    if (st.phase === 'gameOver') clearGame();
    else saveGame({ seed, settings, state: st, chat: msgs, names });
  }, [st, msgs, seed, settings, online]);

  // "Resuming your game…" toast
  useEffect(() => {
    if (!resume) return;
    setToasts([{ id: -1, text: 'RESUMING YOUR GAME…', kind: 'info', sub: `Hand ${resume.state.handNo}` }]);
    const t = setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== -1)), 2600);
    return () => clearTimeout(t);
  }, [resume]);
  const leave = () => { if (!online) clearGame(); onExit(); };
  // game over: no confirmation — the game is finished
  const mainMenu = () => { if (!online) clearGame(); (onMainMenu ?? onExit)(); };
  const isBooks = booksHand(st);
  // "First hand: books bid themselves" — announce it once the deal lands
  const booksAnnounced = useRef<string | null>(null);
  useEffect(() => {
    const key = `${st.seed}:${st.handNo}`;
    if (!isBooks || dealing || resume || booksAnnounced.current === key || st.tricks.length > 0) return;
    booksAnnounced.current = key;
    setToasts([{ id: -2, text: 'FIRST HAND: BOOKS BID THEMSELVES', kind: 'info', sub: 'No bidding · every book you take = 10 points' }]);
    const t = setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== -2)), 3400);
    return () => clearTimeout(t);
  }, [isBooks, dealing, st.seed, st.handNo, st.tricks.length, resume]);

  useEffect(() => { setSelected(null); }, [st.turn, st.handNo]);
  useEffect(() => { setExchangePick([]); }, [st.phase, st.turn]);
  useEffect(() => { if (chatOpen) setSeenMsgs(msgs.length); }, [chatOpen, msgs.length]);

  // BID MADE / SET / NIL! toasts
  const lastHist = useRef(st.history.length);
  useEffect(() => {
    if (st.history.length <= lastHist.current) { lastHist.current = st.history.length; return; }
    lastHist.current = st.history.length;
    const rec = st.history[st.history.length - 1]!;
    const base = Date.now();
    const list = toastsFor(rec, r, names, mySide).map((t, i) => ({ ...t, id: base + i }));
    setToasts(list);
    const cue: Record<Toast['kind'], Sfx | null> = { made: 'made', set: 'set', nil: 'nil', bust: 'set', bags: 'bags', info: null };
    list.forEach((t, i) => { const c = cue[t.kind]; if (c) sound.play(c, { delay: 0.1 + i * 0.45 }); });
    const tm = setTimeout(() => setToasts([]), 3200);
    // hype: SHOT! / GOT SHOT and streak pop-ups (every client derives them from the same state)
    const timers: number[] = [];
    const calls = calloutsFor(st, mySide, names);
    const shot = calls.find((c) => c.kind === 'shot') ?? calls.find((c) => c.kind === 'gotShot');
    if (shot) timers.push(window.setTimeout(() => fx.emit(shot.kind as 'shot' | 'gotShot', { text: shot.text }), 350));
    const streak = calls.find((c) => c.kind === 'streak');
    if (streak) timers.push(window.setTimeout(() => fx.emit('streak', { level: streak.level, text: streak.text.split(' · ')[0], sub: streak.text.split(' · ')[1] }), shot ? 1750 : 400));
    return () => { clearTimeout(tm); timers.forEach(clearTimeout); };
  }, [st.history, r, names, mySide]); // eslint-disable-line react-hooks/exhaustive-deps

  // Table Talk shows a beat after scoring, so the toasts / pop-ups land on the table first
  const [talkOpen, setTalkOpen] = useState(false);
  useEffect(() => {
    if (st.phase !== 'handOver' || pause) { setTalkOpen(false); return; }
    const t = window.setTimeout(() => setTalkOpen(true), resume || online ? 900 : 1500);
    return () => clearTimeout(t);
  }, [st.phase, st.handNo, pause]); // eslint-disable-line react-hooks/exhaustive-deps
  const talkSend = (text: string) => {
    push('You', text);
    const replies = TALK_LINES.replies[text];
    if (!online && replies) { const bots = names.slice(1); push(pick(bots), pick(replies), false, 900 + Math.random() * 700); }
  };
  const reduceFx = useReduceEffects();
  // any modal up: the table, plates, chat, video bubbles etc. dim + blur behind it and can't paint over it
  const modalOpen = (st.phase === 'handOver' && !pause && talkOpen) || confirmLeave || showPad || (st.phase === 'gameOver' && !pause && !!st.result);

  const trumps = useMemo(() => trumpOrder(r).slice(0, 5).map((c) => (c === 'BJ' ? 'BIG JKR' : c === 'LJ' ? 'LIL JKR' : cardLabel(c))), [r]);
  const trumpsShort = useMemo(() => trumpOrder(r).slice(0, 4).map((c) => (c === 'BJ' ? 'BJ' : c === 'LJ' ? 'LJ' : cardLabel(c))), [r]);
  const promoted = useCallback((c: Card) => !isJoker(c) && c[1] !== 'S' && isTrump(c, r), [r]);

  const onCard = useCallback((c: Card) => {
    if (humanExchanging) {
      sound.play('tap');
      setExchangePick((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length < exchangeStep!.count ? [...p, c] : p));
      return;
    }
    if (!legal.includes(c)) return;
    if (selected === c) { apply({ type: 'play', seat: HUMAN, card: c }); setSelected(null); }
    else { setSelected(c); sound.play('tap'); }
  }, [humanExchanging, exchangeStep, legal, selected, apply]);

  const renderSeat = (seat: number) => {
    const isTurn = st.turn === seat && !pause && st.phase !== 'handOver' && st.phase !== 'gameOver';
    const partner = r.partnerships && seat === partnerOf(HUMAN, r);
    const b = st.bids[seat];
    return (
      <div className={`plate ${isTurn ? 'turn' : ''} ${partner ? 'ally' : 'foe'}`} data-testid={`seat-${seat}`}>
        <div className="plate-avatar" style={{ ['--uc' as string]: SEAT_COLORS[seat] }}>{names[seat]![0]}</div>
        <div className="plate-body">
          <div className="plate-name">{names[seat]}{st.dealer === seat && <span className="chip dealer">D</span>}{partner && <span className="chip ally">PARTNER</span>}</div>
          <div className="plate-stats">
            <span className="chip">{b === 'books' ? 'BOOKS' : `BID ${b === null ? (isTurn && st.phase === 'bidding' ? '…' : '—') : bidLabel(b).toUpperCase()}`}</span>
            <span className="chip">TOOK {st.tricksWon[seat]}</span>
          </div>
        </div>
        {isTurn && <div className="plate-turn">{st.phase === 'bidding' ? 'BIDDING' : 'TO PLAY'}</div>}
        {online?.seatExtra(seat)}
      </div>
    );
  };

  const unread = Math.max(0, msgs.length - seenMsgs);

  // landscape phones: keep the bid / pass panel just above the top of the (resting) hand
  const screenRef = useRef<HTMLDivElement>(null);
  const measureHand = st.phase === 'bidding' || st.phase === 'exchange';
  useEffect(() => {
    if (!measureHand) return;
    const tick = () => {
      const L = (window as unknown as { __bwmLayout?: { hand: { y: number }[] } }).__bwmLayout;
      const el = screenRef.current;
      if (!el || !L?.hand?.length) return;
      const top = Math.min(...L.hand.map((q) => q.y));
      el.style.setProperty('--hand-clear', `${Math.max(60, Math.round(window.innerHeight - top + 6))}px`);
    };
    tick();
    const t = window.setInterval(tick, 400);
    return () => clearInterval(t);
  }, [measureHand, vp.short]);

  return (
    <div ref={screenRef} className={`table-screen q-${settings.quality}${vp.short ? ' short' : ''}${modalOpen ? ' modal-open' : ''}`}>
      <Suspense fallback={<div className="loading3d"><div className="spinner" />Setting the table…</div>}>
        <Scene
          quality={settings.quality}
          n={n}
          handNo={st.handNo}
          dealer={st.dealer}
          positions={pos}
          human={HUMAN}
          myHand={hand}
          handCounts={view.handCounts}
          shownTrick={shownTrick.plays}
          piles={piles}
          legal={humanExchanging && hand ? hand : legal}
          selected={selected}
          turnSeat={pause || st.phase === 'handOver' || st.phase === 'gameOver' ? null : st.turn}
          winnerSeat={winnerSeat}
          promoted={promoted}
          onCardTap={onCard}
          renderSeat={renderSeat}
          introHand={introHand}
          animK={k}
          landCue={landCue}
          short={vp.short}
          safe={vp.safe}
          hintLegal={hintLegal}
        />
      </Suspense>

      {/* scorebug */}
      <header className="scorebug">
        <button type="button" className="bug-btn" onClick={() => (online || st.phase === 'gameOver' ? leave() : setConfirmLeave(true))} aria-label="Menu" data-testid="menu">☰</button>
        <div className="bug glass">
          <img className="bug-logo" src="/assets/bwm-wordmark-white.svg" alt="Bid Wit Me" />
          <div className={`bug-teams n${st.scores.length}`}>
            {st.scores.map((s, i) => (
              <div key={i} className={`bug-team ${i === mySide ? 'mine' : ''} ${st.result?.winners.includes(i) ? 'won' : ''}`}>
                <span className="bug-name">{online && r.partnerships ? online.sideLabel(i) : r.partnerships ? sideName(r, i, names).replace(' & ', ' + ').toUpperCase() : names[i]!.toUpperCase()}</span>
                <TickNumber value={s} className="bug-score" />
                <span className="bug-bags">{st.bags[i]}<small>B</small></span>
              </div>
            ))}
          </div>
          <div className="bug-trumps" aria-label="Trump order">
            <span className="ts-label">TRUMPS</span>{trumpsShort.join('›')}{st.spadesBroken && <i className="bt-broken" title="Spades broken">BROKEN</i>}
          </div>
          <div className="bug-meta">
            <span className="bug-mode">{modeTitle(r).toUpperCase()}</span>
            {learning && <span className="learn-badge" data-testid="learning-badge" title="Tips are on: the game slows down so you can read. Turn tips off to go back to your speed.">LEARNING MODE: SLOW</span>}
            <span>HAND {st.handNo}{isBooks ? ' · BOOKS BID THEMSELVES' : ''} · TO {r.targetScore}</span>
          </div>
        </div>
        {helpButton}
        <button type="button" className="bug-btn" onClick={() => setShowPad(true)} aria-label="Score pad">📋</button>
        <button type="button" className="bug-btn q" onClick={() => onQuality(settings.quality === 'high' ? 'low' : 'high')} aria-label="Toggle graphics quality">{settings.quality === 'high' ? 'HQ' : 'LQ'}</button>
        {/* the always-visible sound dock (main.tsx) sits on this slot */}
        <span className="bug-btn dock-slot" aria-hidden />
      </header>

      <div className="trump-strip glass slant">
        <span className="ts-label">TRUMPS</span> {trumps.join(' › ')}{st.spadesBroken && <span className="ts-broken">BROKEN</span>}
      </div>

      {/* last-trick readout */}
      {piles.length > 0 && (() => {
        const t = piles[piles.length - 1]!;
        const short = (c: Card) => (c === 'BJ' ? 'BJ' : c === 'LJ' ? 'LJ' : cardLabel(c));
        return (
          <div className="last-trick glass slant" data-testid="last-trick" aria-label="Last trick">
            <span className="lt-label">LAST TRICK</span>
            {t.plays.map((pl) => (
              <span key={pl.card} className={`lt-card ${pl.seat === t.winner ? 'win' : ''} ${pl.card[1] === 'H' || pl.card[1] === 'D' || pl.card === 'BJ' ? 'red' : ''}`}>
                <small>{pl.seat === HUMAN ? 'You' : names[pl.seat]!.slice(0, 3)}</small>{short(pl.card)}
              </span>
            ))}
          </div>
        );
      })()}

      {/* center notes */}
      <div className="center-note-wrap">
        {st.phase === 'bidding' && !pause && st.turn !== HUMAN && <div className="center-note">{names[st.turn!]} is bidding…</div>}
        {isBooks && st.phase === 'playing' && !pause && !dealing && st.tricks.length === 0 && st.trick.plays.length === 0 && <div className="center-note books-note" data-testid="books-note">First hand: books bid themselves · 10 per book</div>}
        {st.phase === 'exchange' && !humanExchanging && <div className="center-note">{names[exchangeStep!.from]} passes {exchangeStep!.count} to {names[exchangeStep!.to]}…</div>}
      </div>
      {winnerSeat !== null && <TrickBanner key={`${st.handNo}-${st.tricks.length}`} text={winnerSeat === HUMAN ? 'YOU TAKE IT' : `${names[winnerSeat]!.toUpperCase()} TAKES IT`} />}

      {/* toasts */}
      <div className="toasts">
        {toasts.map((t, i) => (
          <div key={t.id} className={`toast ${t.kind}`} style={{ animationDelay: `${i * 0.18}s` }}>
            <span className="toast-text">{t.text}</span>
            {t.sub && <span className="toast-sub">{t.sub}</span>}
          </div>
        ))}
      </div>

      <ChatPanel msgs={msgs} open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} onSend={(t) => push('You', t)} unread={unread} scope={online ? 'table' : undefined} extra={online ? online.controls : <OfflineMediaBar />} />
      {help && !bidTurn && view.hand && view.hand.length > 0 && st.phase !== 'handOver' && st.phase !== 'gameOver' && (
        <div className="bid-coach-float glass slant"><BidCoach view={view} startOpen title="COUNT YOUR BOOKS" onClose={() => setHelp(false)} /></div>
      )}

      {/* the human's lower third + controls */}
      <section className="me">
        {myTurn && !dealing && st.phase === 'bidding' && view.bidOptions && !autoReveal && (
          view.hand === null ? (
            <div className="bid-panel glass slant">
              <div className="bid-tip-slot" />
              <div className="panel-title">BLIND NIL?</div>
              <p>Bid before looking — worth ±{r.blindNil.value}.</p>
              <div className="bid-row">
                {view.bidOptions.blindNil && <button type="button" className="danger" onClick={() => apply({ type: 'bid', seat: HUMAN, bid: 'blindNil' })}>Blind Nil</button>}
                <button type="button" className="primary" onClick={() => apply({ type: 'reveal', seat: HUMAN })}>See my cards</button>
              </div>
            </div>
          ) : (
            <div className={`bid-panel glass slant ${coachBid ? 'with-coach' : ''}`}>
              <div className="bid-tip-slot" />
              {coachBid && <BidCoach key={bcKey} view={view} startOpen={help || bcOpen} />}
              <div className="panel-title">YOUR BID{r.partnerships && typeof st.bids[2] === 'number' ? <small> · partner bid {st.bids[2]}</small> : null}</div>
              <div className="bid-grid">
                {Array.from({ length: view.bidOptions.max - view.bidOptions.min + 1 }, (_, i) => view.bidOptions!.min + i).map((b) => (
                  <button type="button" key={b} onClick={() => apply({ type: 'bid', seat: HUMAN, bid: b })}>{b}</button>
                ))}
                {view.bidOptions.nil && <button type="button" className="nil" onClick={() => apply({ type: 'bid', seat: HUMAN, bid: 'nil' })}>NIL</button>}
              </div>
            </div>
          )
        )}
        {st.phase === 'bidding' && !dealing && view.hand === null && !myTurn && (
          <div className="bid-panel glass slant compact">
            <span>Cards face down — Blind Nil is open on your turn.</span>
            <button type="button" onClick={() => apply({ type: 'reveal', seat: HUMAN })}>See cards</button>
          </div>
        )}
        {humanExchanging && (
          <div className="bid-panel glass slant">
            <div className="panel-title">PASS {exchangeStep!.count} TO {names[exchangeStep!.to]!.toUpperCase()}</div>
            <button type="button" className="primary" disabled={exchangePick.length !== exchangeStep!.count} onClick={() => apply({ type: 'exchange', seat: HUMAN, cards: exchangePick })}>Pass cards ({exchangePick.length}/{exchangeStep!.count})</button>
          </div>
        )}

        <div className={`plate me-plate ${myTurn && st.phase !== 'handOver' ? 'turn' : ''}`} data-testid="seat-0">
          <div className="plate-avatar" style={{ ['--uc' as string]: USER_COLORS.You }}>Y</div>
          <div className="plate-body">
            <div className="plate-name">YOU{st.dealer === HUMAN && <span className="chip dealer">D</span>}</div>
            <div className="plate-stats">
              <span className="chip">{st.bids[HUMAN] === 'books' ? 'BOOKS' : `BID ${st.bids[HUMAN] === null ? '—' : bidLabel(st.bids[HUMAN]).toUpperCase()}`}</span>
              <span className="chip">TOOK {st.tricksWon[HUMAN]}</span>
              {isNilBid(st.bids[HUMAN]) && st.tricksWon[HUMAN]! > 0 && <span className="chip bad">NIL BUSTED</span>}
            </div>
          </div>
          {myTurn && st.phase === 'playing' && <div className="plate-turn">{selected ? 'TAP AGAIN TO PLAY' : 'YOUR TURN'}</div>}
          {myTurn && st.phase === 'bidding' && <div className="plate-turn">YOUR BID</div>}
          {online?.seatExtra(HUMAN)}
        </div>
        {error && <div className="err">{error}</div>}
      </section>

      {/* accessible / automation controls for the 3D hand */}
      <div className="sr-only" role="group" aria-label="Your hand" data-testid="hand" data-trick-count={shownTrick.plays.length}>
        {(hand ?? []).map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`card-${c}`}
            data-legal={legal.includes(c) || humanExchanging ? 'true' : 'false'}
            aria-pressed={selected === c || exchangePick.includes(c)}
            onClick={() => onCard(c)}
          >
            {cardLabel(c)}
          </button>
        ))}
      </div>

      {st.phase === 'handOver' && !pause && talkOpen && (
        <Intermission
          st={st}
          names={names}
          mySide={mySide}
          msgs={msgs}
          onSend={talkSend}
          secs={online?.talk?.secs ?? null}
          ready={online?.talk?.ready}
          tile={online?.talk?.tile}
          online={!!online}
          onReady={() => apply({ type: 'nextHand' })}
          onScorePad={() => setShowPad(true)}
        />
      )}

      {confirmLeave && (
        <div className="modal-backdrop" onClick={() => setConfirmLeave(false)}>
          <div className="modal glass slant confirm" role="dialog" aria-label="Leave this game?" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title big">LEAVE THIS GAME?</div>
            <p className="muted">{onSuspend ? 'Leave ends it for good. Save & quit lets you resume from the menu.' : 'Your progress in this game will be lost.'}</p>
            <div className="bid-row">
              <button type="button" onClick={() => setConfirmLeave(false)}>Stay</button>
              {onSuspend && <button type="button" data-testid="save-quit" onClick={onSuspend}>Save &amp; quit</button>}
              <button type="button" className="primary" onClick={leave}>Leave</button>
            </div>
          </div>
        </div>
      )}

      {st.phase === 'gameOver' && !pause && st.result && (
        <div className="modal-backdrop">
          <div className="modal glass slant gameover" role="dialog" aria-label="Game over">
            <button type="button" className="modal-x" aria-label="Close and go to the main menu" data-testid="gameover-x" onClick={mainMenu}>✕</button>
            <div className="trophy">{st.result.winners.includes(mySide) ? '🏆' : '♠'}</div>
            <h2>{st.result.winners.includes(mySide) ? (st.result.winners.length > 1 ? 'YOU TIED FOR FIRST!' : 'VICTORY!') : `${st.result.winners.map((w) => sideName(r, w, names)).join(' & ').toUpperCase()} WIN${r.partnerships || st.result.winners.length > 1 ? '' : 'S'}`}</h2>
            <p className="muted">{st.result.endReason === 'floor' ? 'Ended by the losing floor.' : `First to ${r.targetScore}.`} {st.history.length} hands played.</p>
            <ol className="placements">
              {st.result.finalScores
                .map((score, side) => ({ side, score, place: st.result!.placements[side]! }))
                .sort((a, b) => a.place - b.place)
                .map((x) => (
                  <li key={x.side} className={x.side === mySide ? 'mine' : ''}>
                    <span className="place">#{x.place}</span>
                    <span>{sideName(r, x.side, names)}</span>
                    <b>{x.score}</b>
                  </li>
                ))}
            </ol>
            <div className="bid-row">
              <button type="button" onClick={() => setShowPad(true)}>Score pad</button>
              <button type="button" data-testid="main-menu" onClick={mainMenu}>Main menu</button>
              <button type="button" onClick={leave}>Change mode</button>
              <button type="button" className="primary" onClick={onRematch}>Rematch</button>
            </div>
          </div>
        </div>
      )}

      {(coachOn || help) && !modalOpen && (
        <Coach
          ctx={{ st, view, hand, legal, myTurn, me: HUMAN, partnerName: r.partnerships ? names[partnerOf(HUMAN, r) ?? 2] ?? null : null, pause }}
          help={help}
          onSkip={() => setTipsSkipped(true)}
          onOff={tipsOff}
          onCloseHelp={() => setHelp(false)}
          onOpen={setTipOpen}
        />
      )}

      <Hype reduced={reduceFx} />
      {showPad && <ScorePad st={st} names={names} onClose={() => setShowPad(false)} />}
    </div>
  );
}
