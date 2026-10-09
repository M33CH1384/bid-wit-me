import { type FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Card, type GameState, type TableRules, bidLabel, cardLabel, isJoker, isNilBid, isTrump, partnerOf, sideOf, sortHand, trumpOrder,
} from '@spades/rules';
import { HandSummary, ScorePad, sideName } from './Modals';
import { type Sfx, sound } from './audio';
import SoundButton from './SoundControls';
import { type ChatMsg, LINES, type Toast, TickNumber, USER_COLORS, pick, toastsFor } from './overlay';
import { type Settings, modeTitle } from './settings';
import type { SeatPos } from './three/layout';
import { HUMAN, useGame } from './useGame';
import { type SavedGame, clearGame, saveGame } from './save';

const Scene = lazy(() => import('./three/Scene'));

interface Props {
  rules: TableRules;
  seed: string;
  settings: Settings;
  onExit: () => void;
  onRematch: () => void;
  onQuality: (q: Settings['quality']) => void;
  /** A saved in-progress game to resume at exactly the same point. */
  resume?: SavedGame;
}

const NAMES4 = ['You', 'Marcus', 'Keisha', 'Dre'];
const NAMES3 = ['You', 'Marcus', 'Keisha'];

function positions(n: number): SeatPos[] {
  return n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'];
}

/* -------------------------------------------------------------- chat feed */
function useChat(st: GameState, names: string[], initial?: ChatMsg[]) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => initial ?? []);
  const prev = useRef<GameState | null>(initial ? st : null);
  const idRef = useRef(initial && initial.length ? Math.max(...initial.map((m) => m.id)) + 1 : 1);
  const timers = useRef<number[]>([]);
  const push = useCallback((user: string, text: string, system = false, delay = 0) => {
    const add = () => setMsgs((m) => [...m.slice(-60), { id: idRef.current++, user, text, system, color: USER_COLORS[user] ?? '#ddd' }]);
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
    if (st.phase === 'gameOver' && p.phase !== 'gameOver') {
      push('System', 'Game over', true);
      push(pick(bots), pick(LINES.gg), false, 800);
      push(pick(bots), pick(LINES.gg), false, 1600);
    }
  }, [st, names, bots, n, push]);

  return { msgs, push };
}

