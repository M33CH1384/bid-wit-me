import { speakBot } from '../talkPrefs';
import { fx } from '../fx';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Action, GameState, PlayerView } from '@spades/rules';
import { bidLabel, isFreshDeal } from '@spades/rules';
import type { ChatLine, RoomInfo } from '@spades/protocol';
import { NUKE_ALLOWANCE_MS, RUN_FX_MS } from '@spades/protocol';
import { isNukeTrick } from '@spades/rules';
import type { ChatMsg } from '../overlay';
import type { ConnState, TableConnection } from './connection';
import { type Rotation, rotateView } from './rotate';
import type { VideoMesh, VideoState } from './video';
import { dealTimeline } from '../three/dealTimeline';

export function useConn(conn: TableConnection): ConnState {
  return useSyncExternalStore(conn.subscribe, conn.getState);
}

const EMPTY_VIDEO: VideoState = { cam: false, mic: false, local: null, remote: {}, conn: {}, needsTap: true, muted: [], limited: [], music: {}, hidden: [], error: null, busy: false };
export function useVideo(mesh: VideoMesh | null): VideoState {
  return useSyncExternalStore(mesh ? mesh.subscribe : () => () => {}, mesh ? mesh.getState : () => EMPTY_VIDEO);
}

/** Shape-compatible with the offline `useGame` result, so the same <Table> renders online games. */
export interface GameSource {
  st: GameState;
  view: PlayerView;
  pause: boolean;
  error: string | null;
  apply: (a: Action) => void;
  restart: () => void;
  introHand: number | null;
  dealing: boolean;
  k: 1;
  /** a move is in flight (hand locked until the server acknowledges it) */
  locked?: boolean;
}

const TRICK_HOLD_MS = 1150;
/** same shuffle + deal animation length as offline at normal speed (server waits ~3.2 s before bots bid) */
const dealMs = (st: GameState) => dealTimeline(1, st.rules.playerCount, st.hands.reduce((a, h) => a + h.length, 0)).total * 1000 + 150;

/** Rotated server view → GameSource. Holds a just-finished trick on the table for a moment, like offline. */
export function useOnlineSource(cs: ConnState, conn: TableConnection): (GameSource & { rot: Rotation }) | null {
  // the game version travels with the view it belongs to, so a move is always tagged with the state it was chosen from
  const rotated = useMemo(() => (cs.view ? { ...rotateView(cs.view), seq: cs.room?.seq ?? 0 } : null), [cs.view]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pause, setPause] = useState(false);
  const [intro, setIntro] = useState<{ hand: number; until: number } | null>(null);
  const [, force] = useState(0);
  const prev = useRef<GameState | null>(null);
  const [shown, setShown] = useState(rotated);

  useEffect(() => {
    if (!rotated) { setShown(null); return; }
    const p = prev.current;
    prev.current = rotated.st;
    const st = rotated.st;
    if (p && p.handNo === st.handNo && st.tricks.length > p.tricks.length) setPause(true);
    const fresh = isFreshDeal(st) && st.tricks.length === 0;
    if ((p && st.handNo !== p.handNo) || (!p && fresh)) { setPause(false); setIntro({ hand: st.handNo, until: Date.now() + dealMs(st) }); }
    setShown(rotated);
  }, [rotated]);

  useEffect(() => {
    if (!pause) return;
    // 'Run it!': hold through the slam + tornado (the table shows the hand's end afterwards)
    const last = shown?.st.tricks.at(-1)?.plays ?? [];
    const ran = last.some((p) => p.run) ? RUN_FX_MS : 0;
    // a nuked trick stays on the table for the blast (the server waits the same allowance before the next lead)
    const nuke = isNukeTrick(last) ? NUKE_ALLOWANCE_MS[fx.tableNuke ?? 'full'] : 0;
    const t = setTimeout(() => setPause(false), TRICK_HOLD_MS + ran + nuke);
    return () => clearTimeout(t);
  }, [pause, shown?.st.tricks.length]);

  const dealing = !!intro && intro.hand === shown?.st.handNo && Date.now() < intro.until;
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => force((x) => x + 1), Math.max(0, intro.until - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [intro]);

  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!cs.error) return;
    setErr(cs.error.message);
    const t = setTimeout(() => setErr(null), 3500);
    return () => clearTimeout(t);
  }, [cs.error]);

  const seq = shown?.seq ?? 0;
  const apply = useCallback((a: Action) => {
    // conn.act() drops the move if another one is still in flight or this view is already outdated
    switch (a.type) {
      case 'reveal': conn.act({ type: 'reveal' }, seq); break;
      case 'bid': if (a.bid !== 'books') conn.act({ type: 'bid', bid: a.bid }, seq); break;
      case 'play': conn.act({ type: 'play', card: a.card }, seq); break;
      case 'exchange': conn.act({ type: 'exchange', cards: a.cards }, seq); break;
      case 'runIt': conn.act({ type: 'runIt' }, seq); break;
      case 'nextHand': conn.send({ t: 'next' }); break;
    }
  }, [conn, seq]);

  if (!shown) return null;
  return {
    st: shown.st, view: shown.view, rot: shown.rot, pause, error: err, apply, restart: () => {},
    introHand: intro && intro.hand === shown.st.handNo ? intro.hand : null, dealing, k: 1, locked: cs.pending,
  };
}

