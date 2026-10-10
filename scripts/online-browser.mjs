/**
 * Online browser test: two headless Chrome contexts (fake camera/mic) play on one table through the real Worker.
 *  - host creates a table, guest joins via the invite link and picks the partner seat; 2 bots fill in
 *  - both turn their camera on; each must receive the other's live video (WebRTC P2P, signaling via the DO)
 *  - play part of a hand via the UI, guest REFRESHES mid-game and lands back in the same seat, video reconnects
 *  - screenshots → screenshots/online/
 * Usage: node scripts/online-browser.mjs [webUrl=http://localhost:4173] [serverUrl] [chrome=/usr/bin/google-chrome]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? '';
const executablePath = process.argv[4] ?? '/usr/bin/google-chrome';
// optional test relay (see scripts/turn-local.mjs): TURN='[{"urls":"turn:172.30.0.2:3478","username":"bwm","credential":"test"}]'
const turn = process.env.TURN ?? '';
const out = 'screenshots/online';
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
async function newPage(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { if (!localStorage.getItem('bwm.tips')) localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); } catch { /* */ } });
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  page.on('console', (m) => { if (process.env.DEBUG) console.log(label, m.type(), m.text()); if (m.type() === 'error' && !/WebSocket|favicon|net::ERR/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  return page;
}
const qs = new URLSearchParams();
if (server) qs.set('server', server);
if (turn) qs.set('turn', turn);
const q = qs.size ? `?${qs}` : '';
const host = await newPage('host');
const guest = await newPage('guest');

// --- host creates a table
await host.goto(`${web}/${q}`);
await host.getByTestId('play-online').click();
await host.getByTestId('mode-joker').click();
await host.getByLabel('Your name').fill('Demetrius');
await host.getByTestId('create-table').click();
await host.getByTestId('lobby').waitFor({ timeout: 20000 });
const code = (await host.getByTestId('room-code').locator('b').innerText()).trim();
log('table', code);
await host.getByTestId('lobby-seat-0').getByText('You').waitFor();

// --- guest joins with the invite link and moves to the partner seat
await guest.goto(`${web}/t/${code}${q}`);
await guest.getByLabel('Your name').fill('Keisha');
await guest.getByRole('button', { name: `Join table ${code}` }).click();
await guest.getByTestId('lobby').waitFor({ timeout: 20000 });
await guest.getByTestId('lobby-seat-2').getByRole('button', { name: 'Sit here' }).click();
await guest.getByTestId('lobby-seat-2').getByText('You').waitFor();
await host.getByTestId('lobby-seat-2').getByText('Keisha').waitFor();
log('guest seated across (partner)');

// chat round trip
await guest.getByLabel('Chat message').fill('yo what up');
await guest.getByLabel('Chat message').press('Enter');
await host.locator('.lobby-chat').getByText('yo what up').waitFor({ timeout: 5000 });

// --- cameras on (fake devices); each must see the other's live video
// (clicks are retried: the lobby can shift by a line while chat/state updates arrive)
async function toggle(page, from, to) {
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: from }).click();
    try { await page.getByRole('button', { name: to }).waitFor({ timeout: 4000 }); return; } catch { /* retry */ }
  }
  throw new Error(`could not toggle ${from}`);
}
await toggle(host, 'Turn camera on', 'Turn camera off');
await toggle(host, 'Turn microphone on', 'Mute microphone');
await toggle(guest, 'Turn camera on', 'Turn camera off');
const liveRemote = (page) => page.waitForFunction(() => {
  const v = document.querySelector('[data-testid^="video-"][data-live="true"] video');
  return !!v && v.videoWidth > 0 && v.readyState >= 2;
}, null, { timeout: 30000 });
try {
  await Promise.all([liveRemote(host), liveRemote(guest)]);
} catch (e) {
  if (process.env.NO_RTC) { log('video: SKIPPED live-remote check (NO_RTC=1: this sandbox gathers no ICE candidates)'); } else {
  for (const [n, p] of [['host', host], ['guest', guest]]) console.log(n, JSON.stringify(await p.evaluate(() => ({ d: window.__bwmVideo?.debug(), s: { cam: window.__bwmVideo?.state.cam, mic: window.__bwmVideo?.state.mic, err: window.__bwmVideo?.state.error } })), null, 1));
  console.log(errors);
  throw e;
  }
}
if (!process.env.NO_RTC) log('video: both sides receive live remote video');
await host.mouse.click(5, 5); // first tap unmutes remote audio (iOS-style)
await host.waitForTimeout(800);
await host.screenshot({ path: `${out}/01-lobby-host.png` });
await guest.screenshot({ path: `${out}/02-lobby-guest.png` });

