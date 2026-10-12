/**
 * Release 10 e2e (local wrangler + vite preview, or live): Open tables, spectators, take seat, spectator chat.
 *  - Node clients: host H (seat 0) + leaver L (seat 3) play with the bot brain; a bot on seat 2; browser player P
 *    (desktop) sits seat 1 from the lobby. Host: short turn timers, AFK kick off, "spectators can replace bots" OFF.
 *  - Browser spectators W (phone 390) and D (desktop) find the table under Open tables on "Pick a game" (filter) and
 *    Watch: WATCHING banner, no hand / no controls, and the spectator's wire never carries a card of any hand.
 *  - Spectator chat is tagged; P hides spectator chat (watchers chip) and stops seeing it.
 *  - L leaves → both spectators get the Take-seat prompt; W takes it first (D's prompt goes away); W is now seated
 *    with a real hand. Tournament / private tables are covered by unit tests.
 * Screenshots → screenshots/release-10/. Usage: npx tsx scripts/spectator-e2e.ts [web] [server] [--no-shots]
 */
import WebSocket from 'ws';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { chooseBotAction } from '@spades/bots';
import { makeRules, type Card, type PlayerView } from '@spades/rules';
import type { ClientMsg, GameAction, RoomInfo, ServerMsg } from '@spades/protocol';

