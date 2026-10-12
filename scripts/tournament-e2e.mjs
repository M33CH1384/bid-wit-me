/**
 * Release 9b e2e (local wrangler with AUTH_MOCK=1 TEST_HOOKS=1 + vite preview):
 *  1. 8 accounts sign in (mock provider, through the same-origin /api proxy)
 *  2. a 4-team single-elimination bracket: register, check in, social-hub notices, entrants seated at their reserved
 *     seats over table websockets (account tickets), bots finish the matches, winners advance, champion + award
 *  3. a 6-player Swiss Cutthroat (3-player tables, 2 rounds) started by the host → standings
 *  4. browser screenshots (phone + desktop): leaderboard, tournament list, create form, bracket
 * usage: node scripts/tournament-e2e.mjs [web=http://localhost:4173] [server=http://127.0.0.1:8787]
 */
import WebSocket from 'ws';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://127.0.0.1:8787';
const wsBase = server.replace(/^http/, 'ws');
const out = 'screenshots/release-9';
mkdirSync(out, { recursive: true });
const rnd = Math.random().toString(36).slice(2, 6);
let failed = false;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.log(`✗ ${m}`); failed = true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await f(); if (v) return v; await sleep(500); } throw new Error(`timeout: ${what}`); };

/* ---- a tiny cookie-jar client through the web origin ---- */
class User {
  constructor(as, name) { this.as = as; this.name = name; this.jar = new Map(); }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(path, init = {}, follow = false) {
    let url = path.startsWith('http') ? path : web + path;
    for (let hop = 0; hop < 8; hop++) {
      const r = await fetch(url, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), cookie: this.cookie(), origin: web } });
      for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/max-age=0/i.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v); }
      if (follow && r.status >= 300 && r.status < 400) { url = new URL(r.headers.get('location'), url).toString(); init = {}; continue; }
      return r;
    }
    throw new Error('too many redirects');
  }
  async json(path, body) {
    const r = await this.req(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${path}: ${r.status} ${j.error ?? j.reason ?? ''}`);
    return j;
  }
  async signIn() {
    await this.req(`/api/auth/mock/start?as=${this.as}&return=%2F`, {}, true);
    const me = await this.json('/api/auth/me');
    if (!me.user) throw new Error(`${this.as}: not signed in`);
    if (!me.user.username) await this.json('/api/auth/username', { username: this.name });
    this.id = me.user.id;
    return this;
  }
  async ticket() { return (await this.json('/api/social/ticket')).ticket; }
}

function socket(url) {
  const ws = new WebSocket(url, { headers: { origin: web } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* */ } });
  const open = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return { ws, msgs, open, send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() };
}

const users = [];
try {
  for (let i = 0; i < 8; i++) users.push(await new User(`tour${i}_${rnd}`, `Tp${i}${rnd}`).signIn());
  ok('8 accounts signed in (mock provider, same-origin cookies)');
  const [host] = users;

  /* ---------------- 4-team single elimination ---------------- */
  let t = await host.json('/api/tournaments', { name: `Bracket ${rnd}`, mode: 'joker', format: 'single', max: 4, startAt: Date.now() + 25_000, bots: true, fast: true, target: 50 });
  const tid = t.meta.id;
  ok(`created bracket ${tid}`);
  for (let i = 0; i < 4; i++) t = await users[2 * i].json(`/api/tournaments/${tid}/register`, { partner: users[2 * i + 1].name, teamName: `Crew ${i + 1}` });
  if (t.entries.length === 4) ok('4 teams registered (partner by username)'); else fail(`entries ${t.entries.length}`);
  try { await users[1].json(`/api/tournaments/${tid}/register`, { partner: users[0].name }); fail('double registration allowed'); } catch { ok('double registration refused'); }
  // social hub sockets for the first team: they get the match-ready notice
  const hubs = [];
  for (const u of users.slice(0, 2)) { const s = socket(`${wsBase}/api/social/ws?ticket=${encodeURIComponent(await u.ticket())}`); await s.open; hubs.push(s); }
  for (const u of users.filter((_, i) => i % 2 === 0)) t = await u.json(`/api/tournaments/${tid}/checkin`, {});
  if (t.entries.every((e) => e.checkedIn)) ok('all teams checked in'); else fail('check-in');
  const list = await host.json('/api/tournaments?status=upcoming');
  if (list.tournaments.some((x) => x.id === tid && x.mine)) ok('listed under Upcoming (mine)'); else fail('upcoming list');
  t = await host.json(`/api/tournaments/${tid}/start`, {});
  if (t.meta.status === 'live' && t.matches.filter((m) => m.round === 1).length === 2) ok('started: 2 round-1 tables seated'); else fail(`start: ${t.meta.status}`);
  const note = await until(() => hubs[0].msgs.find((m) => m.t === 'notice' && m.code), 10_000, 'match notice');
  ok(`notice to ${users[0].name}: "${note.text}" → table ${note.code} seat ${note.seat}`);
  // both team members go to their table with account tickets: they land in their reserved seats
  const tables = [];
  for (const [i, u] of users.slice(0, 2).entries()) {
    const s = socket(`${wsBase}/api/tables/${note.code}/ws`); await s.open;
    s.send({ t: 'hello', name: u.name, ticket: await u.ticket() });
    tables.push(s);
    void i;
  }
  const st = await until(() => [...tables[1].msgs].reverse().find((m) => m.t === 'state' && m.room?.tournament && m.room.seats.filter((x) => x.kind === 'human').length === 2), 10_000, 'seated');
  const humanSeats = st.room.seats.map((x, i) => (x.kind === 'human' ? i : -1)).filter((i) => i >= 0);
  if (humanSeats.length === 2 && humanSeats[1] - humanSeats[0] === 2) ok(`entrants auto-seated as partners (seats ${humanSeats.join(' & ')})`); else fail(`seats ${JSON.stringify(humanSeats)}`);
  // they leave: after the (fast) grace the bots play the match out
  for (const s of tables) s.close();
  t = await until(async () => { const v = await host.json(`/api/tournaments/${tid}`); return v.meta.status === 'finished' ? v : null; }, 240_000, 'bracket finished');
  const r2 = t.matches.filter((m) => m.round === 2);
  if (r2.length === 1 && r2[0].status === 'done') ok(`winners advanced to the final: ${r2[0].entries.map((e) => e.name).join(' vs ')}`); else fail('final');
  ok(`champion: ${t.champion}`);
  const champ = t.entries.find((e) => e.name === t.champion);
  const prof = await host.json(`/api/social/profile/${encodeURIComponent(champ.members[0])}`);
  if (prof.champion >= 1 && prof.awards?.some((a) => a.ref === tid)) ok('champion badge on the profile'); else fail('award');
  const notices = hubs.flatMap((h) => h.msgs.filter((m) => m.t === 'notice').map((m) => m.text));
  if (notices.some((x) => /won/.test(x))) ok('champion notice delivered'); else fail(`notices ${JSON.stringify(notices)}`);
  for (const h of hubs) h.close();
  const fin = await host.json('/api/tournaments?status=finished');
  if (fin.tournaments.some((x) => x.id === tid && x.champion === t.champion)) ok('listed under Finished with the champion'); else fail('finished list');

  /* ---------------- Swiss, solo Cutthroat ---------------- */
  let s = await host.json('/api/tournaments', { name: `Swiss ${rnd}`, mode: 'cutthroat', players: 3, format: 'swiss', rounds: 2, max: 6, startAt: Date.now() + 60_000, bots: true, fast: true, target: 50 });
  const sid = s.meta.id;
  for (const u of users.slice(0, 6)) s = await u.json(`/api/tournaments/${sid}/register`, {});
  for (const u of users.slice(0, 6)) await u.json(`/api/tournaments/${sid}/checkin`, {});
  s = await host.json(`/api/tournaments/${sid}/start`, {});
  if (s.matches.filter((m) => m.round === 1).length === 2) ok('Swiss round 1: 2 Cutthroat tables of 3'); else fail('swiss r1');
  s = await until(async () => { const v = await host.json(`/api/tournaments/${sid}`); return v.meta.status === 'finished' ? v : null; }, 300_000, 'swiss finished');
  if (s.standings.length === 6 && s.matches.filter((m) => m.round === 2).length === 2) ok(`Swiss done: champion ${s.champion}; standings ${s.standings.map((x) => `${x.name} ${x.points}`).join(', ')}`); else fail('swiss standings');

  /* ---------------- leaderboard API ---------------- */
  const lb = await host.json('/api/social/leaderboard?board=wins&kind=team&period=week');
  ok(`leaderboard (wins, week): ${lb.rows.length} rows`);
  const stats = await host.json('/api/social/stats');
  ok(`server stats: ${JSON.stringify(stats)}`);

  /* ---------------- browser screenshots ---------------- */
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=swiftshader', '--no-sandbox'] });
  try {
    for (const [label, vp, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      // reuse the host's session cookie
      await ctx.addCookies([...host.jar].map(([name, value]) => ({ name, value, url: web })));
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(web);
      await page.evaluate(() => { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });
      await page.reload();
      const tid_ = (x) => page.getByTestId(x);
      await tid_('social-btn').first().click();
      await tid_('social-panel').waitFor();
      await tid_('soc-tab-leaders').click();
      await page.locator('.soc-lb-table, .soc-empty').first().waitFor();
      await tid_('lb-board-wins').click();
      await tid_('lb-period-week').click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/leaderboard-${label}.png` });
      await tid_('soc-tab-tournaments').click();
      await tid_('tl-finished').click();
      await tid_(`tour-Bracket ${rnd}`).waitFor({ timeout: 10_000 });
      await page.screenshot({ path: `${out}/tournament-list-${label}.png` });
      await tid_(`tour-Bracket ${rnd}`).click();
      await tid_('tour-bracket').waitFor({ timeout: 10_000 });
      await page.screenshot({ path: `${out}/tournament-bracket-${label}.png` });
      await tid_('tour-back').click();
      await tid_('tour-create').click();
      await tid_('tf-name').fill('Friday Night Spades');
      await page.screenshot({ path: `${out}/tournament-create-${label}.png` });
      if (errs.length) fail(`${label} page errors: ${errs.join(' | ')}`); else ok(`${label} screenshots: leaderboard, tournament list/bracket/create`);
      await ctx.close();
    }
  } finally { await browser.close(); }
} catch (e) {
  fail(String(e?.stack ?? e));
}
console.log(failed ? 'TOURNAMENT E2E FAILED' : 'TOURNAMENT E2E PASSED');
process.exit(failed ? 1 : 0);
