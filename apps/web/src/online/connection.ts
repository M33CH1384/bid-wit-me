/**
 * One WebSocket to a table's Durable Object, with automatic reconnect (exponential backoff, and immediately when
 * the tab becomes visible again — iOS Safari kills sockets in the background). The seat token makes every
 * reconnect land back in the same seat.
 */
import type { ChatLine, ClientMsg, RoomInfo, ServerMsg } from '@spades/protocol';
import type { PlayerView } from '@spades/rules';
import { wsUrl } from './config';
import { saveToken, tokenFor } from './identity';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'notFound';

export interface ConnState {
  status: ConnStatus;
  you: string | null;
  room: RoomInfo | null;
  seat: number | null;
  view: PlayerView | null;
  chat: ChatLine[];
  error: { code: string; message: string; at: number } | null;
}

type RtcHandler = (from: string, data: unknown) => void;

export class TableConnection {
  state: ConnState = { status: 'connecting', you: null, room: null, seat: null, view: null, chat: [], error: null };
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private rtcHandlers = new Set<RtcHandler>();
  private retry = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private stopped = false;

  constructor(public readonly code: string, private name: string) {
    this.onVisible = this.onVisible.bind(this);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
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
    const ws = new WebSocket(wsUrl(this.code));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', name: this.name, token: tokenFor(this.code), v: 1 } satisfies ClientMsg));
      if (this.pingTimer) clearInterval(this.pingTimer);
      // answered by the DO's auto-response without waking it (keeps mobile NATs/proxies from idling us out)
      this.pingTimer = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25_000);
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      let m: ServerMsg;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      switch (m.t) {
        case 'welcome':
          saveToken(this.code, m.token);
          this.set({ status: 'open', you: m.you, chat: m.chat });
          break;
        case 'state':
          this.set({ status: 'open', room: m.room, seat: m.seat, view: m.view });
          break;
        case 'chat':
          this.set({ chat: [...this.state.chat.slice(-99), m.line] });
          break;
        case 'rtc':
          this.rtcHandlers.forEach((h) => h(m.from, m.data));
          break;
        case 'error':
          this.set({ error: { code: m.code, message: m.message, at: Date.now() } });
          break;
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.stopped || ev.code === 4000) { this.set({ status: 'closed' }); return; }
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

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Simulate a network drop (used by tests / the debug menu). */
  dropForTest(): void {
    this.ws?.close();
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
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
