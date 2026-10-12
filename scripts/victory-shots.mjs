/**
 * Online victory spotlight capture: host (phone) + partner (desktop) with fake cameras/mics play a short game
 * (target 10, so hand 1 decides it) against 2 bots via a local TURN relay; rematches until the humans' team wins,
 * then screenshots the victory screen on both → screenshots/release-6/victory-{phone,desktop}.png.
 * Checks: 2 winner + 2 loser tiles, mics not limited (partner mic mute ON), no auto-advance for 15 s.
 * Usage: node scripts/victory-shots.mjs [web=http://localhost:4173] [server=http://127.0.0.1:8787]
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://127.0.0.1:8787';
const out = process.env.SHOTS_OUT ?? 'screenshots/release-6';
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const turnProc = spawn('node', ['scripts/turn-local.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
const turn = await new Promise((res) => turnProc.stdout.once('data', (d) => res(String(d).trim())));
const cleanup = () => { try { turnProc.kill(); } catch { /* */ } };
process.on('exit', cleanup);
const q = `?${new URLSearchParams({ server, turn })}`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
async function newPage(label, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }));
    localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', targetScore: 10, quality: 'low', speed: 'fast' }));
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  return page;
}
try {
  const host = await newPage('host', { width: 390, height: 844 }, true);
  const guest = await newPage('guest', { width: 1440, height: 900 }, false);
  await host.goto(`${web}/${q}`);
  await host.getByTestId('play-online').click();
  await host.getByTestId('mode-joker').click();
  await host.getByLabel('Your name').fill('Demetrius');
  await host.getByTestId('create-table').click();
  await host.getByTestId('lobby').waitFor({ timeout: 20000 });
  const code = (await host.getByTestId('room-code').locator('b').innerText()).trim();
  log('table', code);
  await guest.goto(`${web}/t/${code}${q}`);
  await guest.getByLabel('Your name').fill('Keisha');
  await guest.getByRole('button', { name: `Join table ${code}` }).click();
  await guest.getByTestId('lobby').waitFor({ timeout: 20000 });
  await guest.getByTestId('lobby-seat-2').getByRole('button', { name: 'Sit here' }).click();
  await host.getByTestId('lobby-seat-2').getByText('Keisha').waitFor();
  if ((await host.locator('details.settings-panel').getAttribute('open')) === null) await host.locator('details.settings-panel > summary').click();
  await host.getByTestId('mic-mute-toggle').click(); // partner mic mute ON: the victory screen must still open every mic
  for (const p of [host, guest]) if (await p.getByTestId('lobby-chat-tab').count()) await p.getByTestId('lobby-chat-tab').click().catch(() => {});
  const toggle = async (page, from, to) => {
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: from }).first().click();
      try { await page.getByRole('button', { name: to }).first().waitFor({ timeout: 4000 }); return; } catch { /* retry */ }
    }
    throw new Error(`could not toggle ${from}`);
  };
  for (const p of [host, guest]) { await toggle(p, 'Turn camera on', 'Turn camera off'); await toggle(p, 'Turn microphone on', 'Mute microphone'); }
  log('cameras + mics on');
  await host.getByTestId('start').click();
  await Promise.all([host.locator('.table-screen').waitFor({ timeout: 20000 }), guest.locator('.table-screen').waitFor({ timeout: 20000 })]);
  const step = async (p) => {
    const next = p.locator('[data-testid="talk-ready"]:not([disabled])');
    if (await next.count()) { await next.click({ timeout: 2000 }).catch(() => {}); return; }
    const see = p.getByRole('button', { name: 'See my cards' });
    if (await see.count()) { await see.click({ timeout: 2000 }).catch(() => {}); return; }
    const bid = p.locator('.bid-grid button');
    if (await bid.count()) { await bid.nth(Math.min(2, (await bid.count()) - 1)).click({ timeout: 2000 }).catch(() => {}); return; }
    const l = p.locator('[data-testid^="card-"][data-legal="true"]');
    if (await l.count()) { const c = l.first(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); }
  };
  let won = false;
  for (let game = 1; game <= 6 && !won; game++) {
    const end = Date.now() + 300000;
    while (Date.now() < end) {
      if ((await host.getByTestId('victory').count()) && (await guest.getByTestId('victory').count())) break;
      await step(host); await step(guest);
      await host.waitForTimeout(250);
    }
    await host.getByTestId('victory').waitFor({ timeout: 30000 });
    await guest.getByTestId('victory').waitFor({ timeout: 30000 });
    won = (await host.locator('[data-testid="vs-win-0"]').count()) > 0;
    log(`game ${game}: ${won ? 'our team won' : 'bots won'}`);
    if (!won) { await host.getByTestId('rematch').click(); await host.getByTestId('victory').waitFor({ state: 'detached', timeout: 20000 }); }
  }
  if (!won) throw new Error('humans never won in 6 games');
  for (const [n, p] of [['desktop', guest], ['phone', host]]) {
    await p.waitForFunction(() => [...document.querySelectorAll('[data-testid^="vs-win-"] video')].filter((v) => v.videoWidth > 0).length >= 2, null, { timeout: 30000 }).catch(() => log(`${n}: not every winner tile has live video`));
  }
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${out}/victory-phone.png` });
  await guest.screenshot({ path: `${out}/victory-desktop.png` });
  const state = (p) => p.evaluate(() => ({
    wins: document.querySelectorAll('[data-testid^="vs-win-"]').length,
    loses: document.querySelectorAll('[data-testid^="vs-lose-"]').length,
    liveWins: [...document.querySelectorAll('[data-testid^="vs-win-"] video')].filter((v) => v.videoWidth > 0).length,
    limited: window.__bwmVideo?.state.limited ?? null,
    ducked: window.__bwmVideo?.state.ducked ?? null,
  }));
  const s1 = await state(host), s2 = await state(guest);
  log('phone', JSON.stringify(s1), 'desktop', JSON.stringify(s2));
  if (s1.wins !== 2 || s1.loses !== 2) throw new Error('expected 2 winner + 2 loser tiles');
  if ((s1.limited ?? []).length || (s2.limited ?? []).length) throw new Error('mics should all be open on the victory screen');
  await host.waitForTimeout(15000);
  if (!(await host.getByTestId('victory').count()) || !(await guest.getByTestId('victory').count())) throw new Error('victory screen auto-advanced within 15 s');
  log('victory screen still up after 15 s (no auto-advance)');
  if (errors.length) console.log('page errors:', errors.slice(0, 10));
  console.log('VICTORY OK');
} finally {
  await browser.close().catch(() => {});
  cleanup();
}
