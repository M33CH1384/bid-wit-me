/**
 * Live social smoke (deployed site, no test hooks): two passkey accounts + a guest connect to the social hub,
 * see each other online, a global chat line reaches everyone, a DM and a table invite reach the other account,
 * leaderboard + tournament list answer. Both accounts are deleted at the end (their DMs/friends go with them;
 * the one global chat line stays in the hub's rolling 200-line history unless an admin deletes it).
 * Usage: node scripts/social-live-smoke.mjs [web=https://bid-wit-me.pages.dev] [server=https://bid-wit-me-server.demetrius-robinson31.workers.dev]
 */
import { chromium } from 'playwright-core';
const web = process.argv[2] ?? 'https://bid-wit-me.pages.dev';
const server = process.argv[3] ?? 'https://bid-wit-me-server.demetrius-robinson31.workers.dev';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ok = (m) => console.log(`✓ ${m}`);
async function account() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const tid = (t) => page.getByTestId(t);
  const name = `Live${Math.random().toString(36).slice(2, 7)}`;
  await page.goto(web);
  await page.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })));
  await page.reload();
  await tid('signin-btn').click();
  await tid('create-passkey').click();
  await tid('username-input').fill(name);
  await page.waitForFunction(() => /available/i.test(document.querySelector('[data-testid=username-msg]')?.textContent ?? ''), null, { timeout: 8000 });
  await tid('username-save').click();
  await page.waitForFunction((n) => document.querySelector('[data-testid=account-btn]')?.textContent?.includes(n), name, { timeout: 15000 });
  return { page, tid, name };
}
// raw hub socket inside the page (same origin cookie → ticket)
const hub = (page, srv, guest) => page.evaluate(async ({ srv, guest }) => {
  let q = 'name=GuestProbe';
  if (!guest) { const j = await (await fetch('/api/social/ticket')).json(); q = `ticket=${encodeURIComponent(j.ticket)}`; }
  const ws = new WebSocket(`${srv.replace(/^http/, 'ws')}/api/social/ws?${q}`);
  window.__msgs = []; window.__ws = ws;
  ws.onmessage = (e) => { if (e.data !== 'pong') window.__msgs.push(JSON.parse(e.data)); };
  await new Promise((r, x) => { ws.onopen = r; ws.onerror = x; });
}, { srv, guest });
const waitMsg = async (page, fn, arg, what) => {
  const f = new Function('m', 'a', fn);
  for (const end = Date.now() + 15000; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    const msgs = await page.evaluate(() => window.__msgs);
    if (msgs.some((m) => f(m, arg))) return;
  }
  throw new Error(`timeout: ${what}`);
};
const send = (page, m) => page.evaluate((m) => window.__ws.send(JSON.stringify(m)), m);
const meId = (page) => page.evaluate(() => window.__msgs.find((m) => m.t === 'hello').you.id);

const A = await account(), B = await account();
ok(`two passkey accounts: ${A.name}, ${B.name}`);
const gctx = await browser.newContext(); const G = { page: await gctx.newPage() }; await G.page.goto(web);
try {
  await hub(A.page, server); await hub(B.page, server); await hub(G.page, server, true);
  await waitMsg(A.page, 'return m.t==="hello"', null, 'A hello'); await waitMsg(B.page, 'return m.t==="hello"', null, 'B hello');
  const aId = await meId(A.page), bId = await meId(B.page);
  const sees = (p, n) => waitMsg(p, 'return (m.t==="hello"&&m.users.some(u=>u.name===a))||(m.t==="pres"&&(m.up||[]).some(u=>u.name===a))', n, `presence ${n}`);
  await sees(A.page, B.name); await sees(B.page, A.name); await sees(G.page, A.name); await sees(G.page, B.name);
  ok('presence: both accounts see each other online; a guest sees both');
  const text = 'gg all, good luck at the tables';
  await send(A.page, { t: 'chat', text });
  for (const p of [B.page, G.page]) await waitMsg(p, 'return m.t==="chat"&&m.line.text===a', text, 'global chat');
  ok('global chat line reached the other account + guest');
  await send(A.page, { t: 'dm', to: bId, text: 'dm check' });
  await waitMsg(B.page, 'return m.t==="dm"&&m.line.text===a', 'dm check', 'dm');
  ok('DM delivered');
  await send(A.page, { t: 'invite', to: bId, code: 'ZZZZZ', mode: 'partners' });
  await waitMsg(B.page, 'return m.t==="invite"', null, 'invite');
  ok('table invite reached the other account');
  const lb = await A.page.evaluate(async () => (await fetch('/api/social/leaderboard?board=rating&kind=team&scope=global&period=all')).status);
  const tl = await A.page.evaluate(async () => (await fetch('/api/tournaments')).status);
  if (lb !== 200 || tl !== 200) throw new Error(`leaderboard ${lb} tournaments ${tl}`);
  ok('leaderboard + tournament list 200');
} finally {
  for (const X of [A, B]) {
    try {
      await X.page.evaluate(() => window.__ws?.close());
      await X.tid('account-btn').click(); await X.tid('delete-account').click();
      await X.tid('delete-confirm-input').fill(X.name); await X.tid('delete-confirm').click();
      await X.tid('signin-btn').waitFor(); ok(`cleanup: ${X.name} deleted`);
    } catch (e) { console.log(`✗ cleanup ${X.name}: ${e.message}`); }
  }
  await browser.close();
}
console.log('LIVE SOCIAL SMOKE PASS');