const web = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:4173';
const server = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://127.0.0.1:8787').replace(/\/$/, '');
const shots = !process.argv.includes('--no-shots');
const out = 'screenshots/release-10';
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const ok = (m: string) => log(`✓ ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | Promise<T>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await f(); if (v) return v; await sleep(250); }
  throw new Error(`timeout: ${what}`);
}

class Bot {
  ws!: WebSocket; you = ''; room: RoomInfo | null = null; seat: number | null = null; view: PlayerView | null = null;
  chats: { name: string; text: string; spectator?: boolean }[] = []; errors: string[] = []; auto = true; busy = '';
  constructor(public name: string, public code: string) {}
  connect(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`${server.replace(/^http/, 'ws')}/api/tables/${this.code}/ws`);
      this.ws.on('open', () => this.send({ t: 'hello', name: this.name }));
      this.ws.on('error', rej);
      this.ws.on('message', (b) => {
        const m = JSON.parse(b.toString()) as ServerMsg;
        if (m.t === 'welcome') { this.you = m.you; res(); }
        if (m.t === 'state') { this.room = m.room; this.seat = m.seat; this.view = m.view; this.play(); }
        if (m.t === 'chat') this.chats.push({ name: m.line.name, text: m.line.text, spectator: m.line.spectator });
        if (m.t === 'error') this.errors.push(`${m.code}: ${m.message}`);
      });
    });
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  play() {
    const v = this.view;
    if (!this.auto || !v || !this.room || this.room.phase !== 'playing' || this.seat === null) return;
    if (v.phase === 'handOver') { const k = `n${v.handNo}`; if (this.busy !== k) { this.busy = k; this.send({ t: 'next' }); } return; }
    if (v.turn !== this.seat) return;
    const key = `${this.room.seq}`;
    if (this.busy === key) return;
    this.busy = key;
    const a = chooseBotAction(v, 'normal');
    if (!a) return;
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : a.type === 'bid' ? { type: 'bid', bid: a.bid as number | 'nil' | 'blindNil' } : a.type === 'play' ? { type: 'play', card: a.card } : a.type === 'runIt' ? { type: 'runIt' } : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
    setTimeout(() => this.send({ t: 'act', action, seq: this.room!.seq, id: `${this.name}-${key}` }), 250);
  }
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const problems: string[] = [];
async function client(label: string, name: string, vp: { width: number; height: number }, mobile: boolean) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${label} page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${label} ${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`${label} CSP: ${m.text()}`); });
  // capture the table socket's frames: a spectator must never receive a card of any hand
  const frames: string[] = [];
  page.on('websocket', (ws) => { if (ws.url().includes('/api/tables/')) ws.on('framereceived', (f) => { if (typeof f.payload === 'string') frames.push(f.payload); }); });
  await page.goto(web);
  await page.evaluate((n) => { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.online.name', n); localStorage.setItem('bwm.firstVisit', '0'); }, name);
  return { page, ctx, frames, tid: (t: string) => page.getByTestId(t), shot: async (n: string) => { if (shots) await page.screenshot({ path: `${out}/${n}.png` }); } };
}

try {
  // ---- the table: host + leaver over websockets, browser player P sits seat 1
  const code = ((await (await fetch(`${server}/api/tables`, { method: 'POST' })).json()) as { code: string }).code;
  log('table', code);
  const H = new Bot('Hosty', code); await H.connect();
  H.send({ t: 'sit', seat: 0 });
  const L = new Bot('Leavy', code); await L.connect();
  L.send({ t: 'sit', seat: 3 });
  const rules = makeRules('joker', { targetScore: 500, turnTimerSec: { bid: 6, play: 5 } });
  H.send({ t: 'config', rules, botLevel: 'pro', afkLimit: 0, talkSec: 15 });
  H.send({ t: 'tableOpts', replaceBots: false });
  const P = await client('P', 'Pia', { width: 1280, height: 800 }, false);
  await P.page.goto(`${web}/t/${code}`);
  await until(() => H.room?.seats[1]?.kind === 'human', 20000, 'P seated');
  H.send({ t: 'addBot', seat: 2 });
  await until(() => H.room?.seats[2]?.kind === 'bot', 5000, 'bot seated');

  // ---- Open tables (lobby): W (phone) sees it waiting on "Pick a game"
  const W = await client('W', 'Wes', { width: 390, height: 844 }, true);
  await W.page.goto(web);
  await W.tid('play-online').click();
  await W.tid(`ot-row-${code}`).waitFor({ timeout: 15000 });
  const rowText = await W.tid(`ot-row-${code}`).innerText();
  if (!/Waiting/i.test(rowText) || !/Hosty/.test(rowText) || !/to 500/.test(rowText) || !/3\/4 players/.test(rowText)) throw new Error(`lobby row: ${rowText}`);
  ok(`Open tables: lobby row live (${rowText.replace(/\s+/g, ' ')})`);

  H.send({ t: 'start' });
  await until(() => H.room?.phase === 'playing', 10000, 'game started');
  await W.page.waitForFunction((c) => /In progress/i.test(document.querySelector(`[data-testid=ot-row-${c}]`)?.textContent ?? ''), code, { timeout: 15000 });
  // filters: Cutthroat hides it, Joker shows it
  await W.tid('ot-filter-cutthroat4').click();
  await W.tid(`ot-row-${code}`).waitFor({ state: 'detached', timeout: 5000 });
  await W.tid('ot-filter-joker').click();
  await W.tid(`ot-row-${code}`).waitFor({ timeout: 5000 });
  if (await W.tid(`ot-join-${code}`).count()) throw new Error('Join shown although no seat is takeable (bots locked)');
  await W.shot('open-tables-phone');
  ok('Open tables: live status update (In progress · hand N), filter, no Join while bots are locked');

  // ---- D (desktop) also on the list, then both Watch
  const D = await client('D', 'Dot', { width: 1280, height: 800 }, false);
  await D.page.goto(web);
  await D.tid('play-online').click();
  await D.tid(`ot-row-${code}`).waitFor({ timeout: 15000 });
  await D.shot('open-tables-desktop');
  for (const S of [W, D]) {
    await S.tid(`ot-watch-${code}`).click();
    await S.tid('spectator-bar').waitFor({ timeout: 30000 }).catch(async (e) => {
      console.log('url', S.page.url());
      throw e;
    });
  }
  await until(() => (H.room?.spectators ?? []).length === 2, 10000, 'host sees 2 spectators');
  for (const S of [W, D]) {
    if (await S.page.locator('[data-testid^="card-"]').count()) throw new Error('spectator has hand buttons');
    if (await S.page.locator('.bid-grid button').count()) throw new Error('spectator has bid controls');
  }
  await W.page.waitForTimeout(2500);
  await W.shot('spectator-view-phone');
  await D.shot('spectator-view-desktop');
  ok('spectators: WATCHING banner, no hand / bid controls; the host sees 2 watchers');

  // ---- spectator chat: tagged; P hides it
  await W.page.locator('.chat-toggle').click();
  await W.page.getByLabel('Chat message').fill('nice cut 👀');
  await W.page.getByLabel('Chat message').press('Enter');
  await until(() => H.chats.find((c) => c.text === 'nice cut 👀' && c.spectator), 8000, 'spectator chat tagged on the wire');
  await P.page.locator('.chat-toggle').click();
  await P.page.locator('.chat-line').filter({ hasText: 'nice cut' }).getByTestId('chat-tag').waitFor({ timeout: 8000 });
  await W.page.waitForTimeout(500);
  await W.shot('spectator-chat-phone');
  await P.tid('watchers-chip').click();
  await P.tid('watchers-pop').waitFor();
  await P.shot('spectator-chat-desktop');
  await P.tid('hide-spec-chat').click();
  await P.page.locator('.chat-line').filter({ hasText: 'nice cut' }).waitFor({ state: 'detached', timeout: 5000 });
  await P.shot('hide-spectator-chat-desktop');
  await W.page.getByLabel('Chat message').fill('second line');
  await W.page.getByLabel('Chat message').press('Enter');
  await until(() => H.chats.find((c) => c.text === 'second line'), 8000, 'second spectator line');
  await P.page.waitForTimeout(800);
  if (await P.page.locator('.chat-line').filter({ hasText: 'second line' }).count()) throw new Error('hidden spectator chat still shows');
  await P.tid('hide-spec-chat').click();
  await P.page.locator('.chat-line').filter({ hasText: 'second line' }).waitFor({ timeout: 5000 });
  await P.tid('watchers-chip').click();
  await W.page.locator('.chat-toggle').click();
  ok('spectator chat: tagged "Spectator"; a player can hide it (and bring it back)');

  // ---- privacy on the wire: no spectator frame carries a card of any (current) hand
  for (const S of [W, D]) {
    const leaked = S.frames.filter((f) => { try { const m = JSON.parse(f); return m.t === 'state' && m.view && (m.view.hand || (m.view.legal ?? []).length); } catch { return false; } });
    if (leaked.length) throw new Error(`spectator received a hand / legal moves (${leaked.length} frames)`);
  }
  ok(`privacy: ${W.frames.length + D.frames.length} spectator frames, none with a hand or legal moves`);

  // ---- take seat: L leaves → both see the prompt; W first; D's prompt goes away
  L.auto = false;
  L.send({ t: 'leave' });
  for (const S of [W, D]) await S.tid('take-seat-3').waitFor({ timeout: 10000 });
  await W.shot('take-seat-prompt-phone');
  await D.shot('take-seat-prompt-desktop');
  await W.tid('take-seat-3').click();
  await W.tid('spectator-bar').waitFor({ state: 'detached', timeout: 15000 });
  await D.tid('take-seat-prompt').waitFor({ state: 'detached', timeout: 10000 });
  await until(() => H.room?.seats[3]?.kind === 'human' && (H.room.seats[3] as { name: string }).name === 'Wes', 8000, 'W seated at 3');
  await W.page.waitForFunction(() => document.querySelectorAll('[data-testid^="card-"]').length > 0, null, { timeout: 15000 });
  const plate = await W.page.locator('.me-plate .plate-name').innerText();
  if (!/YOU/.test(plate)) throw new Error(`W plate: ${plate}`);
  ok('take seat: prompt for both spectators; W took seat 3 first (hand + score), D\'s prompt closed');
  // W (now a player) sees the remaining watcher + the hide switch on the phone
  await W.tid('watchers-chip').click();
  await W.tid('watchers-pop').waitFor();
  await W.page.waitForTimeout(400);
  await W.shot('hide-spectator-chat-phone');
  await W.tid('watchers-chip').click();
  // the table keeps going
  const seq = H.room!.seq;
  await until(() => H.room!.seq > seq + 3, 40000, 'game continues after the takeover');
  ok('the game continues with W in the seat');
  if (problems.length) throw new Error(problems.join('\n'));
  for (const b of [H, L]) b.ws.close();
  console.log('SPECTATOR E2E PASSED');
} finally {
  await browser.close();
}
