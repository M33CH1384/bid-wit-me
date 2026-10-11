import { type FormEvent, type ReactNode, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type Card, type GameState, type PlayerView, type Play, type TableRules, radioactiveBigJoker, isNukeTrick, nextDealer, bidLabel, booksHand, cardLabel, isJoker, isNilBid, isTrump, partnerOf, sideOf, sortHand, trumpOrder,
} from '@spades/rules';
import { ScorePad, defaultSideName, setTeamNames, sideName } from './Modals';
import { type Series, addSeriesGame, seriesSides, summarizeGame } from '@spades/rules';
import { SeriesChip, SeriesSheet, loadSeries, saveSeries } from './Series';
import { TeamNameField, myTeamName, useMyTeamName } from './TeamName';
import { offlineTalk } from './offlineTalk';
import { showLine, speakBot, useTalkPrefs } from './talkPrefs';
import { pickTeamName } from '@spades/protocol';
import { Intermission, calloutsFor } from './Intermission';
import Hype from './Hype';
import { landCueFor, wheelsFor, wheelsMade, wheelsTenth, wheelsTenthBooks } from './landCue';
import Feedback from './Feedback';
import { setFeedbackGame } from './feedbackContext';
import { loadTipJar, openTip, saveTipJar, tipNudgeDue } from './support';
import { OfflineMediaBar } from './online/Media';
import { fireCue, fx, useReduceEffects } from './fx';
import { type Sfx, sound } from './audio';
import { type ChatMsg, LINES, SEAT_COLORS, TALK_LINES, type Toast, TickNumber, USER_COLORS, pick, toastsFor } from './overlay';
import { type Settings, modeTitle } from './settings';
import type { SeatPos } from './three/layout';
import { HUMAN, useGame } from './useGame';
import { type SavedGame, clearGame, saveGame } from './save';

import { useViewport } from './viewport';
import { Coach, LedSuitChip } from './Coach';
import { type TipsPref, bumpTip, loadTips, saveTips, tipCount } from './tips';
import { BidCoach } from './BidCoach';
import { RUN_FX_MS } from '@spades/protocol';
import { BADGES, award, runItTipDue, runItTipShown, runItUsed, useBadges } from './badges';
import { personaForName, personaSkillFloor, personaTag, pickBotNames, seatSkill } from '@spades/bots';
import { preloadPersona } from './voices/voices';
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
  const push = useCallback((user: string, text: string, system = false, delay = 0, bot = false) => {
    const add = () => setMsgs((m) => [...m.slice(-60), { id: idRef.current++, user, text, system, color: USER_COLORS[user] ?? SEAT_COLORS[namesRef.current.indexOf(user)] ?? '#ddd', ...(bot ? { bot: true } : {}) }]);
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
      if (talkOn()) {
        push(pick(bots), pick(LINES.start), false, 900);
        push(pick(bots), pick(['yo', 'what up', '👋', 'ready']), false, 1700);
      }
      return;
    }
    if (st.handNo !== p.handNo) push('System', `Hand ${st.handNo} · ${names[st.dealer]} deals`, true);
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
      if (ran.length) push('System', `🌪 ${names[ran[0]!.plays[0]!.seat]} ran the board (+${ran.length} books)`, true);
      else if (t.plays.some((x) => x.auto)) push('System', '☢ Nuked — remaining cards auto-played', true);
    }
    // hand scored
    if (st.history.length > p.history.length) {
      const rec = st.history[st.history.length - 1]!;
      push('System', `Hand ${rec.handNo}: ${rec.sides.map((s) => `${sideName(r, s.side, names)} ${s.points >= 0 ? '+' : ''}${s.points}`).join(' · ')}`, true);
      for (const w of wheelsMade(r, rec)) push('System', `🏎 Wheels made! ${sideName(r, w.side, names)} bid ${w.bid} and took ${w.books}`, true);
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
    if (st.phase === 'gameOver' && p.st.phase !== 'gameOver' && st.result) sound.play(st.result.winners.includes(mySide) ? 'win' : 'lose', { delay: 0.3 + (runPlays(st).length && runPlays(p.st).length === 0 ? RUN_FX_MS / 1000 : 0) });
  }, [st, myTurn, mySide, msgs]);
}

export { landCueFor } from './landCue';