// --- start (2 bots fill seats 2 and 4)
await host.getByTestId('start').click();
await Promise.all([host.locator('.table-screen').waitFor({ timeout: 20000 }), guest.locator('.table-screen').waitFor({ timeout: 20000 })]);
log('game started');

const legal = (p) => p.locator('[data-testid^="card-"][data-legal="true"]');
async function step(p) {
  const next = p.getByRole('button', { name: 'Next hand' });
  if (await next.count()) { await next.click({ timeout: 2000 }).catch(() => {}); return 'next'; }
  const see = p.getByRole('button', { name: 'See my cards' });
  if (await see.count()) { await see.click({ timeout: 2000 }).catch(() => {}); return 'see'; }
  const bid = p.locator('.bid-grid button');
  if (await bid.count()) { await bid.nth(Math.min(2, (await bid.count()) - 1)).click({ timeout: 2000 }).catch(() => {}); return 'bid'; }
  const l = legal(p);
  if (await l.count()) { const c = l.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); return 'play'; }
  return null;
}
async function playUntil(cond, ms = 240000) {
  const end = Date.now() + ms;
  let plays = 0;
  while (Date.now() < end) {
    if (await cond()) return plays;
    for (const p of [host, guest]) { const r = await step(p); if (r === 'play') plays++; }
    await host.waitForTimeout(60);
  }
  await host.screenshot({ path: `${out}/timeout-host.png` }); await guest.screenshot({ path: `${out}/timeout-guest.png` });
  throw new Error('playUntil timed out');
}
const trickCount = (p) => p.getByTestId('hand').getAttribute('data-trick-count').then(Number).catch(() => 0);
const piles = (p) => p.locator('[data-testid="last-trick"]').count();

// play into the first hand until a couple of tricks are done
await playUntil(async () => (await piles(host)) > 0 && (await trickCount(host)) >= 2);
await host.waitForTimeout(400);
await host.screenshot({ path: `${out}/03-table-host-video.png` });
await guest.screenshot({ path: `${out}/04-table-guest-video.png` });
const bubbles = await host.locator(process.env.NO_RTC ? '.badge-layer [data-testid^="video-"]' : '.badge-layer [data-testid^="video-"][data-live="true"]').count();
const selfView = await host.getByTestId('self-video').count();
log(`table: host sees ${bubbles} live remote bubble(s) on seat plates, self-view ${selfView ? 'on' : 'off'}`);
if (!bubbles || !selfView) throw new Error('video bubbles missing on the table');

// --- guest refreshes mid-game → back in the same seat with the same cards
const handBefore = (await guest.locator('[data-testid^="card-"]').evaluateAll((els) => els.map((e) => e.dataset.testid).sort())).join();
await guest.reload();
await guest.locator('.table-screen').waitFor({ timeout: 20000 });
await guest.waitForFunction(() => document.querySelectorAll('[data-testid^="card-"]').length > 0, null, { timeout: 15000 });
const handAfter = (await guest.locator('[data-testid^="card-"]').evaluateAll((els) => els.map((e) => e.dataset.testid).sort())).join();
log(`guest refreshed: back at the table, ${handAfter === handBefore ? 'same cards' : 'cards changed (a turn may have auto-played)'}; partner plate shows "${await guest.locator('[data-testid="seat-2"] .plate-name').innerText()}"`);
const handAfterSet = new Set(handAfter.split(','));
if (![...handAfterSet].every((c) => handBefore.split(',').includes(c))) throw new Error('refresh landed on a different hand');
// camera is off after a refresh (by design); turn it back on → host gets video again via a fresh peer connection
await toggle(guest, 'Turn camera on', 'Turn camera off');
if (!process.env.NO_RTC) { await liveRemote(host); await liveRemote(guest); log('video re-established after refresh'); }

// finish the hand
await playUntil(async () => (await host.getByRole('button', { name: 'Next hand' }).count()) > 0);
await host.waitForTimeout(500);
await host.screenshot({ path: `${out}/05-hand-results-host.png` });
await host.getByRole('button', { name: 'Next hand' }).click();
await guest.getByRole('button', { name: 'Next hand' }).click({ timeout: 3000 }).catch(() => {});
await playUntil(async () => (await host.locator('.bid-grid button').count()) > 0 || (await legal(host).count()) > 0 || (await guest.locator('.bid-grid button').count()) > 0, 30000);
log('hand 2 dealt');

// lobby view while in game (menu) shows the code and "Back to the game"
await host.getByRole('button', { name: 'Menu' }).click();
await host.getByTestId('lobby').waitFor();
await host.screenshot({ path: `${out}/06-lobby-during-game.png` });
await host.getByRole('button', { name: 'Back to the game' }).click();
await host.locator('.table-screen').waitFor();

await browser.close();
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
log('PASS');
