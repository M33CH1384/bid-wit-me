/**
 * Multi-client online test: 4 WebSocket clients (Node `ws`) create a table, sit, and play a FULL game through the
 * Worker (local `wrangler dev` or the deployed workers.dev URL). Each client decides its moves with the bot brain
 * from ITS OWN view only. Mid-game one client drops its socket and reconnects with its seat token.
 * Also checks: per-seat privacy (no foreign hands on the wire), chat round-trip, illegal-move rejection, and the
 * latency safety net: every move carries the game `seq` it was chosen from + an idempotency `id`; one move in flight
 * per client; deliberate duplicate sends / double clicks / a resend after reconnect must come back as dup/stale acks,
 * never as errors or double-applied moves.
 *
 * Usage: npx tsx scripts/online-clients.ts [serverUrl=http://127.0.0.1:8787] [mode=joker]
 */
import WebSocket from 'ws';
import { chooseBotAction } from '@spades/bots';
import { makeRules, type Card, type PlayerView } from '@spades/rules';
import type { ClientMsg, GameAction, RoomInfo, ServerMsg } from '@spades/protocol';

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const mode = process.argv[3] ?? 'joker';
const wsBase = base.replace(/^http/, 'ws');
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

class Client {
  ws!: WebSocket;
  token: string | undefined;
  you = '';
  room: RoomInfo | null = null;
  seat: number | null = null;
  view: PlayerView | null = null;
  chats: string[] = [];
  errors: string[] = [];
  /** acks that were rejections other than `stale` (= real problems) */
  badAcks: string[] = [];
  acks = { ok: 0, dup: 0, stale: 0 };
  inflight: { id: string; seq: number; action: GameAction } | null = null;
  nextId = 1;
  nextSent = '';
  bytes = 0;
  foreignCards = 0;
  closedByUs = false;
  waiters: (() => void)[] = [];
  constructor(public name: string, public code: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${wsBase}/api/tables/${this.code}/ws`);
      this.ws.on('open', () => {
        this.send({ t: 'hello', name: this.name, token: this.token });
        // resend a move that was in flight when the socket died: same id + seq → applied at most once
        if (this.inflight) this.send({ t: 'act', action: this.inflight.action, seq: this.inflight.seq, id: this.inflight.id });
      });
      this.ws.on('error', reject);
      this.ws.on('message', (buf) => {
        const s = buf.toString();
        this.bytes += s.length;
        const m = JSON.parse(s) as ServerMsg;
        if (m.t === 'welcome') { this.token = m.token; this.you = m.you; resolve(); }
        if (m.t === 'state') {
          this.room = m.room; this.seat = m.seat;
          if (this.inflight && m.room.seq > this.inflight.seq) this.inflight = null;
          this.view = m.view && m.view.history === null ? { ...m.view, history: this.view?.history ?? [] } : m.view;
          if (s.includes('"hands":[')) this.foreignCards++; // the full deal (array); the series record's "hands": <count> is fine
        }
        if (m.t === 'chat') this.chats.push(`${m.line.name}: ${m.line.text}`);
        if (m.t === 'error') this.errors.push(m.code);
        if (m.t === 'ack') {
          if (m.ok) this.acks[m.dup ? 'dup' : 'ok']++;
          else if (m.stale) this.acks.stale++;
          else this.badAcks.push(`${m.code}`);
          if (this.inflight?.id === m.id) this.inflight = null;
        }
        this.waiters.splice(0).forEach((f) => f());
      });
    });
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  /** like the web client: one move in flight, tagged with the game version it was chosen from */
  act(action: GameAction): string | null {
    if (this.inflight || !this.room) return null;
    const id = `${this.name}-${this.nextId++}`;
    this.inflight = { id, seq: this.room.seq, action };
    this.send({ t: 'act', action, seq: this.room.seq, id });
    return id;
  }
  drop() { this.closedByUs = true; this.ws.terminate(); }
  next(): Promise<void> { return new Promise((r) => this.waiters.push(r)); }
}

async function until(cond: () => boolean, ms = 15000, what = 'condition') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function toWire(a: NonNullable<ReturnType<typeof chooseBotAction>>): GameAction {
  if (a.type === 'reveal') return { type: 'reveal' };
  if (a.type === 'bid') return { type: 'bid', bid: a.bid };
  if (a.type === 'play') return { type: 'play', card: a.card };
  if (a.type === 'runIt') return { type: 'runIt' };
  return { type: 'exchange', cards: (a as { cards: Card[] }).cards };
}

const res = await fetch(`${base}/api/tables`, { method: 'POST' });
if (res.status !== 201) throw new Error(`create failed ${res.status}`);
const { code } = (await res.json()) as { code: string };
log('table', code);
const info = await (await fetch(`${base}/api/tables/${code}`)).json();
log('info', JSON.stringify(info));

const names = ['Demetrius', 'Ray', 'Kim', 'Jo'];
const cs = names.map((n) => new Client(n, code));
for (const c of cs) await c.connect();
const host = cs[0]!;
const rules = mode === 'cutthroat' ? makeRules('cutthroat', { playerCount: 4, deck: 'standard52' }) : makeRules(mode as 'joker' | 'aceDown');
host.send({ t: 'config', rules, botLevel: 'normal' });
cs.forEach((c, i) => c.send({ t: 'sit', seat: i }));
await until(() => cs.every((c) => c.room?.seats.every((s) => s.kind === 'human')), 10000, 'everyone seated');
log('seated', host.room!.seats.map((s) => (s.kind === 'human' ? s.name : s.kind)).join(', '));
cs[1]!.send({ t: 'chat', text: 'glhf from the test' });
await until(() => cs[3]!.chats.some((l) => l.includes('glhf')), 5000, 'chat');
cs[1]!.send({ t: 'start' });
await until(() => cs[1]!.errors.includes('NOT_HOST'), 5000, 'non-host start rejected');
// venue (Release 7): the host picks Random; the server rolls one at the start and everyone gets the same
host.send({ t: 'venue', venue: 'random' });
await until(() => cs.every((c) => c.room?.venue === 'random'), 5000, 'venue pick reaches everyone');
host.send({ t: 'start' });
await until(() => cs.every((c) => c.room?.phase === 'playing' && c.view), 10000, 'game start');
const venues = new Set(cs.map((c) => c.room!.venueNow));
if (venues.size !== 1 || !host.room!.venueNow || host.room!.venueNow === 'classic') throw new Error(`venue mismatch / not rolled: ${[...venues].join(',')}`);
log('started', host.room!.rules.mode, '· venue', host.room!.venueNow, '(Random, same for all 4)');

// illegal move: someone who's not on turn tries to move (a bid, or a card when the first hand's books bid themselves)
await until(() => cs.some((c) => c.view && c.view.turn !== null && c.view.turn !== c.seat), 10000, 'a turn after the deal');
const off = cs.find((c) => c.view && c.view.turn !== null && c.view.turn !== c.seat)!;
const offAction = off.view!.phase === 'bidding' ? { type: 'bid', bid: 3 } : { type: 'play', card: off.view!.hand![0] };
log('out-of-turn try', off.view!.phase, JSON.stringify(offAction));
off.send({ act: 1, t: 'act', action: offAction } as ClientMsg);
await until(() => off.errors.includes('NOT_YOUR_TURN'), 5000, `out-of-turn rejected (got ${JSON.stringify(off.errors)})`);

let actions = 0;
let reconnected = false;
let lastHand = 0;
const deadline = Date.now() + 10 * 60_000;
while (host.room?.phase === 'playing') {
  if (Date.now() > deadline) throw new Error('game took too long');
  // mid-game reconnect: after ~60 actions in hand 2+, when it's seat 2's turn, send its move and kill the socket
  // right away (the move may or may not have reached the server), then reconnect with the token and resend it
  const k = cs[2]!;
  if (!reconnected && actions > 60 && (host.view?.handNo ?? 0) >= 2 && k.view?.turn === k.seat && k.view.phase !== 'handOver' && !k.inflight) {
    const seatBefore = k.seat;
    const handBefore = k.view!.hand?.slice().sort().join();
    const a = chooseBotAction(k.view!, 'normal');
    if (a) { k.act(toWire(a)); actions++; }
    const pendingAct = k.inflight;
    k.drop();
    await until(() => host.room!.seats[2]!.kind === 'human' && !(host.room!.seats[2] as { connected: boolean }).connected, 5000, 'disconnect seen');
    log('seat 2 disconnected; others see connected=false');
    await new Promise((r) => setTimeout(r, 300));
    const k2 = new Client(k.name, code);
    k2.token = k.token;
    k2.inflight = pendingAct;
    k2.nextId = k.nextId;
    await k2.connect();
    await until(() => k2.view !== null && k2.inflight === null, 10000, 'state + resent move settled after reconnect');
    log(`resent in-flight move after reconnect → acks ${JSON.stringify(k2.acks)}`);
    if (k2.seat !== seatBefore || k2.you !== k.you) throw new Error('reconnect landed on a different seat');
    const handNow = k2.view!.hand?.slice().sort().join();
    log(`reconnected to seat ${k2.seat} (same player id: ${k2.you === k.you}; hand ${handNow === handBefore ? 'unchanged' : 'changed (the in-flight move was applied)'})`);
    cs[2] = k2;
    reconnected = true;
  }
  let acted = false;
  for (const c of cs) {
    const v = c.view;
    if (!v || c.room?.phase !== 'playing') continue;
    if (v.phase === 'handOver') {
      const key = `${c.room.game}:${v.handNo}`;
      if (!c.room.ready.includes(c.you) && c.nextSent !== key) { c.nextSent = key; c.send({ t: 'next' }); acted = true; }
      continue;
    }
    if (v.turn !== v.seat) continue;
    if (c.inflight) continue;
    const a = chooseBotAction(v, 'normal');
    if (!a) continue;
    const seq = c.room!.seq;
    const id = c.act(toWire(a))!;
    actions++;
    acted = true;
    // every so often, misbehave like a flaky network / impatient finger: resend the same id, or double-click
    if (actions % 17 === 0) c.send({ t: 'act', action: toWire(a), seq, id });
    if (actions % 23 === 0) c.send({ t: 'act', action: toWire(a), seq, id: `${id}-again` });
    await until(() => c.inflight === null, 10000, 'ack');
    break;
  }
  if (host.view && host.view.handNo !== lastHand) {
    lastHand = host.view.handNo;
    if (lastHand > 1) log(`hand ${lastHand - 1} done · scores ${host.view.history.at(-1)?.sides.map((s) => s.totalScore).join(' / ')}`);
  }
  if (!acted) await Promise.race([host.next(), new Promise((r) => setTimeout(r, 200))]);
  else await new Promise((r) => setTimeout(r, 5)); // let socket events in
}

await until(() => cs.every((c) => c.room?.phase === 'over'), 5000, 'everyone sees game over');
const v = host.view!;
log(`GAME OVER after ${v.history.length} hands, ${actions} client actions · final ${v.result!.finalScores.join(' / ')} · winners side ${v.result!.winners.join(',')} (${v.result!.endReason})`);
const kb = cs.reduce((a, c) => a + c.bytes, 0) / 1024;
log(`wire: ${kb.toFixed(0)} KB received across 4 clients; foreign-hand leaks: ${cs.reduce((a, c) => a + c.foreignCards, 0)}; reconnect tested: ${reconnected}`);
const acks = cs.reduce((a, c) => ({ ok: a.ok + c.acks.ok, dup: a.dup + c.acks.dup, stale: a.stale + c.acks.stale }), { ok: 0, dup: 0, stale: 0 });
log(`acks: ${acks.ok} applied, ${acks.dup} duplicate (ignored), ${acks.stale} stale (dropped + resynced)`);
const unexpected = [...cs.flatMap((c) => c.errors).filter((e) => e !== 'NOT_HOST' && e !== 'NOT_YOUR_TURN'), ...cs.flatMap((c) => c.badAcks)];
if (unexpected.length) throw new Error(`unexpected errors: ${unexpected.join(',')}`);
if (!reconnected) throw new Error('reconnect did not run');
cs.forEach((c) => c.ws.close());
log('PASS');
process.exit(0);
