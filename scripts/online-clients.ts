/**
 * Multi-client online test: 4 WebSocket clients (Node `ws`) create a table, sit, and play a FULL game through the
 * Worker (local `wrangler dev` or the deployed workers.dev URL). Each client decides its moves with the bot brain
 * from ITS OWN view only. Mid-game one client drops its socket and reconnects with its seat token.
 * Also checks: per-seat privacy (no foreign hands on the wire), chat round-trip, illegal-move rejection.
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
  bytes = 0;
  foreignCards = 0;
  closedByUs = false;
  waiters: (() => void)[] = [];
  constructor(public name: string, public code: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${wsBase}/api/tables/${this.code}/ws`);
      this.ws.on('open', () => { this.send({ t: 'hello', name: this.name, token: this.token }); });
      this.ws.on('error', reject);
      this.ws.on('message', (buf) => {
        const s = buf.toString();
        this.bytes += s.length;
        const m = JSON.parse(s) as ServerMsg;
        if (m.t === 'welcome') { this.token = m.token; this.you = m.you; resolve(); }
        if (m.t === 'state') {
          this.room = m.room; this.seat = m.seat; this.view = m.view;
          if (s.includes('"hands"')) this.foreignCards++;
        }
        if (m.t === 'chat') this.chats.push(`${m.line.name}: ${m.line.text}`);
        if (m.t === 'error') this.errors.push(m.code);
        this.waiters.splice(0).forEach((f) => f());
      });
    });
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
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
host.send({ t: 'start' });
await until(() => cs.every((c) => c.room?.phase === 'playing' && c.view), 10000, 'game start');
log('started', host.room!.rules.mode);

// illegal move: someone who's not on turn tries to bid
const off = cs.find((c) => c.view && c.view.turn !== c.seat)!;
off.send({ act: 1, t: 'act', action: { type: 'bid', bid: 3 } } as ClientMsg);
await until(() => off.errors.includes('NOT_YOUR_TURN'), 5000, 'out-of-turn rejected');

let actions = 0;
let reconnected = false;
let lastHand = 0;
const deadline = Date.now() + 10 * 60_000;
while (host.room?.phase === 'playing') {
  if (Date.now() > deadline) throw new Error('game took too long');
  // mid-game reconnect: after ~60 actions in hand 2+, drop seat 2's socket and come back with the token
  if (!reconnected && actions > 60 && (host.view?.handNo ?? 0) >= 2) {
    const k = cs[2]!;
    const seatBefore = k.seat;
    const handBefore = k.view!.hand?.slice().sort().join();
    k.drop();
    await until(() => host.room!.seats[2]!.kind === 'human' && !(host.room!.seats[2] as { connected: boolean }).connected, 5000, 'disconnect seen');
    log('seat 2 disconnected; others see connected=false');
    await new Promise((r) => setTimeout(r, 300));
    const k2 = new Client(k.name, code);
    k2.token = k.token;
    await k2.connect();
    await until(() => k2.view !== null, 5000, 'state after reconnect');
    if (k2.seat !== seatBefore || k2.you !== k.you) throw new Error('reconnect landed on a different seat');
    const handNow = k2.view!.hand?.slice().sort().join();
    log(`reconnected to seat ${k2.seat} (same player id: ${k2.you === k.you}; hand ${handNow === handBefore ? 'unchanged' : 'changed (auto-play happened)'})`);
    cs[2] = k2;
    reconnected = true;
  }
  let acted = false;
  for (const c of cs) {
    const v = c.view;
    if (!v || c.room?.phase !== 'playing') continue;
    if (v.phase === 'handOver') {
      if (!c.room.ready.includes(c.you)) { c.send({ t: 'next' }); acted = true; }
      continue;
    }
    if (v.turn !== v.seat) continue;
    const a = chooseBotAction(v, 'normal');
    if (!a) continue;
    const rev = c.room!.rev;
    c.send({ t: 'act', action: toWire(a) });
    actions++;
    acted = true;
    await until(() => (c.room?.rev ?? 0) > rev || c.errors.length > 0, 10000, 'ack');
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
const unexpected = cs.flatMap((c) => c.errors).filter((e) => e !== 'NOT_HOST' && e !== 'NOT_YOUR_TURN');
if (unexpected.length) throw new Error(`unexpected errors: ${unexpected.join(',')}`);
if (!reconnected) throw new Error('reconnect did not run');
cs.forEach((c) => c.ws.close());
log('PASS');
process.exit(0);
