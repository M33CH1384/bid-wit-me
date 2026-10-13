import { cardControlLabel } from './cardA11y';
import { actingSeat, seatMark } from './turnState';
import { retainHandOrder } from './handOrder';
import { winHeadline } from './headline';
import { type VenueId, VENUE_DEFS, resolveVenue } from './venues';
import { type FormEvent, type ReactNode, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type Card, type GameState, type PlayerView, type Play, type TableRules, viewFor, isFreshDeal, isNukeTrick, nextDealer, bidLabel, booksHand, cardLabel, isJoker, isNilBid, isTrump, newlyOneTrickFromShot, nilBustsJustResolved, partnerOf, sideOf, sortHand,
} from '@spades/rules';
import { ScorePad, setTeamNames, sideName } from './Modals';
import { LockedRulesPanel } from './LockedRules';
import { type Series, addSeriesGame, seriesSides, summarizeGame } from '@spades/rules';
import { SeriesChip, SeriesSheet, loadSeries, saveSeries } from './Series';
import { useMyTeamName } from './TeamName';
import { offlineTalk } from './offlineTalk';
import { BidOrder, showCenterBidOrder } from './PartnerTalk';
import { TrumpLadder } from './trumpLadder';
import { SocialButton } from './social/Social';
import { recordOfflineGame } from './offlineStats';
import { setTableIntensity, showLine, speakBot, useTalkPrefs } from './talkPrefs';
import { pickTeamName } from '@spades/protocol';
import { Intermission, calloutsFor } from './Intermission';
import Hype from './Hype';
import { landCueFor, wheelsFor, wheelsMade, wheelsTenth, wheelsTenthBooks } from './landCue';
import Feedback from './Feedback';
import { setFeedbackGame } from './feedbackContext';
import { loadTipJar, openTip, saveTipJar, tipNudgeDue } from './support';
import { OfflineMediaBar } from './online/Media';
import { fireCue, fx, useReduceEffects } from './fx';
import { useDealtSlots } from './dealtSlots';
import { FeltHand } from './FeltHand';
import { loadScene } from './three/preload';
import { TableLoading } from './TableLoading';
import { tableStillLoading, warmTableEffects } from './effects/warm';
import { endReasonText, onNoticeSides, shotChatLines } from './shotOut';
import { type Sfx, sound } from './audio';
import { HAPTIC, haptic } from './haptics';
import { type ChatMsg, LINES, SEAT_COLORS, TALK_LINES, type Toast, TickNumber, USER_COLORS, pick, toastsFor } from './overlay';
import { type Settings, modeTitle } from './settings';
import type { SeatPos } from './three/layout';
import { HUMAN, useGame } from './useGame';
import { DealerPopup } from './DealerPopup';
import { dealerAnnouncement, dealerFromServer, withCurrentDealerLine } from './dealerName';
import { MinBidLine, bidChoices, minBidNote } from './minBid';
import { type SavedGame, clearGame, saveGame } from './save';

import { useViewport } from './viewport';
import { Coach, LedSuitChip } from './Coach';
import { type TipsPref, bumpTip, loadTips, saveTips, tipCount } from './tips';
import { BidCoach } from './BidCoach';
import { RUN_FX_MS } from '@spades/protocol';
import { RUN_SHOW_MS, RUN_SLAM_MS, RUN_IT_CALLOUTS, RUN_TORNADO_AFTER_MS, RUN_ZOOM_MS } from './runIt';
import { pickRunShow, scoreOpened } from './runPlayback';
import type { RunPlayback } from '@spades/protocol';
import { RunItReview, RunZoom, runReviewOverTable } from './RunZoom';
import { TrashTalkButton } from './TrashTalk';
import { isPromoted } from './cardFaces';
import { QUICK_TRASH_SET } from './quickTrash';
import { BADGES, award, runItTipDue, runItTipShown, runItUsed, useBadges } from './badges';
import { type TalkIntensity, botSkillFor, personaForName, personaTag, pickBotNames } from '@spades/bots';
import { preloadVoice } from './voices/voices';
const Scene = lazy(loadScene);

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
  /** per local side: custom team name (null = partner names) */
  teamNames?: (string | null)[];
  /** rename my team (server-validated) */
  setTeamName?: (name: string) => void;
  /** the table's rematch series + which of its sides is mine */
  series?: { series: Series | null; mine: number };
  /** local seats whose Hustler act is over */
  revealed?: number[];
  /** local seats held by bots */
  botSeats?: number[];
  /** the host's trash-talk intensity */
  talkIntensity?: TalkIntensity;
  /** victory spotlight (game over): winners' / losers' local seats + the winning side's name */
  victory?: (winners: number[], losers: number[], title: string, sub?: string) => ReactNode;
  /** the venue this online game is played in (everyone sees the same) */
  venue?: VenueId;
  /** Release 10: watching, not playing. Seat 0 is a real player (names[0] is their name): no hand, no controls. */
  spectator?: boolean;
  /**
   * Current hand's dealer, already mapped from the server seat to the plate name.
   * Offline leaves this unset and derives it from the engine seat.
   */
  dealerName?: string;
  /** Resolved Run it! in local seats. Present for every viewer until the next hand, including the one who did not claim. */
  run?: RunPlayback | null;
  /** Release 10: spectator banner / take-seat prompt / watchers chip, drawn over the table */
  overlay?: ReactNode;
}

interface Props {
  rules: TableRules;
  seed: string;
  settings: Settings;
  onExit: () => void;
  /** Rematch: the next game continues the deal rotation from `dealer`. */
  onRematch: (dealer: number) => void;
  /** offline rematch: first dealer of this game (undefined = random) */
  startDealer?: number;
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
const talkOn = () => { try { return JSON.parse(localStorage.getItem('bwm.talk.v1') ?? '{}').botTalk !== false; } catch { return true; } };
function useChat(st: GameState, names: string[], initial?: ChatMsg[]) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => initial ?? []);
  const prev = useRef<GameState | null>(initial ? st : null);
  const idRef = useRef(initial && initial.length ? Math.max(...initial.map((m) => m.id)) + 1 : 1);
  const timers = useRef<number[]>([]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const push = useCallback((user: string, text: string, system = false, delay = 0, bot = false, hint = false) => {
    const add = () => setMsgs((m) => [...m.slice(-60), { id: idRef.current++, user, text, system, color: USER_COLORS[user] ?? SEAT_COLORS[namesRef.current.indexOf(user)] ?? '#ddd', ...(bot ? { bot: true } : {}), ...(hint ? { hint: true } : {}) }]);
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
      if (st.tricks.length === 0 && st.trick.plays.length === 0) push('System', offlineDealerLine(st, names), true);
      if (talkOn()) {
        push(pick(bots), pick(LINES.start), false, 900);
        push(pick(bots), pick(['yo', 'what up', '👋', 'ready']), false, 1700);
      }
      return;
    }
    if (st.handNo !== p.handNo) push('System', offlineDealerLine(st, names), true);
    // bids
    st.bids.forEach((b, s) => {
      if (b !== null && p.bids[s] === null && p.handNo === st.handNo) {
        push('System', `${names[s]} bid ${bidLabel(b)}`, true);
        if (isNilBid(b) && s !== HUMAN && talkOn() && Math.random() < 0.6) push(names[s]!, pick(['going nil 🤫', 'nil. cover me', 'trust me 😏']), false, 500);
      }
    });
    // wheels: a team's combined bid hits 10+ (team games only, once both partners have bid)
    if (p.handNo === st.handNo) {
      const before = new Set(wheelsFor(r, p.bids).map((w) => w.side));
      for (const w of wheelsFor(r, st.bids)) {
        if (before.has(w.side)) continue;
        const who = sideName(r, w.side, names);
        push('System', `🛞 Wheels! ${who} bid ${w.total} books together`, true);
        window.setTimeout(() => fx.emit('wheels', { sub: `${who} · ${w.total} books` }), 250);
      }
    }
    // Cutthroat wheels: your 10th book of the hand (once per hand per player)
    const runWait = st.tricks.slice(p.tricks.length).some((t) => t.plays.some((q) => q.run)) ? RUN_FX_MS : 0;
    if (st.handNo === p.handNo) for (const s of wheelsTenth(r, p.tricksWon, st.tricksWon)) {
      push('System', `🏎 Wheels! ${names[s]} took a 10th book`, true);
      window.setTimeout(() => fx.emit('wheelsCar', { text: `${names[s]} · 10 books` }), 900 + runWait);
    }
    // first hand (books bid themselves, so no bids): a team's 10th book of the hand → the same celebration
    if (st.handNo === p.handNo) for (const side of wheelsTenthBooks(r, st.bids, p.tricksWon, st.tricksWon)) {
      const who = sideName(r, side, names);
      push('System', `🏎 Wheels! ${who} took 10 books`, true);
      window.setTimeout(() => fx.emit('wheelsCar', { text: `${who} · 10 books` }), 900 + runWait);
    }
    // tricks
    if (st.tricks.length > p.tricks.length && st.handNo === p.handNo) {
      const t = st.tricks[st.tricks.length - 1]!;
      const winCard = t.plays.find((x) => x.seat === t.winner)!.card;
      const led = t.plays[0]!.card;
      void winCard; void led; // bot reactions to plays come from the trash-talk engine (offlineTalk)
      const ran = st.tricks.slice(p.tricks.length).filter((x) => x.plays.some((q) => q.run));
      if (ran.length) push('System', `🌪 ${names[ran.at(-1)!.winner!]} ran the board (+${ran.length} books)`, true);
      else if (t.plays.some((x) => x.auto)) push('System', '☢ Nuked — remaining cards auto-played', true);
    }
    // hand scored
    if (st.history.length > p.history.length) {
      const rec = st.history[st.history.length - 1]!;
      push('System', `Hand ${rec.handNo}: ${rec.sides.map((s) => `${sideName(r, s.side, names)} ${s.points >= 0 ? '+' : ''}${s.points}`).join(' · ')}`, true);
      for (const w of wheelsMade(r, rec)) push('System', `🏎 Wheels made! ${sideName(r, w.side, names)} bid ${w.bid} and took ${w.books}`, true);
      for (const t of shotChatLines(r, rec, st, (side) => sideName(r, side, names))) push('System', t, true);
      const mySide = sideOf(HUMAN, r);
      void mySide;
    }
    if (st.history.length > p.history.length && st.phase === 'handOver' && talkOn()) {
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
    }
  }, [st, names, bots, n, push]);

  // The line above is written once per hand. If that seat's occupant changes later, point it at the current name.
  useEffect(() => {
    const line = offlineDealerLine(st, names);
    setMsgs((xs) => {
      const texts = withCurrentDealerLine(xs.map((m) => m.text), st.handNo, line);
      if (!texts) return xs;
      return xs.map((m, i) => (m.text === texts[i] ? m : { ...m, text: texts[i]! }));
    });
  }, [st.handNo, st.dealer, names]);

  return { msgs, push };
}