function ChatPanel({ msgs, open, onToggle, onSend, unread }: { msgs: ChatMsg[]; open: boolean; onToggle: () => void; onSend: (t: string) => void; unread: number }) {
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
      <button type="button" className={`chat-toggle ${open ? 'open' : ''}`} onClick={onToggle} aria-label="Toggle chat">
        💬{!open && unread > 0 && <span className="unread">{unread}</span>}
      </button>
      {!open && last && <div key={last.id} className="chat-ticker"><b style={{ color: last.color }}>{last.user}</b> {last.text}</div>}
      <aside className={`chat glass slant ${open ? 'open' : ''}`} aria-label="Table chat">
        <header><span className="live-dot" /> LIVE CHAT <small>local only</small></header>
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

/** Landing sound for a played card: always 'play'; + 'cut' when trumping a non-trump lead; + 'broken' (bigger, wins) for the first trump of the hand. */
export function landCueFor(st: GameState, card: Card): string {
  const r = st.rules;
  const tricks = [...st.tricks, st.trick];
  let firstTrump: Card | null = null;
  for (const t of tricks) for (const pl of t.plays) if (!firstTrump && isTrump(pl.card, r)) firstTrump = pl.card;
  for (const t of tricks) {
    const i = t.plays.findIndex((pl) => pl.card === card);
    if (i < 0) continue;
    if (card === firstTrump) return 'play,broken';
    if (i > 0 && isTrump(card, r) && !isTrump(t.plays[0]!.card, r)) return 'play,cut';
    return 'play';
  }
  return 'play';
}

export default function Table({ rules: initialRules, seed, settings, onExit, onRematch, onQuality, resume }: Props) {
  const { st, view, pause, error, apply, introHand, dealing, k } = useGame(initialRules, seed, settings.botLevel, settings.speed, resume?.state);
  const r = st.rules;
  const n = r.playerCount;
  const names = n === 4 ? NAMES4 : NAMES3;
  const pos = useMemo(() => positions(n), [n]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [exchangePick, setExchangePick] = useState<Card[]>([]);
  const [showPad, setShowPad] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 900);
  const [seenMsgs, setSeenMsgs] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { msgs, push } = useChat(st, names, resume?.chat);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const shownTrick = pause ? st.tricks[st.tricks.length - 1]! : st.trick;
  const piles = pause ? st.tricks.slice(0, -1) : st.tricks;
  const myTurn = !pause && !dealing && st.turn === HUMAN;
  const hand = useMemo(() => (view.hand ? sortHand(view.hand, r) : null), [view.hand, r]);
  const legal = myTurn && st.phase === 'playing' ? view.legal : [];
  const exchangeStep = st.phase === 'exchange' ? st.exchange[0] : undefined;
  const humanExchanging = myTurn && exchangeStep?.from === HUMAN;
  const mySide = sideOf(HUMAN, r);
  const winnerSeat = pause ? shownTrick.winner : null;
  useGameSounds(st, myTurn, mySide, msgs);
  const landCue = useCallback((c: Card) => landCueFor(st, c), [st]);

  // persist after every action (and chat line); a finished game clears the save
  useEffect(() => {
    if (st.phase === 'gameOver') clearGame();
    else saveGame({ seed, settings, state: st, chat: msgs });
  }, [st, msgs, seed, settings]);

  // "Resuming your game…" toast
  useEffect(() => {
    if (!resume) return;
    setToasts([{ id: -1, text: 'RESUMING YOUR GAME…', kind: 'info', sub: `Hand ${resume.state.handNo}` }]);
    const t = setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== -1)), 2600);
    return () => clearTimeout(t);
  }, [resume]);
  const leave = () => { clearGame(); onExit(); };

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
    return () => clearTimeout(tm);
  }, [st.history, r, names, mySide]);

  const trumps = useMemo(() => trumpOrder(r).slice(0, 5).map((c) => (c === 'BJ' ? 'BIG JKR' : c === 'LJ' ? 'LIL JKR' : cardLabel(c))), [r]);
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
        <div className="plate-avatar" style={{ ['--uc' as string]: USER_COLORS[names[seat]!] }}>{names[seat]![0]}</div>
        <div className="plate-body">
          <div className="plate-name">{names[seat]}{st.dealer === seat && <span className="chip dealer">D</span>}{partner && <span className="chip ally">PARTNER</span>}</div>
          <div className="plate-stats">
            <span className="chip">BID {b === null ? (isTurn && st.phase === 'bidding' ? '…' : '—') : bidLabel(b).toUpperCase()}</span>
            <span className="chip">TOOK {st.tricksWon[seat]}</span>
          </div>
        </div>
        {isTurn && <div className="plate-turn">{st.phase === 'bidding' ? 'BIDDING' : 'TO PLAY'}</div>}
      </div>
    );
  };

  const unread = Math.max(0, msgs.length - seenMsgs);

  return (
    <div className={`table-screen q-${settings.quality}`}>
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
        />
      </Suspense>

      {/* scorebug */}
      <header className="scorebug">
        <button type="button" className="bug-btn" onClick={() => (st.phase === 'gameOver' ? leave() : setConfirmLeave(true))} aria-label="Menu" data-testid="menu">☰</button>
        <div className="bug glass">
          <img className="bug-logo" src="/assets/bwm-wordmark-white.svg" alt="Bid Wit Me" />
          <div className={`bug-teams n${st.scores.length}`}>
            {st.scores.map((s, i) => (
              <div key={i} className={`bug-team ${i === mySide ? 'mine' : ''} ${st.result?.winners.includes(i) ? 'won' : ''}`}>
                <span className="bug-name">{r.partnerships ? (i === mySide ? 'YOU + KEISHA' : 'MARCUS + DRE') : names[i]!.toUpperCase()}</span>
                <TickNumber value={s} className="bug-score" />
                <span className="bug-bags">{st.bags[i]}<small>B</small></span>
              </div>
            ))}
          </div>
          <div className="bug-meta">
            <span>{modeTitle(r).toUpperCase()}</span>
            <span>HAND {st.handNo} · TO {r.targetScore}</span>
          </div>
        </div>
        <SoundButton />
        <button type="button" className="bug-btn" onClick={() => setShowPad(true)} aria-label="Score pad">📋</button>
        <button type="button" className="bug-btn q" onClick={() => onQuality(settings.quality === 'high' ? 'low' : 'high')} aria-label="Toggle graphics quality">{settings.quality === 'high' ? 'HQ' : 'LQ'}</button>
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
        {st.phase === 'exchange' && !humanExchanging && <div className="center-note">{names[exchangeStep!.from]} passes {exchangeStep!.count} to {names[exchangeStep!.to]}…</div>}
        {winnerSeat !== null && <div className="center-note win">{winnerSeat === HUMAN ? 'YOU TAKE IT' : `${names[winnerSeat]!.toUpperCase()} TAKES IT`}</div>}
      </div>

      {/* toasts */}
      <div className="toasts">
        {toasts.map((t, i) => (
          <div key={t.id} className={`toast ${t.kind}`} style={{ animationDelay: `${i * 0.18}s` }}>
            <span className="toast-text">{t.text}</span>
            {t.sub && <span className="toast-sub">{t.sub}</span>}
          </div>
        ))}
      </div>

      <ChatPanel msgs={msgs} open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} onSend={(t) => push('You', t)} unread={unread} />

      {/* the human's lower third + controls */}
      <section className="me">
        {myTurn && !dealing && st.phase === 'bidding' && view.bidOptions && (
          view.hand === null ? (
            <div className="bid-panel glass slant">
              <div className="panel-title">BLIND NIL?</div>
              <p>Bid before looking — worth ±{r.blindNil.value}.</p>
              <div className="bid-row">
                {view.bidOptions.blindNil && <button type="button" className="danger" onClick={() => apply({ type: 'bid', seat: HUMAN, bid: 'blindNil' })}>Blind Nil</button>}
                <button type="button" className="primary" onClick={() => apply({ type: 'reveal', seat: HUMAN })}>See my cards</button>
              </div>
            </div>
          ) : (
            <div className="bid-panel glass slant">
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
              <span className="chip">BID {st.bids[HUMAN] === null ? '—' : bidLabel(st.bids[HUMAN]).toUpperCase()}</span>
              <span className="chip">TOOK {st.tricksWon[HUMAN]}</span>
              {isNilBid(st.bids[HUMAN]) && st.tricksWon[HUMAN]! > 0 && <span className="chip bad">NIL BUSTED</span>}
            </div>
          </div>
          {myTurn && st.phase === 'playing' && <div className="plate-turn">{selected ? 'TAP AGAIN TO PLAY' : 'YOUR TURN'}</div>}
          {myTurn && st.phase === 'bidding' && <div className="plate-turn">YOUR BID</div>}
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

      {st.phase === 'handOver' && !pause && (
        <div className="modal-backdrop">
          <div className="modal glass slant">
            <div className="panel-title big">HAND {st.handNo} RESULTS</div>
            <div className="scroll"><HandSummary rec={st.history[st.history.length - 1]!} rules={r} names={names} /></div>
            <button type="button" className="primary big" onClick={() => apply({ type: 'nextHand' })}>Next hand</button>
          </div>
        </div>
      )}

      {confirmLeave && (
        <div className="modal-backdrop" onClick={() => setConfirmLeave(false)}>
          <div className="modal glass slant confirm" role="dialog" aria-label="Leave this game?" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title big">LEAVE THIS GAME?</div>
            <p className="muted">Your progress in this game will be lost.</p>
            <div className="bid-row">
              <button type="button" onClick={() => setConfirmLeave(false)}>Stay</button>
              <button type="button" className="primary" onClick={leave}>Leave</button>
            </div>
          </div>
        </div>
      )}

      {st.phase === 'gameOver' && !pause && st.result && (
        <div className="modal-backdrop">
          <div className="modal glass slant gameover">
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
              <button type="button" onClick={leave}>Change mode</button>
              <button type="button" className="primary" onClick={onRematch}>Rematch</button>
            </div>
          </div>
        </div>
      )}

      {showPad && <ScorePad st={st} names={names} onClose={() => setShowPad(false)} />}
    </div>
  );
}