/** The plays of this hand recorded by 'Run it!' (empty if nobody ran it). */
function runPlays(st: GameState): Play[] { return st.tricks.flatMap((t) => t.plays.filter((p) => p.run)); }

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
  const levelFor = useCallback((seat: number) => seatSkill(settings.botLevel, seed, seat, personaSkillFloor(botNames[seat] ?? '')), [settings.botLevel, seed, botNames]);
  const { st, view, pause, error, apply, introHand, dealing, k } = online ? online.source : useGame(initialRules, seed, levelFor, speed, resume?.state, learning && tipOpen, startDealer);
  useEffect(() => { online?.setLearning?.(learning); }, [learning]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = st.rules;
  const n = r.playerCount;
  const names = online?.names ?? botNames;
  const pos = useMemo(() => positions(n), [n]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [exchangePick, setExchangePick] = useState<Card[]>([]);
  const [showPad, setShowPad] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 900 && window.innerHeight > 600);
  const [seenMsgs, setSeenMsgs] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const localChat = useChat(st, names, resume?.chat);
  const { msgs: rawMsgs, push } = online ? online.chat : localChat;
  const talkPrefs = useTalkPrefs();
  // bot trash talk: masked per Clean talk, hidden entirely with 'Hide bot trash talk' (local preferences)
  const msgs = useMemo(() => (talkPrefs.hideBotTalk ? rawMsgs.filter((m) => !m.bot) : rawMsgs.map((m) => (m.bot ? { ...m, text: showLine(m.text) } : m))), [rawMsgs, talkPrefs.hideBotTalk, talkPrefs.cleanTalk]); // eslint-disable-line react-hooks/exhaustive-deps

  // team names (team modes): yours from More options offline, the bots' a random fun one (kept in the save)
  const myName = useMyTeamName();
  const [botTeam] = useState(() => resume?.teamNames?.[1] ?? pickTeamName(Math.abs([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))));
  const teamNames: (string | null)[] | null = !r.partnerships ? null : online ? (online.teamNames ?? [null, null]) : [myName || null, botTeam];
  setTeamNames(teamNames); // sideName() everywhere (scorebug, results, Table Talk, Victory, score pad) uses these
  useEffect(() => () => setTeamNames(null), []);

  // offline trash talk: same engine as the server
  useEffect(() => {
    if (online) return;
    offlineTalk.table = { seats: names.map((nm, i) => ({ name: nm, bot: i !== HUMAN })), partnerships: r.partnerships, teamNames: Array.from({ length: st.scores.length }, (_, i) => sideName(r, i, names)) };
  });
  useEffect(() => {
    if (online) return;
    if (!resume) offlineTalk.newGame();
    offlineTalk.sink = (l) => {
      localChat.push(l.name, l.text, false, 0, true);
      speakBot(l.name, l.text, l.persona, l.line);
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
  const teamEdit = r.partnerships && (online ? online.setTeamName : true) ? (
    <TeamNameField
      value={(teamNames?.[sideOf(HUMAN, r)] ?? '') || ''}
      placeholder={defaultSideName(r, sideOf(HUMAN, r), names)}
      onSave={(v) => (online ? online.setTeamName?.(v) : myTeamName.set(v))}
      testId="tt-team-name"
    />
  ) : null;
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
  const myTurn = !pause && !dealing && !(online?.source.locked) && st.turn === HUMAN;
  const hand = useMemo(() => (view.hand ? sortHand(view.hand, r) : null), [view.hand, r]);
  // cards stay face-down only while Blind Nil is actually on offer; otherwise just turn them over (no button)
  const autoReveal = myTurn && !dealing && st.phase === 'bidding' && view.hand === null && !!view.bidOptions && !view.bidOptions.blindNil;
  useEffect(() => { if (autoReveal) apply({ type: 'reveal', seat: HUMAN }); }, [autoReveal]); // eslint-disable-line react-hooks/exhaustive-deps
  const legal = myTurn && st.phase === 'playing' ? view.legal : [];
  const exchangeStep = st.phase === 'exchange' ? st.exchange[0] : undefined;
  const humanExchanging = myTurn && exchangeStep?.from === HUMAN;
  const mySide = sideOf(HUMAN, r);
  // ---- 'Run it!': on a run, the table keeps showing the moment before it while the claimer's cards slam down and
  // the tornado rips every hand + the table into the funnel; then the (finished) hand shows with an empty table.
  type RunFx = { id: number; before: { st: GameState; view: PlayerView }; claimer: number; cards: Card[]; books: number };
  const [seen, setSeen] = useState<{ st: GameState; view: PlayerView }>(() => ({ st, view }));
  const [runFx, setRunFx] = useState<RunFx | null>(null);
  if (seen.st !== st) {
    const b = seen.st;
    if (b.handNo === st.handNo && st.tricks.length > b.tricks.length && st.tricks[b.tricks.length]!.plays.some((p) => p.run)) {
      const fresh = st.tricks.slice(b.tricks.length);
      const claimer = fresh[0]!.plays[0]!.seat;
      setRunFx({ id: Date.now(), before: seen, claimer, cards: fresh.flatMap((t) => t.plays.filter((p) => p.seat === claimer).map((p) => p.card)), books: fresh.length });
    }
    setSeen({ st, view });
  }
  const [badgeToast, setBadgeToast] = useState<string | null>(null);
  const endRun = useCallback(() => { fx.tornado = null; sound.stopTornado(); setRunFx(null); }, []);
  useEffect(() => {
    if (!runFx) return;
    const slamS = 0.08 + 0.13 * (runFx.cards.length - 1) + 0.25;
    fx.tornado = { start: performance.now() + slamS * 1000, reduced: fx.reduced };
    const who = runFx.claimer === HUMAN ? 'You' : names[runFx.claimer]!;
    fx.emit('ranIt', { text: 'RAN IT!', sub: `${who} · +${runFx.books} book${runFx.books === 1 ? '' : 's'}`, silent: true });
    sound.play('tornado', { delay: Math.max(0, slamS - 0.3) });
    // (capture scripts set __bwmHoldRun to step the tornado frame by frame via fx.warp)
    const hold = !!(window as unknown as { __bwmHoldRun?: boolean }).__bwmHoldRun;
    const timers = hold ? [] : [window.setTimeout(endRun, (slamS + 2.1) * 1000)];
    (window as unknown as { __bwmEndRun?: () => void }).__bwmEndRun = endRun;
    if (runFx.claimer === HUMAN) {
      runItUsed();
      if (award('storm-chaser', { mode: r.mode, online: !!online, hand: runFx.before.st.handNo, books: runFx.books })) pendingBadge.current = 'storm-chaser';
    }
    return () => { timers.forEach(clearTimeout); fx.tornado = null; };
  }, [runFx]); // eslint-disable-line react-hooks/exhaustive-deps
  // a badge earned by the run unlocks once the tornado is over (or skipped)
  const pendingBadge = useRef<string | null>(null);
  useEffect(() => {
    if (runFx || !pendingBadge.current) return;
    setBadgeToast(pendingBadge.current); pendingBadge.current = null; sound.play('made');
    const t = window.setTimeout(() => setBadgeToast(null), 3800);
    return () => clearTimeout(t);
  }, [runFx]);
  const ranHand = useMemo(() => runPlays(st).length > 0, [st]);
  // the scoreboard (scores, bags, books taken, result) holds the pre-run numbers until the tornado is over
  const sb = runFx ? runFx.before.st : st;
  const winnerSeat = pause && !ranHand ? shownTrick.winner : null;
  // the Run it! button + its one-time spotlight tip
  const canRun = myTurn && !dealing && st.phase === 'playing' && !!view.canRunIt && !runFx;
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
      return {
        hand: runFx.claimer === HUMAN ? (bh?.filter((c) => !runFx.cards.includes(c)) ?? null) : bh,
        counts: b.view.handCounts.map((c, i) => (i === runFx.claimer ? 0 : c)),
        trick: b.st.trick.plays, piles: b.st.tricks, slam: { seat: runFx.claimer, cards: runFx.cards },
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
  const helpButton = (
    <button type="button" className={`bug-btn help-btn ${help ? 'on' : ''}`} data-testid="help" aria-label="Help: tips and book counting" aria-pressed={help} onClick={() => setHelp(!help)}>?</button>
  );

  // persist after every action (and chat line); a finished game clears the save
  useEffect(() => {
    if (online) return; // online games live on the server (seat token in localStorage), not in the offline save
    if (st.phase === 'gameOver') clearGame();
    else saveGame({ seed, settings, state: st, chat: rawMsgs, names, teamNames: [null, botTeam] });
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
  useEffect(() => { setExchangePick([]); }, [st.phase, st.turn]);
  useEffect(() => { if (chatOpen) setSeenMsgs(msgs.length); }, [chatOpen, msgs.length]);

  // BID MADE / SET / NIL! toasts
  const lastHist = useRef(st.history.length);
  const [histTick, setHistTick] = useState(0);
  const ranWaited = useRef(-1);
  useEffect(() => {
    if (st.history.length <= lastHist.current) { lastHist.current = st.history.length; return; }
    lastHist.current = st.history.length;
    // after 'Run it!' the scoring toasts wait for the tornado
    const ranDelay = st.tricks.at(-1)?.plays.some((p) => p.run) ? RUN_FX_MS : 0;
    if (ranDelay && ranWaited.current !== st.history.length) {
      const len = st.history.length;
      const t0 = window.setTimeout(() => { ranWaited.current = len; lastHist.current = len - 1; setHistTick((x) => x + 1); }, ranDelay);
      return () => clearTimeout(t0);
    }
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
    // Wheels made: a team that bid 10+ together and took 10+ books → the supercar peel-out
    const made = wheelsMade(r, rec);
    if (made.length) {
      const w = made[0]!;
      timers.push(window.setTimeout(() => fx.emit('wheelsCar', { text: `${sideName(r, w.side, names)} made ${w.bid} · took ${w.books}` }), shot ? 3300 : streak ? 2600 : 600));
    }
    if (streak) timers.push(window.setTimeout(() => fx.emit('streak', { level: streak.level, text: streak.text.split(' · ')[0], sub: streak.text.split(' · ')[1] }), shot ? 1750 : 400));
    return () => { clearTimeout(tm); timers.forEach(clearTimeout); };
  }, [st.history, histTick, r, names, mySide]); // eslint-disable-line react-hooks/exhaustive-deps

  // Table Talk shows a beat after scoring, so the toasts / pop-ups land on the table first
  const [talkOpen, setTalkOpen] = useState(false);
  useEffect(() => {
    if (st.phase !== 'handOver' || pause || runFx) { setTalkOpen(false); return; }
    const t = window.setTimeout(() => setTalkOpen(true), resume || online ? 900 : 1500);
    return () => clearTimeout(t);
  }, [st.phase, st.handNo, pause, !!runFx]); // eslint-disable-line react-hooks/exhaustive-deps
  const talkSend = (text: string) => {
    push('You', text);
    const replies = TALK_LINES.replies[text];
    if (!online && replies) { const bots = names.slice(1); push(pick(bots), pick(replies), false, 900 + Math.random() * 700); }
  };
  const reduceFx = useReduceEffects();
  // last trick: Big Joker down, Little Joker still out → radioactive pulse + Geiger crackle until the trick resolves
  const radioactive = radioactiveBigJoker(st);
  // nuke watchdog: the blast is normally cued by the second Joker's 3D landing; on a stalled renderer (Safari compiling
  // shaders, a backgrounded tab, very slow frames) that landing can come late or never — so once a nuked trick is on
  // the table, make sure the nuke fires anyway (fx dedupes, so it never plays twice).
  const nukeKey = isNukeTrick(shownTrick.plays) && !display.slam ? `${st.seed}:${st.handNo}:${shownTrick.plays.map((p) => p.card).join('')}` : null;
  const nukeAtMount = useRef(nukeKey); // a resumed save already showing a nuked trick doesn't re-fire
  useEffect(() => {
    if (!nukeKey || nukeKey === nukeAtMount.current) return;
    const t = window.setTimeout(() => fireCue('nuke'), 1100);
    return () => clearTimeout(t);
  }, [nukeKey]);
  useEffect(() => { sound.geiger(radioactive); return () => sound.geiger(false); }, [radioactive]);
  // any modal up: the table, plates, chat, video bubbles etc. dim + blur behind it and can't paint over it
  const modalOpen = (st.phase === 'handOver' && !pause && talkOpen) || confirmLeave || showPad || (st.phase === 'gameOver' && !pause && !runFx && !!st.result);

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

  const isBotSeat = (seat: number) => (online ? !!online.botSeats?.includes(seat) : seat !== HUMAN);
  // recorded bot voices: fetch a persona's clips when one of its bots sits down
  const botKey = names.map((nm, i) => (isBotSeat(i) ? nm : '')).join('|');
  useEffect(() => {
    if (!talkPrefs.voices) return;
    names.forEach((nm, i) => { if (isBotSeat(i)) preloadPersona(personaForName(nm), talkPrefs.cleanTalk); });
  }, [botKey, talkPrefs.voices]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderSeat = (seat: number) => {
    const isTurn = st.turn === seat && !pause && st.phase !== 'handOver' && st.phase !== 'gameOver';
    const partner = r.partnerships && seat === partnerOf(HUMAN, r);
    const b = st.bids[seat];
    return (
      <div className={`plate ${isTurn ? 'turn' : ''} ${partner ? 'ally' : 'foe'}`} data-testid={`seat-${seat}`} title={isBotSeat(seat) ? `${names[seat]} · ${personaTag(names[seat]!, revealed.includes(seat))}` : undefined} data-persona={isBotSeat(seat) ? personaTag(names[seat]!, revealed.includes(seat)) : undefined}>
        <div className="plate-avatar" style={{ ['--uc' as string]: SEAT_COLORS[seat] }}>{names[seat]![0]}</div>
        <div className="plate-body">
          <div className="plate-name">{names[seat]}{st.dealer === seat && <span className="chip dealer">D</span>}{partner && <span className="chip ally">PARTNER</span>}</div>
          <div className="plate-stats">
            <span className="chip">{b === 'books' ? 'BOOKS' : `BID ${b === null ? (isTurn && st.phase === 'bidding' ? '…' : '—') : bidLabel(b).toUpperCase()}`}</span>
            <span className="chip">TOOK {sb.tricksWon[seat]}</span>
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
          myHand={display.hand}
          handCounts={display.counts}
          shownTrick={display.trick}
          slam={display.slam}
          radioactive={radioactive}
          reduceFx={reduceFx}
          piles={display.piles}
          legal={runFx ? [] : humanExchanging && hand ? hand : legal}
          selected={runFx ? null : selected}
          turnSeat={runFx || pause || st.phase === 'handOver' || st.phase === 'gameOver' ? null : st.turn}
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

      {/* scorebug */}
      <header className="scorebug">
        <button type="button" className="bug-btn" onClick={() => (online || st.phase === 'gameOver' ? leave() : setConfirmLeave(true))} aria-label="Menu" data-testid="menu">☰</button>
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
            <span className="ts-label">TRUMPS</span>{trumpsShort.join('›')}{st.spadesBroken && <i className="bt-broken" title="Spades broken">BROKEN</i>}
          </div>
          <div className="bug-meta">
            <span className="bug-mode">{modeTitle(r).toUpperCase()}</span>
            {seriesChip('in-meta')}
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
            <div className="plate-name">YOU{st.dealer === HUMAN && <span className="chip dealer">D</span>}{myBadges.map((b) => BADGES[b.id] && <span key={b.id} className="chip badge" title={`${BADGES[b.id]!.name}: ${BADGES[b.id]!.desc}`} data-testid={`plate-badge-${b.id}`}>{BADGES[b.id]!.icon}</span>)}</div>
            <div className="plate-stats">
              <span className="chip">{st.bids[HUMAN] === 'books' ? 'BOOKS' : `BID ${st.bids[HUMAN] === null ? '—' : bidLabel(st.bids[HUMAN]).toUpperCase()}`}</span>
              <span className="chip">TOOK {sb.tricksWon[HUMAN]}</span>
              {isNilBid(st.bids[HUMAN]) && sb.tricksWon[HUMAN]! > 0 && <span className="chip bad">NIL BUSTED</span>}
            </div>
          </div>
          {myTurn && st.phase === 'playing' && <div className="plate-turn">{selected ? 'TAP AGAIN TO PLAY' : 'YOUR TURN'}</div>}
          {myTurn && st.phase === 'bidding' && <div className="plate-turn">YOUR BID</div>}
          {online?.seatExtra(HUMAN)}
        </div>
        {error && <div className="err">{error}</div>}
      </section>
      {canRun && <RunItButton tip={runTip} onDismissTip={() => setRunTip(false)} onRun={() => { setRunTip(false); setSelected(null); apply({ type: 'runIt', seat: HUMAN }); }} />}
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
          series={seriesChip()}
          teamEdit={teamEdit}
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

      {st.phase === 'gameOver' && !pause && !runFx && st.result && (
        <div className="modal-backdrop">
          <div className="modal glass slant gameover" role="dialog" aria-label="Game over">
            <button type="button" className="modal-x" aria-label="Close and go to the main menu" data-testid="gameover-x" onClick={mainMenu}>✕</button>
            <div className="trophy">{st.result.winners.includes(mySide) ? '🏆' : '♠'}</div>
            <h2>{st.result.winners.includes(mySide) ? (st.result.winners.length > 1 ? 'YOU TIED FOR FIRST!' : 'VICTORY!') : `${st.result.winners.map((w) => sideName(r, w, names)).join(' & ').toUpperCase()} WIN${r.partnerships || st.result.winners.length > 1 ? '' : 'S'}`}</h2>
            {seriesChip()}
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
      {showPad && <ScorePad st={st} names={names} onClose={() => setShowPad(false)} />}
    </div>
  );
}