/** Offline: the viewer is engine seat 0, so that seat's dealer name is "You" and every other seat is its current name. */
function offlineDealerLine(st: GameState, names: readonly string[]): string {
  const name = dealerFromServer({
    serverDealer: st.dealer,
    occupants: names.map((nm) => ({ name: nm, kind: 'human' as const })),
    viewerSeat: 0,
  }).name;
  return dealerAnnouncement(st.handNo, name);
}

function ChatPanel({ msgs, open, onToggle, onSend, unread, scope = 'local only', extra, trash, overRecap = false }: { msgs: ChatMsg[]; open: boolean; onToggle: () => void; onSend: (t: string) => void; unread: number; scope?: string; extra?: ReactNode; trash?: ReactNode; /** hand recap: the log is a sheet, opened from the corner button on that screen */ overRecap?: boolean }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [tray, setTray] = useState(false);
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
      {!overRecap && (
        <div className={`ctl-cluster ctl-tray ${tray ? 'expanded' : 'collapsed'}`} role="group" aria-label="Table controls" data-testid="ctl-tray">
          {tray && <>
            {extra}
            {trash}
            <button type="button" className={`chat-toggle ${open ? 'open' : ''}`} onClick={onToggle} aria-label="Toggle chat">
              💬{!open && unread > 0 && <span className="unread">{unread}</span>}
            </button>
          </>}
          <button type="button" className={`tray-toggle ${tray ? 'on' : ''}`} data-testid="tray-toggle" aria-expanded={tray} aria-label={tray ? 'Close controls' : 'Open controls: camera, mic, voice, chat'} onClick={() => setTray(!tray)}>
            {tray ? '✕' : <>💬<small>⋯</small></>}{!tray && unread > 0 && <span className="unread" data-testid="tray-unread">{unread}</span>}
          </button>
        </div>
      )}
      {!overRecap && !open && last && <div key={last.id} className="chat-ticker"><b style={{ color: last.color }}>{last.user}</b> {last.text}</div>}
      <aside className={`chat glass slant ${open ? 'open' : ''}${overRecap ? ' recap-chat' : ''}`} aria-label="Table chat">
        <header><span className="live-dot" /> {overRecap ? 'TABLE TALK' : 'LIVE CHAT'} <small>{scope}</small>{overRecap && <button type="button" className="sheet-x" aria-label="Close chat" onClick={onToggle}>✕</button>}</header>
        <div className="chat-list" ref={listRef}>
          {msgs.map((m) => (
            <div key={m.id} className={`chat-line ${m.system ? 'system' : ''}`}>
              {m.system ? <span>{m.text}</span> : <><b style={{ color: m.color }}>{m.user}</b>{m.badge && <em className="chat-tag" data-testid="chat-tag">{m.badge}</em>}<span>{m.text}</span></>}
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
    if (st.phase === 'gameOver' && p.st.phase !== 'gameOver' && st.result) sound.play(st.result.winners.includes(mySide) ? 'win' : 'lose', { delay: 0.3 + (runPlays(st).length && runPlays(p.st).length === 0 ? RUN_FX_MS / 1000 : 0) });
  }, [st, myTurn, mySide, msgs]);
}

export { landCueFor } from './landCue';

/** The plays of this hand recorded by 'Run it!' (empty if nobody ran it). */
function runPlays(st: GameState): Play[] { return st.tricks.flatMap((t) => t.plays.filter((p) => p.run)); }

/** Local seat that claimed 'Run it!' (they win every trick the claim played out). */
function runClaimerSeat(st: GameState): number | null {
  for (let i = st.tricks.length - 1; i >= 0; i--) {
    const t = st.tricks[i]!;
    if (t.winner !== null && t.plays.some((p) => p.run)) return t.winner;
  }
  return null;
}

/**
 * 'Run it!': the glowing button above your hand (only ever shown when the engine has proven every remaining book is yours).
 * The first few times it appears, a one-time spotlight tip points at it (shown even with tips off).
 */
function RunItButton({ onRun, tip, onDismissTip }: { onRun: () => void; tip: boolean; onDismissTip: () => void }) {
  const [bottom, setBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const L = (window as unknown as { __bwmLayout?: { hand: { y: number }[] } }).__bwmLayout;
      // above your hand, and never down among the plates / last-trick strip in the bottom corners (phones)
      if (L?.hand?.length) setBottom(Math.round(Math.max(window.innerHeight - Math.min(...L.hand.map((q) => q.y)) + 10, window.innerHeight * (window.innerWidth < 700 ? 0.33 : 0.3))));
    };
    place();
    const iv = window.setInterval(place, 400);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="run-it-wrap" style={{ bottom: bottom ?? undefined }}>
      {tip && (
        <div className="run-it-tip glass slant" role="dialog" aria-label="Run it tip" data-testid="run-it-tip">
          <span>You've got the rest locked. Tap <b>Run it!</b> to take every remaining book.</span>
          <button type="button" className="link" onClick={onDismissTip} aria-label="Dismiss tip">Got it</button>
        </div>
      )}
      <button type="button" className={`run-it-btn${tip ? ' attention' : ''}`} data-testid="run-it" onClick={onRun}>Run it! 🌪</button>
    </div>
  );
}

/** the stand-in table wears the chosen venue's colours (felt, rail, floor, backdrop) so loading never flashes classic green */
export function placeholderStyle(venue: VenueId): React.CSSProperties {
  const d = VENUE_DEFS[venue];
  const vars: Record<string, string> = {
    '--tp-felt': d.felt, '--tp-rail': d.railTint, '--tp-apron': d.apron, '--tp-clear': d.clear, '--tp-floor': d.floorTint, '--tp-rim': d.rim,
    '--tp-bg': venue === 'classic' ? 'none' : `url(/assets/venues/${venue}/bg.jpg)`,
    '--tp-floor-tex': d.floorTex ? `url(/assets/venues/tex/${d.floorTex}_512.jpg)` : 'none',
  };
  return vars as React.CSSProperties;
}