/* ------------------------------------------------------------------- chat */

/**
 * Collapse back-to-back system lines so they don't flood the chat: identical lines become "… ×N", and runs of
 * timeouts become one "⏱ Out of time: Niaaa ×2 · Dre" line. Returns null when the two lines don't merge.
 */
export function mergeSystem(prev: string, next: string): string | null {
  const TO = /^(.+) ran out of time$/;
  const tally = (t: string): Map<string, number> | null => {
    const m = TO.exec(t);
    if (m) return new Map([[m[1]!, 1]]);
    if (!t.startsWith('⏱ Out of time: ')) return null;
    const out = new Map<string, number>();
    for (const part of t.slice('⏱ Out of time: '.length).split(' · ')) { const [, who, n] = /^(.+?)(?: ×(\d+))?$/.exec(part)!; out.set(who!, Number(n ?? 1)); }
    return out;
  };
  const a = tally(prev), b = tally(next);
  if (a && b) {
    for (const [k, v] of b) a.set(k, (a.get(k) ?? 0) + v);
    return '⏱ Out of time: ' + [...a].map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(' · ');
  }
  const base = (t: string) => { const m = /^(.*) ×(\d+)$/.exec(t); return m ? { t: m[1]!, n: Number(m[2]) } : { t, n: 1 }; };
  const p = base(prev);
  if (p.t === next) return `${p.t} ×${p.n + 1}`;
  return null;
}

const PALETTE = ['#4fd1ff', '#ff6ad5', '#7dff9b', '#ff9f43', '#b892ff', '#5ef2d0', '#ff7a7a'];
export function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Real table chat (server) + local system lines for bids/hand results, in arrival order, in the overlay's format. */
export function useOnlineChat(cs: ConnState, st: GameState | null, names: string[], send: (text: string) => void) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const seen = useRef(new Set<number>());
  const localId = useRef(1_000_000);
  const prevSt = useRef<GameState | null>(null);

  const add = useCallback((m: Omit<ChatMsg, 'id'> & { id?: number }) => {
    setMsgs((xs) => {
      const last = xs[xs.length - 1];
      if (m.system && last?.system) {
        const merged = mergeSystem(last.text, m.text);
        if (merged) return [...xs.slice(0, -1), { ...last, text: merged }];
      }
      return [...xs.slice(-99), { id: m.id ?? localId.current++, ...m } as ChatMsg];
    });
  }, []);

  const primed = useRef(false);
  useEffect(() => {
    for (const l of cs.chat) {
      if (seen.current.has(l.id)) continue;
      seen.current.add(l.id);
      add(lineToMsg(l, cs.you));
      // live bot lines (not the backlog on join): voice + the Hustler reveal pop
      if (l.bot && primed.current) {
        speakBot(l.name, l.text, l.bot.persona, l.bot.line);
        if (l.bot.reveal) fx.emit('hustled', { text: `${l.name} was never new`, silent: false });
      }
    }
    if (cs.you) primed.current = true;
  }, [cs.chat, cs.you, add]);

  useEffect(() => {
    const p = prevSt.current;
    prevSt.current = st;
    if (!st || !p) return;
    if (st.handNo !== p.handNo) add({ user: 'System', text: `Hand ${st.handNo} · ${names[st.dealer]} deals`, system: true, color: '#b892ff' });
    st.bids.forEach((b, s) => {
      if (b !== null && p.bids[s] === null && p.handNo === st.handNo) add({ user: 'System', text: `${names[s]} bid ${bidLabel(b)}`, system: true, color: '#b892ff' });
    });
    if (st.history.length > p.history.length) {
      const rec = st.history[st.history.length - 1]!;
      add({ user: 'System', text: `Hand ${rec.handNo}: ${rec.sides.map((x) => `${x.seats.map((s) => names[s]).join('+')} ${x.points >= 0 ? '+' : ''}${x.points}`).join(' · ')}`, system: true, color: '#b892ff' });
    }
  }, [st, names, add]);

  const push = useCallback((_user: string, text: string) => send(text), [send]);
  return { msgs, push };
}

function lineToMsg(l: ChatLine, you: string | null): ChatMsg {
  if (l.system || !l.from) return { id: l.id, user: 'System', text: l.text, system: true, color: '#b892ff' };
  const mine = l.from === you;
  return { id: l.id, user: mine ? 'You' : l.name, text: l.text, color: mine ? '#f5c542' : colorFor(l.from), ...(l.bot ? { bot: true } : {}) };
}

/** Local-seat names: "You" at 0, then real names rotated. */
export function localNames(room: RoomInfo, rot: Rotation): string[] {
  return Array.from({ length: rot.n }, (_, i) => {
    if (i === 0) return 'You';
    const s = room.seats[rot.R(i)];
    return !s || s.kind === 'empty' ? `Seat ${rot.R(i) + 1}` : s.name;
  });
}

/** Countdown (seconds) to a deadline, re-rendering every second. */
export function useCountdown(deadline: number | null): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
