/**
 * Release 9a social e2e (4 browsers at once: desktop + phone portrait + phone landscape, headless Chrome):
 * presence (accounts + Guest, statuses), invites (toast → Accept deep-links into the seat; Decline; guests receive),
 * friends (request → accept, ★ badge, friends first), DMs (live + unread badge + history), global chat moderation
 * (guest read-only, profanity masked, report, admin delete), profiles, block (hides presence, stops DMs + invites).
 * Needs `vite preview` on :4173 and a local Worker:
 *   wrangler dev --port 8787 --var AUTH_MOCK:1 --var PUBLIC_ORIGIN:http://localhost:4173 --var RATE_LIMITS_OFF:1 --var ADMIN_USERNAMES:ModDee
 * Usage: node scripts/social-e2e.mjs [web=http://localhost:4173] [out=screenshots/release-9]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const web = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'screenshots/release-9';
mkdirSync(out, { recursive: true });
const rnd = Math.random().toString(36).slice(2, 6);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const problems = [];
// a failed step must not leave Chrome hanging around (WebGL pages can make browser.close() slow)
const bail = (e) => { console.error(e); browser.close().catch(() => {}); setTimeout(() => process.exit(1), 3000); };
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);
const t0 = Date.now();
const ok = (m) => console.log(`✓ ${m} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

async function client(label, vp, mobile) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`${label} CSP: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${label} page error: ${e.message}`));
  await page.goto(web);
  await page.evaluate(() => { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low' })); });
  const tid = (t) => page.getByTestId(t);
  return { label, page, ctx, tid, shot: (n) => page.screenshot({ path: `${out}/${n}.png` }) };
}

async function signIn(c, as, username) {
  await c.page.goto(`${web}/api/auth/mock/start?as=${as}&return=%2F`);
  const input = c.tid('username-input');
  await Promise.race([input.waitFor({ timeout: 15000 }), c.tid('account-btn').waitFor({ timeout: 15000 })]);
  if (await input.isVisible().catch(() => false)) {
    await input.fill(username);
    await c.page.waitForTimeout(700);
    await c.tid('username-save').click();
  }
  await c.tid('account-btn').waitFor({ timeout: 15000 });
}

const openSocial = async (c, tab) => {
  if (!(await c.tid('social-panel').isVisible().catch(() => false))) await c.tid('social-btn').first().click();
  await c.tid('social-panel').waitFor();
  if (tab) await c.tid(`soc-tab-${tab}`).click();
};
const closeSocial = async (c) => { if (await c.tid('social-panel').isVisible().catch(() => false)) await c.tid('social-close').click(); };
const waitText = async (c, sel, text, ms = 10000) => { await c.page.locator(sel).filter({ hasText: text }).first().waitFor({ timeout: ms }); };

const A = await client('A desktop', { width: 1280, height: 800 }, false);
const B = await client('B phone', { width: 390, height: 844 }, true);
const G = await client('G landscape', { width: 844, height: 390 }, true);
const D = await client('D admin', { width: 1280, height: 800 }, false);
const aName = `Alice${rnd}`, bName = `Bobby${rnd}`;
await signIn(A, `alice_${rnd}`, aName);
await signIn(B, `bobby_${rnd}`, bName);
await signIn(D, 'moddee', 'ModDee');
await G.page.evaluate(() => localStorage.setItem('bwm.online.name', 'Kev'));
await G.page.reload();
ok('3 accounts signed in (mock provider) + 1 guest');

// 1) presence
await openSocial(A, 'players');
await A.tid(`player-${bName}`).waitFor({ timeout: 15000 });
await A.tid('player-Kev').waitFor();
await A.page.locator('[data-testid="player-Kev"] .soc-tag').filter({ hasText: 'Guest' }).waitFor();
await openSocial(G, 'players');
await G.tid(`player-${aName}`).waitFor();
// guests can't invite / chat / add
if (await G.tid(`pl-invite-${aName}`).isEnabled()) throw new Error('guest invite button should be disabled');
await G.tid('soc-signin-note').first().waitFor();
ok('presence: accounts + Guest listed on every client; guest actions locked');

// statuses: B starts an offline game → "At a table · Joker Spades · vs bots"
await B.page.goto(`${web}/?autostart=1&seed=social-status`);
await waitText(A, `[data-testid="player-${bName}"] .soc-pl-status`, 'At a table');
await waitText(A, `[data-testid="player-${bName}"] .soc-pl-status`, 'vs bots');
await B.page.evaluate(() => localStorage.removeItem('bwm.game'));
await B.page.goto(web);
await waitText(A, `[data-testid="player-${bName}"] .soc-pl-status`, 'Online');
ok('status: Online → At a table (vs bots) → Online, live');

// 2) friends
await A.tid(`pl-add-${bName}`).click();
await B.tid('social-badge').waitFor({ timeout: 10000 });
await openSocial(B, 'friends');
await B.tid(`req-${aName}`).waitFor();
await B.shot('friends-request-phone');
await B.tid(`accept-${aName}`).click();
await B.tid(`friend-${aName}`).waitFor();
await A.page.locator(`[data-testid="player-${bName}"] .soc-tag.friend`).waitFor();
// friends sort first (after you)
const order = await A.page.locator('[data-testid="players-list"] > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
if (order[1] !== `player-${bName}`) throw new Error(`friends should sort first: ${order.join(',')}`);
await A.shot('players-online-desktop');
await openSocial(B, 'players');
await B.shot('players-online-phone');
await openSocial(B, 'friends');
await B.shot('friends-phone');
ok('friends: request → badge → accept → ★ Friend, friends sorted first');

// 3) DMs
await A.tid(`pl-chat-${bName}`).click();
await A.tid('dm-input').fill('you up for spades?');
await A.tid('dm-send').click();
await waitText(A, '[data-testid="dm-line"]', 'you up for spades?');
await closeSocial(B);
await B.tid('social-badge').waitFor();
await openSocial(B, 'messages');
await B.tid(`thread-${aName}`).click();
await waitText(B, '[data-testid="dm-line"]', 'you up for spades?');
await B.tid('dm-input').fill('always. invite me');
await B.tid('dm-send').click();
await waitText(A, '[data-testid="dm-line"]', 'always. invite me');
await A.shot('dm-desktop');
await B.shot('dm-phone');
ok('DMs: live both ways, unread badge, history on open');

// 4) invites: decline (guest receives), then accept → deep link into the seat
await openSocial(A, 'players');
await A.tid('pl-invite-Kev').click(); // no table yet → creates one and goes there
await A.page.waitForURL(/\/t\/[A-Z0-9]+/, { timeout: 20000 });
const code = A.page.url().match(/\/t\/([A-Z0-9]+)/)[1];
await G.tid('invite-toast').waitFor({ timeout: 10000 });
await G.shot('invite-toast-landscape');
await G.tid('invite-decline').click();
await waitText(A, '[data-testid="soc-toast"]', 'declined');
await A.page.getByTestId('room-code').waitFor({ timeout: 20000 });
await openSocial(A, 'players');
await waitText(A, `[data-testid="player-${aName}"] .soc-pl-status`, 'In lobby');
await A.tid(`pl-invite-${bName}`).click();
await closeSocial(B);
await B.tid('invite-toast').waitFor({ timeout: 10000 });
await B.shot('invite-toast-phone');
await A.page.waitForTimeout(300);
await A.shot('invite-sent-desktop');
await B.tid('invite-accept').click();
await B.page.waitForURL(new RegExp(`/t/${code}`), { timeout: 15000 });
await waitText(A, '[data-testid="soc-toast"]', 'accepted');
await B.page.getByTestId('room-code').waitFor({ timeout: 20000 });
// seated in the invited seat (2 = Alice's partner in 2v2)
await A.page.waitForFunction((n) => document.querySelector('[data-testid="lobby"]')?.textContent?.includes(n) && window.__bwmSocial.get().myTable?.open === 2, bName, { timeout: 15000 });
await waitText(A, `[data-testid="player-${bName}"] .soc-pl-status`, 'In lobby').catch(() => {});
ok(`invites: guest declined; ${bName} accepted → deep link into table ${code}`);

// 5) global chat moderation
await openSocial(A, 'chat');
await A.tid('global-input').fill('good game everybody, that was fucking wild');
await A.tid('global-send').click();
await openSocial(G, 'chat');
await waitText(G, '[data-testid="global-line"]', 'good game everybody');
const masked = await G.page.locator('[data-testid="global-line"]').filter({ hasText: 'good game everybody' }).last().innerText();
if (/fucking/i.test(masked)) throw new Error(`profanity not masked: ${masked}`);
if (await G.tid('global-input').count()) throw new Error('guest should not have a composer');
await G.shot('global-chat-guest-landscape');
await openSocial(B, 'chat');
await waitText(B, '[data-testid="global-line"]', 'good game everybody');
await B.page.locator('[data-testid="global-line"]').filter({ hasText: 'good game everybody' }).last().locator('.soc-more').click();
await B.tid('line-report').click();
await waitText(B, '[data-testid="soc-toast"]', 'report sent');
await B.shot('global-chat-phone');
await openSocial(D, 'chat');
await waitText(D, '[data-testid="global-line"]', 'good game everybody');
await D.page.locator('[data-testid="global-line"]').filter({ hasText: 'good game everybody' }).last().locator('.soc-more').click();
await D.shot('global-chat-admin-desktop');
await D.tid('line-delete').click();
await G.page.locator('[data-testid="global-line"]').filter({ hasText: 'good game everybody' }).waitFor({ state: 'detached', timeout: 10000 });
ok('global chat: guest read-only, profanity masked, report, admin delete removes it everywhere');

// 6) profile
await openSocial(A, 'players');
await A.tid(`pl-profile-${bName}`).click();
await A.tid('profile-name').filter({ hasText: bName }).waitFor();
await A.shot('profile-desktop');
await openSocial(B, 'players');
await B.tid(`pl-profile-${aName}`).click();
await B.tid('profile-name').waitFor();
await B.shot('profile-phone');
ok('profiles open from the players list');

// 7) block: B blocks A → A stops seeing B, A's DMs/invites fail
B.page.once('dialog', (d) => d.accept());
await B.tid('profile-block').click();
await A.tid('profile-back').click();
await A.tid(`player-${bName}`).waitFor({ state: 'detached', timeout: 10000 });
await openSocial(A, 'messages');
if (await A.tid('dm-back').isVisible().catch(() => false)) await A.tid('dm-back').click();
await A.tid(`thread-${bName}`).click();
await A.tid('dm-input').fill('hello?');
await A.tid('dm-send').click();
await waitText(A, '[data-testid="soc-toast"]', "can't message");
await openSocial(B, 'friends');
await B.tid(`unblock-${aName}`).click();
await openSocial(A, 'players');
await A.tid(`player-${bName}`).waitFor({ timeout: 10000 });
ok('block hides presence + stops DMs; unblock restores');

// 8) appear offline
await openSocial(B, 'settings');
await B.tid('set-appearOffline').click();
await A.tid(`player-${bName}`).waitFor({ state: 'detached', timeout: 10000 });
await B.tid('set-appearOffline').click();
await A.tid(`player-${bName}`).waitFor({ timeout: 10000 });
ok('appear offline hides you from everyone; turning it off brings you back');

if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; } else console.log('✓ no CSP violations / page errors');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(process.exitCode ?? 0);
