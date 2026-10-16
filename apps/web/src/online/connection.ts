/**
 * One WebSocket to a table's Durable Object, with automatic reconnect (exponential backoff, and immediately when
 * the tab becomes visible again — iOS Safari kills sockets in the background). The seat token makes every
 * reconnect land back in the same seat.
 */
import { TICKET_RETRY_MS, accountTicketState, clearAccountTicket } from '../social/store';
import type { ChatLine, ClientMsg, GameAction, RoomInfo, RunPlayback, ServerMsg } from '@spades/protocol';
import type { PlayerView } from '@spades/rules';
import { playSendBlocked } from './playGuard';
import { wsUrl } from './config';
import { guestSessionId, saveToken, tokenFor } from './identity';
import { JOIN_TIMEOUT_MS, type JoinFaultKind, type JoinStage, joinFaultLog, joinFaultMessage } from './joinTimeout';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'notFound';

export interface ConnState {
  status: ConnStatus;
  you: string | null;
  room: RoomInfo | null;
  seat: number | null;
  view: PlayerView | null;
  /** Public Run it! play-out (real seats), or null once the next hand starts. */
  run: RunPlayback | null;
  chat: ChatLine[];
  error: { code: string; message: string; at: number } | null;
  /** a move is in flight (sent, not yet acknowledged): the hand is locked so it can't be sent twice */
  pending: boolean;
  /** Bumps when a sent play is released (server seq moved, the play was rejected, or the ack timed out). */
  playGate?: number;
  /** Release 10: watching (unseated while a game is on; the view is the redacted spectator view) */
  spectator?: boolean;
  /** Signed in, but this socket's hello had no account ticket, so the seat is not linked. */
  statsOff: boolean;
  /** Set when the join cannot produce a room. The loader shows this instead of spinning. */
  joinFault: { message: string } | null;
}

interface PendingAct { id: string; seq: number; action: GameAction; sentAt: number }
/** A play's ping should be answered well inside this. No pong means the socket is open in name only. */
const PONG_WAIT_MS = 2500;
/** A signed-in ticket fetch must not hold the socket shut. Stats can link on a later hello. */
const TICKET_JOIN_MS = 4_000;
const newId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 36);

type RtcHandler = (from: string, data: unknown) => void;

export class TableConnection {
  state: ConnState = { status: 'connecting', you: null, room: null, seat: null, view: null, run: null, chat: [], error: null, pending: false, playGate: 0, statsOff: false, joinFault: null };
  private inflight: PendingAct | null = null;
  /** Seq of a play that has been sent and not yet passed by the server. A second play is refused until then. */
  private playSentSeq: number | null = null;
  private ackTimer: number | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private rtcHandlers = new Set<RtcHandler>();
  private retry = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private statsTimer: number | null = null;
  private stopped = false;
  /** hello on the open socket carried a ticket */
  private linked = false;
  /** close the socket so onclose opens a fresh one (ticket arrived, or the player tapped the chip) */
  private relink = false;
  private joinTimer: number | null = null;
  private joinStarted = 0;
  private joinStage: JoinStage = 'ticket';
  private openGen = 0;
  private ticketTimedOut = false;
  private lastClose: { code: number; reason: string } | null = null;
  /** Ticket from the hello that opened this socket, so a NOT_JOINED re-hello can carry it. */
  private helloTicket: string | null = null;
  /** One re-hello per socket when a play lands before the server has bound this connection. */
  private rehelloed = false;
  /** Set when the in-flight play's ping has not been answered yet. */
  private pongWait = false;
  /** How many times this in-flight move has been sent again without an ack. */
  private playResends = 0;
  /** Close this socket and open again immediately, keeping the in-flight move to resend. */
  private recover = false;

  constructor(public readonly code: string, private name: string) {
    this.onVisible = this.onVisible.bind(this);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
    this.joinStarted = Date.now();
    this.armJoinWatch();
    this.open();
  }

  private set(p: Partial<ConnState>): void {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f());
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  getState = (): ConnState => this.state;

  onRtc(h: RtcHandler): () => void {
    this.rtcHandlers.add(h);
    return () => this.rtcHandlers.delete(h);
  }