/** a stable 0–1 number from a game seed (Random venue: same pick for the same game) */
function seedFloat(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export default function Table({ rules: initialRules, seed, settings, onExit, onSuspend, onRematch, onQuality, resume, online, onMainMenu, startDealer }: Props) {
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
  const n0 = (resume?.state.rules ?? initialRules).playerCount;
  const [botNames] = useState(() => (resume?.names?.length === n0 ? resume.names : offlineNames(n0, seed)));
  // bot skill per seat: the table setting (Mixed = a hidden, seeded roll per seat) + persona floors (the Hustler is Pro+)
  const levelFor = useCallback((seat: number) => botSkillFor(settings.botLevel, seed, seat, botNames[seat] ?? ''), [settings.botLevel, seed, botNames]);
  const partnerHint = useRef<{ hand: number; text: string } | null>(null);
  const localReport = useRef<{ names: string[]; teamNames: (string | null)[] | null }>({ names: botNames, teamNames: null });
  const { st, view, pause, error, apply, introHand, dealing, k } = online ? online.source : useGame(initialRules, seed, levelFor, speed, resume?.state, learning && tipOpen, startDealer, partnerHint, localReport);
  useEffect(() => { online?.setLearning?.(learning); }, [learning]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = st.rules;
  const n = r.playerCount;
  const names = online?.names ?? botNames;
  const pos = useMemo(() => positions(n), [n]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [exchangePick, setExchangePick] = useState<Card[]>([]);
  const [showPad, setShowPad] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ltOpen, setLtOpen] = useState(false);
  const [clearedOpen, setClearedOpen] = useState(false);
  useEffect(() => { setClearedOpen(false); }, [st.handNo]);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 900 && window.innerHeight > 600);
  const [seenMsgs, setSeenMsgs] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const localChat = useChat(st, names, resume?.chat);
  const { msgs: rawMsgs, push } = online ? online.chat : localChat;
  // partner talk presets (team games, bidding): plain PUBLIC table chat — everyone sees it, opponents included.
  const partnerSeat = r.partnerships ? (HUMAN + 2) % n : -1;
  // (Release 9: no Partner talk preset panel and no typed bot-partner hints: partners talk out loud over open mics)
  const talkPrefs = useTalkPrefs();
  // trash-talk intensity is a table setting (offline: More options; online: the host); Family Friendly masks cursing
  const intensity = online ? (online.talkIntensity ?? 'cookout') : settings.talkIntensity;
  setTableIntensity(intensity);
  // bot trash talk: hidden entirely with 'Hide bot trash talk' (local preference)
  const msgs = useMemo(() => (talkPrefs.hideBotTalk ? rawMsgs.filter((m) => !m.bot) : rawMsgs.map((m) => (m.bot ? { ...m, text: showLine(m.text) } : m))), [rawMsgs, talkPrefs.hideBotTalk, intensity]); // eslint-disable-line react-hooks/exhaustive-deps

  // team names (team modes): yours from More options offline, the bots' a random fun one (kept in the save)
  const myName = useMyTeamName();
  const [botTeam] = useState(() => resume?.teamNames?.[1] ?? pickTeamName(Math.abs([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))));
  const teamNames: (string | null)[] | null = !r.partnerships ? null : online ? (online.teamNames ?? [null, null]) : [myName || null, botTeam];
  localReport.current = { names, teamNames };
  setTeamNames(teamNames); // sideName() everywhere (scorebug, results, Table Talk, Victory, score pad) uses these
  useEffect(() => () => setTeamNames(null), []);

  // offline: the nuke level is locked for the game at its start (a resumed game keeps the one it started with)
  useEffect(() => {
    if (online) return;
    fx.tableNuke = resume?.nuke ?? fx.prefs.nuke;
    return () => { fx.tableNuke = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // offline trash talk: same engine as the server
  useEffect(() => {
    if (online) return;
    offlineTalk.table = { seats: names.map((nm, i) => ({ name: nm, bot: i !== HUMAN })), partnerships: r.partnerships, teamNames: Array.from({ length: st.scores.length }, (_, i) => sideName(r, i, names)), intensity, jokers: r.deck === 'joker54' };
  });
  useEffect(() => {
    if (online) return;
    if (!resume) offlineTalk.newGame();
    offlineTalk.sink = (l) => {
      localChat.push(l.name, l.text, false, 0, true);
      speakBot(l.name, l.text, l.persona, l.line, l.bid);
      if (l.reveal) fx.emit('hustled', { text: `${l.name} was never new` });
      setRevealedTick((x) => x + 1);
    };
    return () => { offlineTalk.sink = null; offlineTalk.table = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setRevealedTick] = useState(0);
  const revealed = online ? (online.revealed ?? []) : offlineTalk.state.revealed;

  // rematch series: online from the server; offline kept in localStorage (reset when a new game starts from the menu)
  const [offSeries, setOffSeries] = useState<Series | null>(() => (online ? null : loadSeries()));
  const series = online ? online.series?.series ?? null : offSeries;
  const seriesMine = online ? online.series?.mine ?? 0 : sideOf(HUMAN, r);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const seriesRecorded = useRef(false);
  useEffect(() => {
    if (online || st.phase !== 'gameOver' || !st.result || seriesRecorded.current) return;
    seriesRecorded.current = true;
    recordOfflineGame(r.mode, st.result.winners.includes(sideOf(HUMAN, r)));
    const ids = names.map((_, i) => (i === HUMAN ? 'you' : `bot:${i}`));
    const sideNames = Array.from({ length: st.scores.length }, (_, i) => sideName(r, i, names));
    const prevS = loadSeries();
    const next = addSeriesGame(prevS, r.mode, seriesSides(st, ids, sideNames), summarizeGame(st, sideNames, (prevS?.games.length ?? 0) + 1, Date.now()));
    saveSeries(next);
    setOffSeries(next);
  }, [st.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // a rematch (Play again keeps the series): the bots talk about it
    if (!online && !resume && (loadSeries()?.games.length ?? 0) > 0) window.setTimeout(() => offlineTalk.moment({ kind: 'rematch' }), 2500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const seriesChip = (cls = '') => <SeriesChip series={series} onOpen={() => setSeriesOpen(true)} className={cls} />;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [feedback, setFeedback] = useState(false);
  // the Victory screen's tip-jar line: at most once every few finished games, never during play
  const [tipNudge, setTipNudge] = useState(false);
  const gameOverSeen = useRef(false);
  useEffect(() => {
    if (st.phase !== 'gameOver' || gameOverSeen.current) return;
    gameOverSeen.current = true;
    const s = loadTipJar(); const next = { ...s, games: s.games + 1 };
    const due = tipNudgeDue(next);
    saveTipJar(due ? { ...next, shownAt: next.games } : next);
    setTipNudge(due);
  }, [st.phase]);
  useEffect(() => { if (st.phase !== 'gameOver') gameOverSeen.current = false; }, [st.phase]);
  // feedback reports carry a short summary of this game
  useEffect(() => {
    setFeedbackGame({ mode: r.mode, players: r.playerCount, phase: st.phase, hand: st.handNo, scores: st.scores, bids: st.bids.map((b) => (b === null ? '-' : String(b))), books: st.tricksWon, online: !!online });
  }, [r.mode, r.playerCount, st.phase, st.handNo, st.scores, st.bids, st.tricksWon, online]);
  useEffect(() => () => setFeedbackGame(null), []);

  const shownTrick = pause ? st.tricks[st.tricks.length - 1]! : st.trick;
  const piles = pause ? st.tricks.slice(0, -1) : st.tricks;
  // online: `locked` while our move is in flight (until the server acks it), so it can't be sent twice
  const spectating = !!online?.spectator;
  // Online: the server seat's current occupant (OnlineTable). Offline: engine dealer, viewer at seat 0.
  const dealerLabel = online?.dealerName || dealerFromServer({
    serverDealer: st.dealer,
    occupants: names.map((name) => ({ name, kind: 'human' as const })),
    viewerSeat: spectating ? null : 0,
  }).name;
  const showDealer = !!dealerLabel && (dealing || isFreshDeal(st));
  const turnLocked = !!online?.source.locked;
  // Badges and playable cards share this. `covered` (Run it!) is applied again once that show exists.
  const myTurn = actingSeat({ turn: st.turn, phase: st.phase, pause, dealing, locked: turnLocked, covered: false }) === HUMAN && !spectating;
  // Sort once when the hand is dealt. A play only removes a card; re-sorting here is what made the fan look shuffled.
  const handOrder = useRef<{ handNo: number; cards: Card[] } | null>(null);
  const hand = useMemo(() => {
    if (!view.hand) return null;
    const prev = handOrder.current?.handNo === view.handNo ? handOrder.current.cards : null;
    const next = retainHandOrder(prev, view.hand, r);
    handOrder.current = { handNo: view.handNo, cards: next };
    return next;
  }, [view.hand, view.handNo, r]);
  // cards stay face-down only while Blind Nil is actually on offer; otherwise just turn them over (no button)
  const autoReveal = myTurn && !dealing && st.phase === 'bidding' && view.hand === null && !!view.bidOptions && !view.bidOptions.blindNil;
  useEffect(() => { if (autoReveal) apply({ type: 'reveal', seat: HUMAN }); }, [autoReveal]); // eslint-disable-line react-hooks/exhaustive-deps
  const legal = myTurn && st.phase === 'playing' ? view.legal.filter((c) => (hand ?? []).includes(c)) : [];
  const exchangeStep = st.phase === 'exchange' ? st.exchange[0] : undefined;
  const humanExchanging = myTurn && exchangeStep?.from === HUMAN;
  const mySide = sideOf(HUMAN, r);
  // ---- 'Run it!': on a run, the table keeps showing the moment before it while the claimer's cards slam down and
  // the tornado rips every hand + the table into the funnel; then the (finished) hand shows with an empty table.
  type RunFx = { id: number; before: { st: GameState; view: PlayerView }; claimer: number; cards: Card[]; others: { seat: number; card: Card }[]; books: number; phase: 'zoom' | 'slam'; at: number };
  const [seen, setSeen] = useState<{ st: GameState; view: PlayerView }>(() => ({ st, view }));
  const [runFx, setRunFx] = useState<RunFx | null>(null);
  /** Server playback seq already started, so a later state for the same claim does not replay it. */
  const [playedSeq, setPlayedSeq] = useState<number | null>(null);
  const [tableReady, setTableReady] = useState(false);
  const [dressed, setDressed] = useState(false);
  const [effectsWarm, setEffectsWarm] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0.08);
  const [loadGiveUp, setLoadGiveUp] = useState(false);
  const [loadGone, setLoadGone] = useState(false);
  const [webglHand, setWebglHand] = useState(false);
  const onTableReady = useCallback(() => { setTableReady(true); setLoadProgress((p) => Math.max(p, 0.72)); }, []);
  const onTableDressed = useCallback(() => { setDressed(true); setLoadProgress((p) => Math.max(p, 0.86)); }, []);
  const onHandLive = useCallback(() => setWebglHand(true), []);
  // The scene chunk is the long download. Bump the bar when it arrives, ahead of the first frame.
  useEffect(() => {
    let alive = true;
    loadScene().then(() => { if (alive) setLoadProgress((p) => Math.max(p, 0.42)); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  // WebGL that never starts, or a texture that never settles, must not trap the player on the loader.
  useEffect(() => {
    const t = window.setTimeout(() => setLoadGiveUp(true), 40000);
    return () => window.clearTimeout(t);
  }, []);
  // Shot, sheet, and tornado assets warm during this screen. A stalled shader compile gives up
  // after 12s; the timer above still lifts the loader if a download never finishes.
  useEffect(() => {
    let alive = true;
    warmTableEffects().then(() => { if (alive) setEffectsWarm(true); }).catch(() => { if (alive) setEffectsWarm(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (dressed && effectsWarm) setLoadProgress(1); }, [dressed, effectsWarm]);
  const loading = tableStillLoading(dressed, effectsWarm, loadGiveUp);
  useEffect(() => {
    if (loading) return;
    const t = window.setTimeout(() => setLoadGone(true), 380);
    return () => window.clearTimeout(t);
  }, [loading]);
  // The saved game is already in memory. The flat hand is playable on the first paint; the 3D scene catches up.
  useEffect(() => {
    const w = window as unknown as { __bwmPlayableAt?: number };
    const id = requestAnimationFrame(() => { w.__bwmPlayableAt ??= performance.now(); });
    return () => cancelAnimationFrame(id);
  }, []);
  const playback = online?.run ?? null;
  // Playback (every online viewer) or a jump that hides the run behind an ordinary trick (offline, bundled bot claim).
  if (seen.st !== st || (playback !== null && playback.handNo === st.handNo && playback.seq !== playedSeq)) {
    const show = pickRunShow(seen.st, st, playback, playedSeq);
    if (show) {
      setRunFx({
        id: show.fromServer ? show.id : Date.now(),
        before: seen.st.handNo === st.handNo ? seen : { st, view },
        claimer: show.claimer, books: show.books, phase: 'zoom', at: performance.now(),
        cards: show.cards, others: show.others,
      });
      if (show.fromServer) setPlayedSeq(show.id);
    } else if (playback && playback.handNo === st.handNo && playback.seq !== playedSeq) {
      setPlayedSeq(playback.seq);
    }
    if (seen.st !== st) setSeen({ st, view });
  }
  const [badgeToast, setBadgeToast] = useState<string | null>(null);
  const endRun = useCallback(() => { fx.tornado = null; sound.stopTornado(); setRunFx(null); }, []);
  // the claimer's line for the zoom's speech bubble: their latest chat line (bot persona line / a human's callout)
  const lastLine = useRef<Record<number, { text: string; at: number }>>({});
  const [runLine, setRunLine] = useState<string | null>(null);
  const seenMsgCount = useRef(rawMsgs.length);
  useEffect(() => {
    const fresh = rawMsgs.slice(seenMsgCount.current);
    seenMsgCount.current = rawMsgs.length;
    for (const m of fresh) {
      if (m.system) continue;
      const seat = m.user === 'You' ? HUMAN : names.indexOf(m.user);
      if (seat < 0) continue;
      lastLine.current[seat] = { text: m.text, at: performance.now() };
      if (runFx && runFx.phase === 'zoom' && seat === runFx.claimer) setRunLine(showLine(m.text));
      if (QUICK_TRASH_SET.has(m.text)) setCallout({ seat, text: m.text, id: m.id });
    }
  }, [rawMsgs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [callout, setCallout] = useState<{ seat: number; text: string; id: number } | null>(null);
  useEffect(() => { if (!callout) return; const t = window.setTimeout(() => setCallout(null), 3200); return () => clearTimeout(t); }, [callout]);
  const runId = runFx?.id;
  useEffect(() => {
    if (!runFx) { setRunLine(null); return; }
    // 1) zoom: the claimer's cards big + face up at the centre while they talk their talk
    const recent = lastLine.current[runFx.claimer];
    if (recent && performance.now() - recent.at < 1800) setRunLine(showLine(recent.text));
    else if (runFx.claimer === HUMAN) {
      const line = pick(RUN_IT_CALLOUTS as string[]);
      push('You', line);
    } else setRunLine(null);
    const zoom = RUN_ZOOM_MS / 1000;
    const tornadoAt = zoom + RUN_TORNADO_AFTER_MS / 1000;
    const who = runFx.claimer === HUMAN ? 'You' : names[runFx.claimer]!;
    // 2) the claimer's cards slam down together in SLOW MOTION (heavy impact: shake + bass hit)
    // 3) the tornado snatches everything else at once — every hand + whatever is on the table. No trick-by-trick play.
    sound.play('runSlam', { delay: zoom + RUN_SLAM_MS / 1000 });
    const impact = window.setTimeout(() => { if (!fx.reduced && !fx.osReducedMotion) fx.shake = { start: performance.now(), dur: 1.0, amp: 0.13 }; }, RUN_ZOOM_MS + RUN_SLAM_MS);
    sound.play('tornado', { delay: Math.max(0, tornadoAt - 0.3) });
    const toSlam = window.setTimeout(() => {
      setRunFx((f) => (f && f.id === runFx.id ? { ...f, phase: 'slam' } : f));
      // the tornado is timed from the slam (not the claim), so a late zoom timer can't let it sweep the table early
      fx.tornado = { start: performance.now() + RUN_TORNADO_AFTER_MS, reduced: fx.reduced };
      fx.emit('ranIt', { text: 'RAN IT!', sub: `${who} · +${runFx.books} book${runFx.books === 1 ? '' : 's'}`, silent: true });
    }, RUN_ZOOM_MS);
    // (capture scripts set __bwmHoldRun to step the tornado frame by frame via fx.warp)
    const hold = !!(window as unknown as { __bwmHoldRun?: boolean }).__bwmHoldRun;
    const timers = hold ? [impact] : [impact, window.setTimeout(endRun, RUN_SHOW_MS)];
    (window as unknown as { __bwmEndRun?: () => void }).__bwmEndRun = endRun;
    if (runFx.claimer === HUMAN && !spectating) {
      runItUsed();
      if (award('storm-chaser', { mode: r.mode, online: !!online, hand: runFx.before.st.handNo, books: runFx.books })) pendingBadge.current = 'storm-chaser';
    }
    return () => { clearTimeout(toSlam); timers.forEach(clearTimeout); fx.tornado = null; };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  // a badge earned by the run unlocks once the tornado is over (or skipped)
  const pendingBadge = useRef<string | null>(null);
  useEffect(() => {
    if (runFx || !pendingBadge.current) return;
    setBadgeToast(pendingBadge.current); pendingBadge.current = null; sound.play('made');
    const t = window.setTimeout(() => setBadgeToast(null), 3800);
    return () => clearTimeout(t);
  }, [runFx]);
  const ranHand = useMemo(() => runPlays(st).length > 0, [st]);
  // Cleared hands arrive on the view only after the claim resolves. Hold them back during the tornado.
  const runHands = !runFx ? view.runHands : undefined;
  const runClaimer = runHands ? runClaimerSeat(st) : null;
  const runOpenKey = useRef<string | null>(null);
  useEffect(() => {
    if (runFx || !view.runHands) {
      if (!view.runHands && runOpenKey.current) { runOpenKey.current = null; setLtOpen(false); }
      return;
    }
    // Table Talk / game over are full-screen. The cleared-hands portal is another full-screen
    // scrim on document.body (z-index above both), so auto-opening it here swallows every
    // tap and slide on the recap. The hands render inside Table Talk instead.
    if (!runReviewOverTable(st.phase)) { setLtOpen(false); return; }
    const key = `${st.handNo}:${st.tricks.length}`;
    if (runOpenKey.current === key) return;
    runOpenKey.current = key;
    setLtOpen(true);
  }, [runFx, view.runHands, st.handNo, st.tricks.length, st.phase]);
  // the scoreboard (scores, bags, books taken, result) holds the pre-run numbers until the tornado is over
  const sb = runFx ? runFx.before.st : st;
  const winnerSeat = pause && !ranHand ? shownTrick.winner : null;
  // the Run it! button + its one-time spotlight tip
  const canRun = !spectating && !dealing && st.phase === 'playing' && !!view.canRunIt && !runFx;
  const [runTip, setRunTip] = useState(false);
  const runTipKey = useRef<string | null>(null);
  useEffect(() => {
    if (!canRun) { setRunTip(false); return; }
    const key = `${st.seed}:${st.handNo}`;
    if (runTipKey.current === key) return;
    runTipKey.current = key;
    if (runItTipDue()) { runItTipShown(); setRunTip(true); }
  }, [canRun]); // eslint-disable-line react-hooks/exhaustive-deps
  const myBadges = useBadges();
  // what the 3D table shows (see above)
  const display = (() => {
    if (runFx) {
      const b = runFx.before;
      const bh = b.view.hand ? sortHand(b.view.hand, r) : null;
      // zoom: the table as it was (the claimer's cards are shown big in the overlay)
      if (runFx.phase === 'zoom') return { hand: bh, counts: b.view.handCounts, trick: b.st.trick.plays, piles: b.st.tricks, slam: null };
      // only the claimer's cards leave their hand (slow-mo slam); everyone else's stay in hand for the tornado to snatch
      const gone = new Set(runFx.cards);
      return {
        hand: bh?.filter((c) => !gone.has(c)) ?? null,
        counts: b.view.handCounts.map((c, i) => (i === runFx.claimer ? 0 : c)),
        trick: b.st.trick.plays, piles: b.st.tricks, slam: { seat: runFx.claimer, cards: runFx.cards, others: [] },
      };
    }
    if (ranHand) return { hand, counts: view.handCounts, trick: shownTrick.plays.some((p) => p.run) ? [] : shownTrick.plays, piles: [] as typeof piles, slam: null };
    return { hand, counts: view.handCounts, trick: shownTrick.plays, piles, slam: null };
  })();
  useGameSounds(st, myTurn, mySide, msgs);
  const landCue = useCallback((c: Card) => landCueFor(st, c), [st]);
  // "Learn as you play": coach marks across hands until the player turns tips off (local to this player, online too)
  const [help, setHelp] = useState(false);
  const [tipMarked, setTipMarked] = useState<Card[]>([]);
  const coachOn = tips.on && !tipsSkipped && st.phase !== 'gameOver';
  const hintLegal = coachOn;
  const tipsOff = () => { const t = { on: false, asked: true }; saveTips(t); setTips(loadTips()); };
  // bid coach: inside the bid panel while tips are on (open the first couple of times), or on request ("?")
  const bidTurn = myTurn && !dealing && st.phase === 'bidding' && !!view.bidOptions && !!view.hand;
  const coachBid = bidTurn && (coachOn || help);
  const raisedMin = view.bidOptions ? minBidNote(view.bidOptions, r, partnerSeat >= 0 ? st.bids[partnerSeat] ?? null : null) : null;
  const wheelSides = new Set(st.phase === 'bidding' || st.phase === 'playing' ? wheelsFor(r, st.bids).map((w) => w.side) : []);
  // The bid panel (and the floating "count your books" coach) never grows past the top bar: its max height is the room
  // between its (bottom-anchored) bottom edge and the scorebug / trump strip; the coach body scrolls inside.
  useLayoutEffect(() => {
    const fit = () => {
      const tops = [...document.querySelectorAll('.scorebug, .trump-strip')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0 && r.top < window.innerHeight / 2);
      const limit = Math.max(0, ...tops.map((r) => r.bottom)) + 6;
      for (const el of document.querySelectorAll<HTMLElement>('.me > .bid-panel, .bid-coach-float')) {
        const r = el.getBoundingClientRect();
        const room = el.classList.contains('bid-coach-float') ? window.innerHeight - r.top - 8 : r.bottom - limit;
        const v = `${Math.max(120, Math.floor(room))}px`;
        if (el.style.maxHeight !== v) el.style.maxHeight = v;
        el.classList.toggle('tight', room < 420);
        if (el.classList.contains('bid-coach-float')) continue;
        // keep clear of an open chat panel: narrow the (centred) panel if that leaves enough room, else sit above the chat
        const chat = document.querySelector('.chat.open')?.getBoundingClientRect();
        const hits = !!chat && chat.width > 0 && chat.left < innerWidth / 2 + 300 && chat.top < r.bottom && chat.bottom > r.top - 200;
        const w = chat ? Math.floor(2 * (chat.left - 10 - innerWidth / 2)) : 0;
        const mw = hits && w >= 340 ? `${w}px` : '';
        if (el.style.maxWidth !== mw) el.style.maxWidth = mw;
        el.parentElement?.classList.toggle('over-chat', hits && w < 340);
      }
    };
    fitRef.current = fit;
    fit();
  });
  // the lower third moves after resizes / hand re-measures (sometimes a beat later), so keep re-fitting while a panel is up
  const fitRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!bidTurn && !help && !humanExchanging) return;
    const run = () => fitRef.current();
    const iv = window.setInterval(run, 250);
    window.addEventListener('resize', run);
    window.visualViewport?.addEventListener('resize', run);
    return () => { clearInterval(iv); window.removeEventListener('resize', run); window.visualViewport?.removeEventListener('resize', run); };
  }, [bidTurn, help, humanExchanging]);
  const bcKey = `${st.seed}:${st.handNo}`;
  const bcOpen = false; void tipCount;
  const bcCounted = useRef<string | null>(null);
  useEffect(() => { if (coachBid && coachOn && bcCounted.current !== bcKey) { bcCounted.current = bcKey; bumpTip('bidcoach'); } }, [coachBid, coachOn, bcKey]);

  // persist after every action (and chat line); a finished game clears the save
  useEffect(() => {
    if (online) return; // online games live on the server (seat token in localStorage), not in the offline save
    if (st.phase === 'gameOver') clearGame();
    else saveGame({ seed, settings, state: st, chat: rawMsgs, names, teamNames: [null, botTeam], nuke: fx.tableNuke ?? fx.prefs.nuke });
  }, [st, rawMsgs, seed, settings, online]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Pump and the Nil-bust shotgun both come from the shared state, so every online client hears each once.
  // The pump is one book from a shot: a contract on the edge, or a Nil bidder still sitting at zero books.
  // The shotgun plays when the trick that gives that Nil bidder their first book resolves. Mute and volume are the bus.
  const pumpPrev = useRef<GameState | null>(null);
  const pumpedSides = useRef<Set<number>>(new Set());
  const nilBusted = useRef<Set<number>>(new Set());
  const pumpHand = useRef('');
  useEffect(() => {
    const key = `${st.seed}:${st.handNo}`;
    if (pumpHand.current !== key) { pumpHand.current = key; pumpedSides.current = new Set(); nilBusted.current = new Set(); }
    const prev = pumpPrev.current;
    pumpPrev.current = st;
    newlyOneTrickFromShot(prev, st, pumpedSides.current).forEach((side, i) => {
      pumpedSides.current.add(side);
      sound.play('pump', i ? { delay: i * 0.16 } : {});
    });
    nilBustsJustResolved(prev, st, nilBusted.current).forEach((seat, i) => {
      nilBusted.current.add(seat);
      sound.play('shotgun', i ? { delay: i * 0.12 } : {});
    });
  }, [st]);
  useEffect(() => { setExchangePick([]); }, [st.phase, st.turn]);
  useEffect(() => { if (chatOpen) setSeenMsgs(msgs.length); }, [chatOpen, msgs.length]);

  // BID MADE / SET / NIL! toasts
  const lastHist = useRef(st.history.length);
  const [histTick, setHistTick] = useState(0);
  const ranWaited = useRef(-1);
  useEffect(() => {
    // scoring toasts + hype still wait until the last trick has been shown (incl. a nuke or Run it!), so they
    // don't pile on the blast. They no longer hold the score screen — that opens when the trick hold ends.
    if (pause && st.history.length > lastHist.current) return;
    if (st.history.length <= lastHist.current) { lastHist.current = st.history.length; return; }
    lastHist.current = st.history.length;
    // after 'Run it!' the scoring toasts wait for the tornado
    const ranDelay = st.tricks.at(-1)?.plays.some((p) => p.run) ? RUN_FX_MS : 0;
    if (ranDelay && ranWaited.current !== st.history.length) {
      const len = st.history.length;
      const release = fx.hold(ranDelay + 300, 'runIt'); // toasts follow the tornado; the score does not wait on this hold
      const t0 = window.setTimeout(() => { ranWaited.current = len; lastHist.current = len - 1; setHistTick((x) => x + 1); release(); }, ranDelay);
      return () => { clearTimeout(t0); release(); };
    }
    const rec = st.history[st.history.length - 1]!;
    const base = Date.now();
    const list = toastsFor(rec, r, names, mySide).map((t, i) => ({ ...t, id: base + i }));
    setToasts(list);
    const setToast = list.some((t) => t.kind === 'set' || t.kind === 'bust');
    const cue: Record<Toast['kind'], Sfx | null> = { made: 'made', set: 'set', nil: 'nil', bust: 'set', bags: 'bags', info: null };
    list.forEach((t, i) => { const c = cue[t.kind]; if (c) sound.play(c, { delay: 0.1 + i * 0.45 }); });
    const tm = setTimeout(() => setToasts([]), 3200);
    const toastHold = list.length ? fx.hold(3200, 'toasts') : () => {};
    // A set is the shotgun blast on that scorecard panel (the recap plays the boom). No full-screen banner.
    // Streak / Wheels wait a beat so their pop-ups don't cover the muzzle flash.
    const timers: (() => void)[] = [];
    const calls = calloutsFor(st, mySide, names);
    const shot = calls.some((c) => c.kind === 'shot' || c.kind === 'gotShot');
    if (setToast) haptic(HAPTIC.setOrShot, 'set');
    else if (shot) {
      const ht = window.setTimeout(() => haptic(HAPTIC.setOrShot, 'shot'), 200);
      timers.push(() => clearTimeout(ht));
    }
    const streak = calls.find((c) => c.kind === 'streak');
    // Wheels made: a team that bid 10+ together and took 10+ books → the supercar peel-out
    const made = wheelsMade(r, rec);
    if (made.length) {
      const w = made[0]!;
      timers.push(fx.later('wheelsCar', shot ? 1500 : streak ? 2600 : 600, { text: `${sideName(r, w.side, names)} made ${w.bid} · took ${w.books}` }));
    }
    if (streak) timers.push(fx.later('streak', shot ? 1100 : 400, { level: streak.level, text: streak.text.split(' · ')[0], sub: streak.text.split(' · ')[1] }));
    return () => { clearTimeout(tm); toastHold(); timers.forEach((c) => c()); };
  }, [st.history, histTick, r, names, mySide, !!pause]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hand end: the score screen opens as soon as the trick hold ends. That hold is the beat after the last
  // card lands (~700 ms at normal speed). Run it! keeps the screen closed until that show ends (`runFx`).
  // A nuke's hold is the 3D blast, so the score stays covered until that allowance ends.
  // Scoring toasts and hype no longer add another wait on top.
  const [talkOpen, setTalkOpen] = useState(false);
  // A shot-out ends the hand in gameOver, which used to skip this recap. Hold the scorecard (blast, tape, sheet)
  // until Continue, then open the results. The ack is local; the shot count still comes from synced history.
  const [shotRecapAck, setShotRecapAck] = useState(false);
  useEffect(() => { setShotRecapAck(false); }, [st.phase, st.handNo]);
  useEffect(() => {
    if (!scoreOpened(st.phase, pause, !!runFx)) { setTalkOpen(false); return; }
    setTalkOpen(true);
    // the recap itself stays clear; banter lands in the corner chat sheet
    if (st.phase === 'handOver') setChatOpen(false);
  }, [st.phase, st.handNo, pause, !!runFx]); // eslint-disable-line react-hooks/exhaustive-deps
  const talkSend = (text: string) => {
    push('You', text);
    const replies = TALK_LINES.replies[text];
    if (!online && replies) { const bots = names.slice(1); push(pick(bots), pick(replies), false, 900 + Math.random() * 700); }
  };
  const reduceFx = useReduceEffects();
  // venue: online = the room's; offline = the setting, with Random rolled from the game seed (same spot after a refresh)
  const venue: VenueId = online ? (online.venue ?? 'classic') : resolveVenue(settings.venue, seedFloat(seed));
  useEffect(() => { sound.setVenueBed(VENUE_DEFS[venue].bed); return () => sound.setVenueBed('none'); }, [venue]);
  // nuke watchdog: the blast is normally cued by the second Joker's 3D landing; on a stalled renderer (Safari compiling
  // shaders, a backgrounded tab, very slow frames) that landing can come late or never — so once a nuked trick is on
  // the table, make sure the nuke fires anyway (fx dedupes, so it never plays twice).
  const nukeKey = isNukeTrick(shownTrick.plays) && !display.slam ? `${st.seed}:${st.handNo}:${shownTrick.plays.map((p) => p.card).join('')}` : null;
  const nukeAtMount = useRef(nukeKey); // a resumed save already showing a nuked trick doesn't re-fire
  useEffect(() => {
    if (!nukeKey || nukeKey === nukeAtMount.current) return;
    const release = fx.hold(1300, 'nukeWatch'); // the hand end waits for the blast (the blast holds itself once it fires)
    const t = window.setTimeout(() => { fireCue('nuke'); release(); }, 1100);
    return () => { clearTimeout(t); release(); };
  }, [nukeKey]);
  const winBuzzed = useRef(false);
  useEffect(() => { if (st.phase !== 'gameOver') winBuzzed.current = false; }, [st.phase]);
  const localWin = st.phase === 'gameOver' && !pause && !runFx && talkOpen && !!st.result?.winners.includes(mySide) && !spectating;
  useEffect(() => {
    if (!localWin || winBuzzed.current) return;
    winBuzzed.current = true;
    haptic(HAPTIC.gameWin, 'game-win');
  }, [localWin]);
  // any modal up: the table, plates, chat, video bubbles etc. dim + blur behind it and can't paint over it
  const shotOutRecap = st.phase === 'gameOver' && st.result?.endReason === 'shotOut' && !shotRecapAck;
  const showRecap = !pause && talkOpen && (st.phase === 'handOver' || shotOutRecap);
  const showResults = st.phase === 'gameOver' && !pause && !runFx && talkOpen && !!st.result && !shotOutRecap;
  const modalOpen = (st.phase === 'handOver' && !pause && talkOpen) || confirmLeave || showPad || (st.phase === 'gameOver' && !pause && !runFx && talkOpen && !!st.result);

  const promoted = useCallback((c: Card) => isPromoted(c, r), [r]);

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

  const isBotSeat = (seat: number) => (online ? !!online.botSeats?.includes(seat) : seat !== HUMAN);
  // recorded bot voices: fetch a persona's clips when one of its bots sits down
  const botKey = names.map((nm, i) => (isBotSeat(i) ? nm : '')).join('|');
  useEffect(() => {
    if (!talkPrefs.voices) return;
    names.forEach((nm, i) => { if (isBotSeat(i)) preloadVoice(personaForName(nm), nm); });
  }, [botKey, talkPrefs.voices]); // eslint-disable-line react-hooks/exhaustive-deps
  const notice = onNoticeSides(sb);
  const actor = actingSeat({ turn: st.turn, phase: st.phase, pause, dealing, locked: turnLocked, covered: !!runFx });
  const renderSeat = (seat: number) => {
    const mark = seatMark(actor, seat, st.phase, false, false, 0);
    const isTurn = mark === 'to-play' || mark === 'bidding';
    const partner = r.partnerships && seat === partnerOf(HUMAN, r);
    const b = st.bids[seat];
    return (
      <div className={`plate ${isTurn ? 'turn' : ''} ${partner ? 'ally' : 'foe'}`} data-testid={`seat-${seat}`} title={isBotSeat(seat) ? `${names[seat]} · ${personaTag(names[seat]!, revealed.includes(seat))}` : undefined} data-persona={isBotSeat(seat) ? personaTag(names[seat]!, revealed.includes(seat)) : undefined}>
        <div className="plate-avatar" style={{ ['--uc' as string]: SEAT_COLORS[seat] }}>{names[seat]![0]}</div>
        <div className="plate-body">
          <div className="plate-name">{names[seat]}{st.dealer === seat && <span className="chip dealer" data-testid={`dealer-${seat}`}>DEALER</span>}{partner && <span className="chip ally">PARTNER</span>}{notice.includes(sideOf(seat, r)) && <span className="chip notice" data-testid={`notice-${seat}`} title="Got shot last hand: one more shot and they're out">ON NOTICE</span>}</div>
          <div className="plate-stats">
            <span className="chip">{b === 'books' ? 'BOOKS' : `BID ${b === null ? (isTurn && st.phase === 'bidding' ? '…' : '—') : bidLabel(b).toUpperCase()}`}</span>
            <span className="chip">TOOK {sb.tricksWon[seat]}</span>
          </div>
        </div>
        {mark === 'bidding' && <div className="plate-turn" data-testid={`bidding-${seat}`}>BIDDING</div>}
        {mark === 'to-play' && <div className="plate-turn" data-testid={`to-play-${seat}`}>TO PLAY</div>}
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

  // The quick-load hand is on screen before WebGL. During a deal it may only show the cards that have left the deck.
  const feltShown = useDealtSlots(dealing, {
    speedK: k,
    players: n,
    dealer: st.dealer,
    seat: HUMAN,
    slots: display.hand?.length ?? 0,
    handNo: st.handNo,
  });

  return (
    <div ref={screenRef} className={`table-screen q-${settings.quality}${vp.short ? ' short' : ''}${modalOpen ? ' modal-open' : ''}${showPad ? ' pad-open' : ''}`} inert={loading ? true : undefined}>
      {/* styled stand-in table, on screen from the first paint until the 3D table has rendered (then it fades) */}
      <div className={`table-placeholder ${tableReady ? 'gone' : ''}`} data-testid="table-placeholder" data-venue={venue} style={placeholderStyle(venue)} aria-hidden>
        <div className="tp-floor" />
        <div className="tp-table"><div className={`tp-felt${VENUE_DEFS[venue].feltPattern ? ` ${VENUE_DEFS[venue].feltPattern}` : ''}`}><img src="/assets/bwm-wordmark-white.svg" alt="" /></div></div>
        {!tableReady && !(resume && display.hand && display.hand.length > 0) && <div className="tp-note">Setting the table…</div>}
      </div>
      {resume && !webglHand && display.hand && display.hand.length > 0 && (
        <FeltHand
          cards={display.hand}
          visibleCount={feltShown}
          trick={display.trick.map((p) => p.card)}
          legal={runFx ? [] : humanExchanging && hand ? hand : legal}
          selected={runFx ? null : selected}
          onCard={onCard}
          promoted={promoted}
        />
      )}
      <Suspense fallback={null}>
        <Scene
          onTableReady={onTableReady}
          onTableDressed={onTableDressed}
          onHandLive={onHandLive}
          quality={settings.quality}
          n={n}
          handNo={st.handNo}
          dealer={st.dealer}
          positions={pos}
          human={HUMAN}
          myHand={display.hand}
          handCounts={display.counts}
          shownTrick={display.trick}
          slam={display.slam}
          reduceFx={reduceFx}
          venue={venue}
          piles={display.piles}
          legal={runFx ? [] : humanExchanging && hand ? hand : legal}
          selected={runFx ? null : selected}
          turnSeat={runFx || pause || st.phase === 'handOver' || st.phase === 'gameOver' || st.turn !== HUMAN ? null : st.turn}
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
          marked={tipMarked}
        />
      </Suspense>
      {!loadGone && <TableLoading progress={loadProgress} leaving={!loading} />}

      {/* scorebug */}
      <header className="scorebug">
        <div className="menu-wrap">
          <button type="button" className={`bug-btn ${menuOpen ? 'on' : ''}`} onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu" aria-expanded={menuOpen} data-testid="menu">☰</button>
          {menuOpen && (
            <>
              <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="game-menu glass" role="menu" data-testid="game-menu">
                <button type="button" role="menuitem" className={help ? 'on' : ''} data-testid="help" aria-pressed={help} onClick={() => { setHelp(!help); setMenuOpen(false); }}>❓ Help: tips &amp; book counting</button>
                <button type="button" role="menuitem" data-testid="scorepad-button" onClick={() => { setShowPad(true); setMenuOpen(false); }}>📋 Score pad &amp; house rules</button>
                <button type="button" role="menuitem" onClick={() => onQuality(settings.quality === 'high' ? 'low' : 'high')}>🎨 Graphics: {settings.quality === 'high' ? 'High' : 'Low'}</button>
                <div className="menu-social"><SocialButton className="compact" /></div>
                <button type="button" role="menuitem" className="danger" data-testid="menu-leave" onClick={() => { setMenuOpen(false); if (online || st.phase === 'gameOver') leave(); else setConfirmLeave(true); }}>🚪 Leave table</button>
              </div>
            </>
          )}
        </div>
        <div className="bug glass">
          <img className="bug-logo" src="/assets/bwm-wordmark-white.svg" alt="Bid Wit Me" />
          <span className="beta-tag in-bug" aria-label="Beta">BETA</span>
          <div className={`bug-teams n${sb.scores.length}`} data-testid="bug-teams">
            {sb.scores.map((s, i) => (
              <div key={i} className={`bug-team ${i === mySide ? 'mine' : ''} ${sb.result?.winners.includes(i) ? 'won' : ''}`}>
                <span className="bug-name">{wheelSides.has(i) && <span className="wheels-tag" data-testid={`wheels-${i}`} title="Wheels: this team bid 10+ books together">WHEELS</span>}{r.partnerships ? (teamNames?.[i] ? sideName(r, i, names) : (online ? online.sideLabel(i) : sideName(r, i, names).replace(' & ', ' + '))).toUpperCase() : names[i]!.toUpperCase()}</span>
                <TickNumber value={s} className="bug-score" />
                <span className="bug-bags">{sb.bags[i]}<small>B</small></span>
              </div>
            ))}
          </div>
          <div className="bug-trumps" aria-label="Trump order">
            <span className="ts-label">TRUMPS</span><TrumpLadder rules={r} n={4} style="short" />{st.spadesBroken && <i className="bt-broken" title="Spades broken">BROKEN</i>}
          </div>
          <div className="bug-meta">
            <span className="bug-mode">{modeTitle(r).toUpperCase()}</span>
            {seriesChip('in-meta')}
            {learning && <span className="learn-badge" data-testid="learning-badge" title="Tips are on: the game slows down so you can read. Turn tips off to go back to your speed.">LEARNING MODE: SLOW</span>}
            <span className="bug-hand" data-testid="bug-hand">HAND {st.handNo}{isBooks ? <span className="bug-books"> · BOOKS BID THEMSELVES</span> : ''} · TO {r.targetScore}</span>
          </div>
        </div>
        {/* the always-visible sound dock (main.tsx) sits on this slot */}
        <span className="bug-btn dock-slot" aria-hidden />
      </header>

      <div className="trump-strip glass slant">
        <span className="ts-label">TRUMPS</span> <TrumpLadder rules={r} n={5} style="long" />{st.spadesBroken && <span className="ts-broken">BROKEN</span>}
      </div>

      {/* last-trick readout. After a resolved 'Run it!' the same chip opens every hand the tornado cleared. */}
      {(piles.length > 0 || !!runHands) && (() => {
        const seatLabel = (seat: number) => (spectating ? names[seat] : seat === HUMAN ? 'You' : names[seat]) ?? `Seat ${seat + 1}`;
        if (runHands && runClaimer !== null && ltOpen && runReviewOverTable(st.phase)) {
          return createPortal(
            <>
              <div className="run-review-scrim" onClick={() => setLtOpen(false)} />
              <div className="last-trick glass slant open run-open" data-testid="last-trick" aria-expanded>
                <RunItReview hands={runHands} claimer={runClaimer} labels={runHands.map((_, seat) => seatLabel(seat))} r={r} onClose={() => setLtOpen(false)} />
              </div>
            </>,
            document.body,
          );
        }
        if (runHands) {
          return (
            <div className="last-trick glass slant chip run-chip" data-testid="last-trick" aria-label="Run it" role="button" tabIndex={0} aria-expanded={false} onClick={() => setLtOpen(true)}>
              <span className="lt-label">RUN IT!</span>
            </div>
          );
        }
        const t = piles[piles.length - 1]!;
        const short = (c: Card) => (c === 'BJ' ? 'BJ' : c === 'LJ' ? 'LJ' : cardLabel(c));
        return (
          <div className={`last-trick glass slant ${ltOpen ? 'open' : 'chip'}`} data-testid="last-trick" aria-label="Last trick" role="button" tabIndex={0} aria-expanded={ltOpen} onClick={() => setLtOpen(!ltOpen)}>
            <span className="lt-label">LAST TRICK{!ltOpen && t.winner !== null && <> · {t.winner === HUMAN ? 'You' : names[t.winner]!.slice(0, 8)}</>}</span>
            {ltOpen && t.plays.map((pl) => (
              <span key={pl.card} className={`lt-card ${pl.seat === t.winner ? 'win' : ''} ${pl.card[1] === 'H' || pl.card[1] === 'D' || pl.card === 'BJ' ? 'red' : ''}`}>
                <small>{pl.seat === HUMAN ? 'You' : names[pl.seat]!.slice(0, 3)}</small>{short(pl.card)}
              </span>
            ))}
          </div>
        );
      })()}

      {/* center notes */}
      <div className="center-note-wrap">
        {showDealer && <DealerPopup name={dealerLabel} localSeat={st.dealer} />}
        {st.phase === 'bidding' && !pause && !dealing && st.turn !== HUMAN && <div className="center-note" data-testid="bidding-note">{r.partnerships && st.turn === partnerSeat ? `Your partner ${names[st.turn!]} is bidding…` : `${names[st.turn!]} is bidding…`}</div>}
        {showCenterBidOrder(st.phase, pause, dealing) && <BidOrder st={st} names={names} me={spectating ? -1 : HUMAN} />}
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

      <ChatPanel msgs={msgs} open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} onSend={(t) => (st.phase === 'handOver' ? talkSend(t) : push('You', t))} unread={unread} scope={online ? 'table' : undefined} extra={online ? online.controls : <OfflineMediaBar />}
        overRecap={showRecap && !showPad}
        trash={!runFx && !modalOpen && !spectating ? <TrashTalkButton st={st} me={HUMAN} intensity={intensity} onSend={(t) => push('You', t)} /> : null} />
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
              <div className="panel-title">YOUR BID{r.partnerships && st.bids[2] !== null ? <small> · partner bid {bidLabel(st.bids[2]!)}</small> : r.partnerships ? <small> · partner bids right after you</small> : null}</div>
              <BidOrder st={st} names={names} me={HUMAN} />
              {raisedMin ? <MinBidLine note={raisedMin} /> : (view.bidOptions.blockReason || view.bidOptions.nilReason) && (
                <p className="bid-block" data-testid="bid-block">{[view.bidOptions.blockReason, view.bidOptions.nilReason].filter(Boolean).join(' · ')}</p>
              )}
              <div className="bid-grid">
                {bidChoices(view.bidOptions.min, view.bidOptions.max).map((b) => (
                  <button type="button" key={b} onClick={() => apply({ type: 'bid', seat: HUMAN, bid: b })}>{b}</button>
                ))}
                {view.bidOptions.nil && <button type="button" className="nil" onClick={() => apply({ type: 'bid', seat: HUMAN, bid: 'nil' })}>NIL</button>}
              </div>
            </div>
          )
        )}
        {humanExchanging && (
          <div className="bid-panel glass slant">
            <div className="panel-title">PASS {exchangeStep!.count} TO {names[exchangeStep!.to]!.toUpperCase()}</div>
            <button type="button" className="primary" disabled={exchangePick.length !== exchangeStep!.count} onClick={() => apply({ type: 'exchange', seat: HUMAN, cards: exchangePick })}>Pass cards ({exchangePick.length}/{exchangeStep!.count})</button>
          </div>
        )}

        <div className={`plate me-plate ${actor === HUMAN && !spectating ? 'turn' : ''}`} data-testid="seat-0">
          <div className="plate-avatar" style={{ ['--uc' as string]: USER_COLORS.You }}>Y</div>
          <div className="plate-body">
            <div className="plate-name">{spectating ? (names[HUMAN] ?? '').toUpperCase() : 'YOU'}{st.dealer === HUMAN && <span className="chip dealer" data-testid="dealer-0">DEALER</span>}{notice.includes(sideOf(HUMAN, r)) && <span className="chip notice" data-testid="notice-0" title="Got shot last hand: one more shot and you're out">ON NOTICE</span>}{!spectating && myBadges.map((b) => BADGES[b.id] && <span key={b.id} className="chip badge" title={`${BADGES[b.id]!.name}: ${BADGES[b.id]!.desc}`} data-testid={`plate-badge-${b.id}`}>{BADGES[b.id]!.icon}</span>)}</div>
            <div className="plate-stats">
              <span className="chip">{st.bids[HUMAN] === 'books' ? 'BOOKS' : `BID ${st.bids[HUMAN] === null ? '—' : bidLabel(st.bids[HUMAN]).toUpperCase()}`}</span>
              <span className="chip">TOOK {sb.tricksWon[HUMAN]}</span>
              {isNilBid(st.bids[HUMAN]) && sb.tricksWon[HUMAN]! > 0 && <span className="chip bad">NIL BUSTED</span>}
            </div>
          </div>
          {seatMark(actor, HUMAN, st.phase, true, spectating, legal.length) === 'your-turn' && <div className="plate-turn" data-testid="your-turn">{selected ? 'TAP AGAIN TO PLAY' : 'YOUR TURN'}</div>}
          {seatMark(actor, HUMAN, st.phase, true, spectating, legal.length) === 'your-bid' && <div className="plate-turn" data-testid="your-bid">YOUR BID</div>}
          {online?.seatExtra(HUMAN)}
        </div>
        {error && <div className="err">{error}</div>}
      </section>
      {online?.overlay}
      {canRun && <RunItButton tip={runTip} onDismissTip={() => setRunTip(false)} onRun={() => { setRunTip(false); setSelected(null); apply({ type: 'runIt', seat: HUMAN }); }} />}
      {runFx?.phase === 'zoom' && <RunZoom cards={runFx.cards} who={runFx.claimer === HUMAN ? 'You' : names[runFx.claimer]!} line={runLine} r={r} />}
      {callout && !runFx && <div className={`trash-callout seat-${pos[callout.seat]}`} key={callout.id} data-testid="trash-callout"><b>{callout.seat === HUMAN ? 'You' : names[callout.seat]}</b>{showLine(callout.text)}</div>}
      {runFx && <button type="button" className="run-skip" data-testid="run-skip" aria-label="Skip" onClick={endRun}><span>Tap to skip</span></button>}
      {badgeToast && BADGES[badgeToast] && (
        <div className="badge-unlock glass slant" role="status" data-testid="badge-unlock" onClick={() => setBadgeToast(null)}>
          <span className="bu-icon">{BADGES[badgeToast]!.icon}</span>
          <span className="bu-text"><small>BADGE UNLOCKED</small><b>{BADGES[badgeToast]!.name}</b><i>{BADGES[badgeToast]!.desc}</i></span>
        </div>
      )}

      {/* accessible / automation controls for the 3D hand */}
      <div className="sr-only" role="group" aria-label="Your hand" data-testid="hand" data-trick-count={shownTrick.plays.length}>
        {(hand ?? []).map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`card-${c}`}
            data-legal={legal.includes(c) || humanExchanging ? 'true' : 'false'}
            disabled={!humanExchanging && !legal.includes(c)}
            aria-label={cardControlLabel(c, humanExchanging || legal.includes(c))}
            aria-pressed={selected === c || exchangePick.includes(c)}
            onClick={() => onCard(c)}
          >
            <span aria-hidden="true">{cardLabel(c)}</span>
          </button>
        ))}
      </div>

      {showRecap && (
        <Intermission
          st={st}
          names={names}
          mySide={mySide}
          secs={shotOutRecap ? null : (online?.talk?.secs ?? null)}
          ready={shotOutRecap ? undefined : online?.talk?.ready}
          online={shotOutRecap ? false : !!online}
          onReady={() => { if (st.phase === 'gameOver') setShotRecapAck(true); else apply({ type: 'nextHand' }); }}
          onScorePad={() => setShowPad(true)}
          series={seriesChip()}
          unread={unread}
          chatOpen={chatOpen}
          onChat={() => setChatOpen(!chatOpen)}
          runReview={runHands && runClaimer !== null ? (
            clearedOpen ? (
              <div className="tt-run" data-testid="talk-run">
                <RunItReview
                  hands={runHands}
                  claimer={runClaimer}
                  labels={runHands.map((_, seat) => (spectating ? names[seat] : seat === HUMAN ? 'You' : names[seat]) ?? `Seat ${seat + 1}`)}
                  r={r}
                  onClose={() => setClearedOpen(false)}
                />
              </div>
            ) : (
              <button type="button" className="tt-run-show" data-testid="talk-run-show" onClick={() => setClearedOpen(true)}>{(spectating ? names[runClaimer] : runClaimer === HUMAN ? 'You' : names[runClaimer]) ?? `Seat ${runClaimer + 1}`} ran the rest</button>
            )
          ) : null}
        />
      )}
      {seriesOpen && series && <SeriesSheet series={series} mine={seriesMine} onClose={() => setSeriesOpen(false)} />}

      {feedback && <Feedback onClose={() => setFeedback(false)} />}
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
            <button type="button" className="link fb-open-ingame" data-testid="open-feedback" onClick={() => { setConfirmLeave(false); setFeedback(true); }}>✉ Send feedback (bug, idea…)</button>
          </div>
        </div>
      )}

      {showResults && online?.victory && st.result && (() => {
        // online: the winners are the centerpiece (video spotlight); score, series and buttons sit underneath, secondary.
        // No auto-advance: it stays until someone leaves or the host starts the rematch.
        const res = st.result!;
        const seats = Array.from({ length: n }, (_, i) => i);
        const winSeats = seats.filter((i) => res.winners.includes(sideOf(i, r)));
        const loseSeats = seats.filter((i) => !res.winners.includes(sideOf(i, r)));
        const title = winHeadline(res.winners.map((w) => sideName(r, w, names)), r.partnerships);
        const iWon = !spectating && res.winners.includes(mySide);
        return (
          <div className="victory-screen" role="dialog" aria-label="Game over" data-testid="victory">
            <div className="vic-confetti" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i % 2 ? 91 : 1) + ((i * 13) % 7)}%`, background: `hsl(${i * 47} 90% 60%)`, animationDuration: `${3.2 + (i % 5) * 0.5}s`, animationDelay: `${-i * 0.37}s` }} />)}</div>
            <button type="button" className="modal-x" aria-label="Close and go to the main menu" data-testid="gameover-x" onClick={mainMenu}>✕</button>
            <h2 className="vic-head">{iWon ? (res.winners.length > 1 ? 'YOU TIED FOR FIRST!' : 'VICTORY!') : 'GAME OVER'}<small>{iWon ? '🏆' : '♠'}</small></h2>
            {(() => {
              // the players' names under the team name (skipped when the team has no name of its own: it'd repeat the title)
              const who = r.partnerships ? winSeats.map((i) => names[i] ?? '?').join(' & ') : undefined;
              return online.victory!(winSeats, loseSeats, title, who && !title.toLowerCase().startsWith(who.toLowerCase()) ? who : undefined);
            })()}
            <div className="vic-foot glass">
              {res.endReason === 'shotOut' && <div className="shot-out-banner" data-testid="shot-out">SHOT OUT</div>}
              <ol className="placements compact">
                {res.finalScores
                  .map((score, side) => ({ side, score, place: res.placements[side]! }))
                  .sort((a, b) => a.place - b.place)
                  .map((x) => (
                    <li key={x.side} className={x.side === mySide ? 'mine' : ''}><span className="place">#{x.place}</span><span>{sideName(r, x.side, names)}</span><b>{x.score}</b></li>
                  ))}
              </ol>
              {seriesChip()}
              <p className="muted small" data-testid="end-reason">{endReasonText(r, st, (side) => sideName(r, side, names))} {st.history.length} hand{st.history.length === 1 ? '' : 's'} played.</p>
              <div className="bid-row">
                <button type="button" onClick={() => setShowPad(true)}>Score pad</button>
                <button type="button" data-testid="main-menu" onClick={mainMenu}>Main menu</button>
                {!spectating && <button type="button" className="primary" data-testid="rematch" onClick={() => onRematch(nextDealer(st))}>Rematch</button>}
              </div>
            </div>
          </div>
        );
      })()}
      {showResults && st.result && !online?.victory && (
        <div className="modal-backdrop">
          <div className="modal glass slant gameover" role="dialog" aria-label="Game over">
            <button type="button" className="modal-x" aria-label="Close and go to the main menu" data-testid="gameover-x" onClick={mainMenu}>✕</button>
            <div className="trophy">{st.result.winners.includes(mySide) ? '🏆' : '♠'}</div>
            <h2>{st.result.winners.includes(mySide) ? (st.result.winners.length > 1 ? 'YOU TIED FOR FIRST!' : 'VICTORY!') : winHeadline(st.result.winners.map((w) => sideName(r, w, names)), r.partnerships).toUpperCase()}</h2>
            {seriesChip()}
            {st.result.endReason === 'shotOut' && <div className="shot-out-banner" data-testid="shot-out">SHOT OUT</div>}
            <p className="muted" data-testid="end-reason">{endReasonText(r, st, (side) => sideName(r, side, names))} {st.history.length} hand{st.history.length === 1 ? '' : 's'} played.</p>
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
            {tipNudge && (
              <p className="tip-nudge" data-testid="tip-nudge">
                Enjoying BWM? <button type="button" className="link" onClick={openTip}>Tip the devs ♥</button> <small>(a donation, not a prize)</small>
                <button type="button" className="link muted" onClick={() => { const s = loadTipJar(); saveTipJar({ ...s, never: true }); setTipNudge(false); }}>Don't show again</button>
              </p>
            )}
            <div className="bid-row">
              <button type="button" onClick={() => setShowPad(true)}>Score pad</button>
              <button type="button" data-testid="main-menu" onClick={mainMenu}>Main menu</button>
              <button type="button" onClick={leave}>Change mode</button>
              <button type="button" className="primary" onClick={() => onRematch(nextDealer(st))}>Rematch</button>
            </div>
          </div>
        </div>
      )}

      {(coachOn || help) && !modalOpen && (
        <Coach
          ctx={{ st, view, hand, legal, myTurn, me: HUMAN, partnerName: r.partnerships ? names[partnerOf(HUMAN, r) ?? 2] ?? null : null, pause, names }}
          onMarks={setTipMarked}
          help={help}
          onSkip={() => setTipsSkipped(true)}
          onOff={tipsOff}
          onCloseHelp={() => setHelp(false)}
          onOpen={setTipOpen}
        />
      )}

      {coachOn && !modalOpen && st.phase === 'playing' && !pause && <LedSuitChip st={st} />}
      <Hype reduced={reduceFx} low={settings.quality === 'low'} />
      {showPad && <ScorePad st={st} names={names} dealerName={dealerLabel} onClose={() => setShowPad(false)} onContinue={st.phase === 'handOver' && talkOpen && !online?.talk?.ready?.mine ? () => { setShowPad(false); apply({ type: 'nextHand' }); } : undefined} locked={online ? undefined : <LockedRulesPanel rules={r} nuke={fx.tableNuke ?? fx.prefs.nuke} skill={settings.botLevel} intensity={settings.talkIntensity} />} />}
    </div>
  );
}