  private open(): void {
    if (this.stopped) return;
    // Signed in → a short-lived account ticket rides on hello. A slow account load must not
    // stick the seat as a guest: open now, then retry until the ticket links the seat.
    // A hung ticket fetch must not hold the socket shut for the whole join, either.
    if (this.opening) return;
    this.opening = true;
    this.joinStage = 'ticket';
    const gen = this.openGen;
    void this.ticketForJoin().then((r) => {
      this.opening = false;
      if (gen !== this.openGen || this.stopped) return;
      this.ticketTimedOut = !!r.ticketTimedOut;
      this.linked = !!r.ticket;
      this.set({ statsOff: r.statsOff });
      this.openWith(r.ticket);
      if (r.retry) this.armStatsRetry();
      else this.clearStatsRetry();
    });
  }
  private opening = false;

  private ticketForJoin(): Promise<{ ticket: string | null; retry: boolean; statsOff: boolean; ticketTimedOut?: boolean }> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: { ticket: string | null; retry: boolean; statsOff: boolean; ticketTimedOut?: boolean }) => {
        if (done) return;
        done = true;
        resolve(r);
      };
      const timer = window.setTimeout(() => finish({ ticket: null, retry: true, statsOff: false, ticketTimedOut: true }), TICKET_JOIN_MS);
      void accountTicketState().then((r) => { window.clearTimeout(timer); finish(r); }, () => {
        window.clearTimeout(timer);
        finish({ ticket: null, retry: true, statsOff: false, ticketTimedOut: true });
      });
    });
  }

  private joinTimeoutMs(): number {
    const n = (window as unknown as { __bwmJoinTimeoutMs?: number }).__bwmJoinTimeoutMs;
    return typeof n === 'number' && n >= 200 && n <= 60_000 ? n : JOIN_TIMEOUT_MS;
  }

  private armJoinWatch(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = window.setTimeout(() => this.noteJoinFault('timeout'), this.joinTimeoutMs());
  }

  private clearJoinWatch(): void {
    if (this.joinTimer) { clearTimeout(this.joinTimer); this.joinTimer = null; }
  }

  /** The table is gone. Shown as soon as the info request says so, ahead of the timeout. */
  markMissing(): void {
    this.noteJoinFault('missing');
  }

  /**
   * Try the join again without reloading the page. Drops the current socket and starts a new hello.
   */
  retryJoin(): void {
    if (this.stopped) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.retry = 0;
    this.joinStage = 'ticket';
    this.ticketTimedOut = false;
    this.lastClose = null;
    this.joinStarted = Date.now();
    this.openGen++;
    this.opening = false;
    this.clearJoinWatch();
    this.armJoinWatch();
    const ws = this.ws;
    this.ws = null;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    try { ws?.close(); } catch { /* already gone */ }
    this.set({ status: 'connecting', joinFault: null, error: null });
    this.open();
  }

  private noteJoinFault(kind: JoinFaultKind): void {
    if (this.state.room || this.state.joinFault || this.stopped) return;
    const input = {
      kind,
      stage: this.joinStage,
      status: this.state.status,
      serverCode: this.state.error?.code ?? null,
      serverMessage: this.state.error?.message ?? null,
      closeCode: this.lastClose?.code ?? null,
      closeReason: this.lastClose?.reason ?? null,
      ticketTimedOut: this.ticketTimedOut,
    };
    const message = joinFaultMessage(input);
    console.warn('[bwm] table join failed', joinFaultLog(this.code, { ...input, elapsedMs: Date.now() - this.joinStarted }));
    this.set({ joinFault: { message } });
  }

  private armStatsRetry(): void {
    if (this.statsTimer || this.stopped) return;
    this.statsTimer = window.setTimeout(() => {
      this.statsTimer = null;
      if (this.stopped || this.linked) return;
      if (this.opening) { this.armStatsRetry(); return; }
      void accountTicketState().then((r) => {
        if (this.stopped) return;
        this.set({ statsOff: r.statsOff });
        if (r.ticket && !this.linked) {
          this.linked = true;
          this.clearStatsRetry();
          this.relinkSocket();
          return;
        }
        if (r.retry) this.armStatsRetry();
      });
    }, TICKET_RETRY_MS);
  }

  private clearStatsRetry(): void {
    if (this.statsTimer) { clearTimeout(this.statsTimer); this.statsTimer = null; }
  }

  /** The player tapped the chip: drop the cached miss and hello again with a ticket. */
  relinkStats(): void {
    clearAccountTicket();
    this.linked = false;
    this.clearStatsRetry();
    this.relinkSocket();
  }

  private relinkSocket(): void {
    const ws = this.ws;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      this.relink = true;
      try { ws.close(); } catch { this.relink = false; this.open(); }
      return;
    }
    this.open();
  }

  private helloBody(ticket: string | null): ClientMsg {
    return { t: 'hello', name: this.name, token: tokenFor(this.code), gid: guestSessionId(), v: 1, ...(ticket ? { ticket } : {}) };
  }

  private openWith(ticket: string | null): void {
    if (this.stopped) return;
    this.joinStage = 'socket';
    this.helloTicket = ticket;
    this.rehelloed = false;
    const ws = new WebSocket(wsUrl(this.code));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify(this.helloBody(ticket)));
      // a move that was in flight when the socket dropped: resend it with the SAME id and seq. The server applies it
      // at most once (dup → ack ok) and drops it if the game moved on meanwhile (stale → fresh state).
      if (this.inflight) { ws.send(JSON.stringify(this.actMsg(this.inflight))); this.armAckTimer(); }
      if (this.pingTimer) clearInterval(this.pingTimer);
      // answered by the DO's auto-response without waking it (keeps mobile NATs/proxies from idling us out)
      this.pingTimer = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25_000);
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') { this.pongWait = false; return; }
      let m: ServerMsg;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      switch (m.t) {
        case 'welcome':
          saveToken(this.code, m.token);
          this.rehelloed = false;
          this.joinStage = 'welcome';
          this.set({ status: 'open', you: m.you, chat: m.chat });
          break;
        case 'state': {
          let view = m.view;
          // history is elided (null) when unchanged: reuse the copy we have
          if (view && view.history === null) view = { ...view, history: this.state.view?.history ?? [] };
          // the game moved past the version our in-flight move was based on: it was applied (or superseded)
          const settled = this.inflight !== null && m.room.seq > this.inflight.seq;
          if (settled) this.settle();
          const playAdvanced = this.playSentSeq !== null && m.room.seq > this.playSentSeq;
          if (playAdvanced) this.playSentSeq = null;
          this.clearJoinWatch();
          this.set({
            status: 'open', room: m.room, seat: m.seat, view, run: m.run ?? null, spectator: !!m.spectator, joinFault: null,
            ...(settled ? { pending: false } : {}),
            ...(playAdvanced ? { playGate: (this.state.playGate ?? 0) + 1 } : {}),
          });
          break;
        }
        case 'ack': {
          if (!this.inflight || m.id !== this.inflight.id) break; // an old ack (we already moved on)
          const wasPlay = this.inflight.action.type === 'play';
          const rejectedPlay = wasPlay && !m.ok && !m.stale;
          this.settle();
          // State is delivered before this ack. A play that changed the trick already cleared
          // playSentSeq. If it is still set, the trick did not move: the play was rejected, or it
          // was a repeat of the card already down. Open the hand either way.
          const unchangedPlay = wasPlay && !!m.ok && this.playSentSeq !== null;
          const release = rejectedPlay || unchangedPlay;
          if (release) this.playSentSeq = null;
          // stale/dup are normal under latency (the timer auto-played, a retry after reconnect): no error shown
          if (!m.ok && !m.stale && m.code) this.set({ pending: false, ...(release ? { playGate: (this.state.playGate ?? 0) + 1 } : {}), error: { code: m.code, message: m.message ?? m.code, at: Date.now() } });
          else this.set({ pending: false, ...(release ? { playGate: (this.state.playGate ?? 0) + 1 } : {}) });
          break;
        }
        case 'chat':
          this.set({ chat: [...this.state.chat.slice(-99), m.line] });
          break;
        case 'rtc':
          this.rtcHandlers.forEach((h) => h(m.from, m.data));
          break;
        case 'error':
          // A hibernated socket can wake with no player id. The play is rejected once;
          // say hello again on this same socket so the seat is rebound.
          if (m.code === 'NOT_JOINED' && ws.readyState === WebSocket.OPEN && !this.rehelloed) {
            this.rehelloed = true;
            ws.send(JSON.stringify(this.helloBody(this.helloTicket)));
            if (this.inflight) ws.send(JSON.stringify(this.actMsg(this.inflight)));
            break;
          }
          this.set({ error: { code: m.code, message: m.message, at: Date.now() } });
          // KICKED has its own screen. Any other error before the first state is the join failing.
          if (!this.state.room && m.code !== 'KICKED') this.noteJoinFault('server');
          break;
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.lastClose = { code: ev.code, reason: ev.reason };
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.relink) { this.relink = false; this.open(); return; }
      if (this.recover) {
        this.recover = false;
        this.retry = 0;
        this.set({ status: 'reconnecting' });
        this.open();
        return;
      }
      if (this.stopped || ev.code === 4000 || ev.code === 4003) {
        this.set({ status: 'closed' });
        // 4003 is the kick screen. 4000 with no room (replaced before state) must not spin forever.
        if (!this.stopped && !this.state.room && ev.code === 4000) this.noteJoinFault('server');
        return;
      }
      this.set({ status: 'reconnecting' });
      const delay = Math.min(10_000, 400 * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private onVisible(): void {
    if (document.visibilityState !== 'visible' || this.stopped) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retry = 0;
    this.open();
  }

  /**
   * Send a game move chosen from game version `seq` (the RoomInfo.seq of the state it was chosen from).
   * At most one move is in flight: while one is pending (or the move is based on an outdated version) this is a no-op.
   * Returns whether it was sent.
   */
  act(action: GameAction, seq: number): boolean {
    const room = this.state.room;
    // One play is in flight until the server's seq moves past it. A second tap must not send.
    if (action.type === 'play' && playSendBlocked(this.playSentSeq, room?.seq ?? seq)) return false;
    if (this.inflight || !room || seq !== room.seq) return false;
    this.inflight = { id: newId(), seq, action, sentAt: Date.now() };
    this.playResends = 0;
    if (action.type === 'play') this.playSentSeq = seq;
    this.set({ pending: true });
    // The socket may be down (reload, or the RECONNECTING banner). Keep the move and send it
    // on the next hello instead of swallowing the tap.
    if (this.ws?.readyState !== WebSocket.OPEN) {
      if (this.ws?.readyState !== WebSocket.CONNECTING && !this.opening) this.recoverSocket();
      return true;
    }
    this.ws.send(JSON.stringify(this.actMsg(this.inflight)));
    this.armAckTimer();
    return true;
  }

  /** seq is required: the server drops a move that doesn't say which game version it was chosen from. */
  private actMsg(p: PendingAct): ClientMsg {
    return { t: 'act', action: p.action, seq: p.seq, id: p.id };
  }

  private armAckTimer(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.pongWait = true;
    try { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping'); } catch { /* closing */ }
    this.ackTimer = window.setTimeout(() => this.onActQuiet(), PONG_WAIT_MS);
  }

  /**
   * The play was sent and no ack came back. A pong only proves the socket, not that the table
   * applied the card — the auto-pong answers without waking the game. Send the same move again.
   * A socket with no pong is reopened. After several tries, unlock so they can choose again.
   */
  private onActQuiet(): void {
    this.ackTimer = null;
    if (!this.inflight) return;
    const ws = this.ws;
    const open = !!ws && ws.readyState === WebSocket.OPEN;
    if (this.playResends < 4) {
      this.playResends++;
      if (!open || this.pongWait) { this.recoverSocket(); return; }
      try { ws.send(JSON.stringify(this.actMsg(this.inflight))); } catch { this.recoverSocket(); return; }
      this.armAckTimer();
      return;
    }
    const play = this.inflight.action.type === 'play';
    this.inflight = null;
    this.playResends = 0;
    if (play) this.playSentSeq = null;
    this.set({ pending: false, ...(play ? { playGate: (this.state.playGate ?? 0) + 1 } : {}) });
  }

  /** The socket looks open and is not. Reconnect now and resend the same move on the new hello. */
  private recoverSocket(): void {
    if (this.stopped || this.recover) return;
    this.recover = true;
    const ws = this.ws;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(); return; } catch { /* open below */ }
    }
    this.recover = false;
    this.retry = 0;
    this.open();
  }

  private settle(): void {
    this.inflight = null;
    if (this.ackTimer) { clearTimeout(this.ackTimer); this.ackTimer = null; }
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Simulate a network drop (used by tests / the debug menu). */
  dropForTest(): void {
    this.ws?.close();
  }

  close(): void {
    this.stopped = true;
    this.clearJoinWatch();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.clearStatsRetry();
    this.settle();
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    this.ws?.close(1000, 'bye');
    this.listeners.clear();
    this.rtcHandlers.clear();
  }
}

/** Ask the server whether a table exists (join screen). */
export async function tableInfo(server: string, code: string): Promise<{ exists: boolean; phase?: string; mode?: string; seats?: { kind: string; name?: string }[]; host?: string | null }> {
  const r = await fetch(`${server}/api/tables/${code}`);
  if (r.status === 404) return { exists: false };
  if (!r.ok) throw new Error(`server error ${r.status}`);
  return r.json();
}

export async function createTable(server: string): Promise<string> {
  const r = await fetch(`${server}/api/tables`, { method: 'POST' });
  if (!r.ok) throw new Error(`Could not create a table (${r.status})`);
  return ((await r.json()) as { code: string }).code;
}
