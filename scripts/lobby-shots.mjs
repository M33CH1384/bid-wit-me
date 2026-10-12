/**
 * Lobby redesign screenshots: phone (390x844) host seated + guest, desktop 1440x900, and 3-man Cutthroat.
 * Usage: node scripts/lobby-shots.mjs <prefix: before|after> [web=https://bid-wit-me.pages.dev] [server=]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const tag = process.argv[2] ?? 'after';
const base = process.argv[3] ?? 'https://bid-wit-me.pages.dev';
const server = process.argv[4] ?? '';
const q = server ? `?server=${encodeURIComponent(server)}` : '';
const out = 'screenshots/lobby-redesign';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const phone = async () => (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, permissions: ['camera', 'microphone'] })).newPage();
const desk = async () => (await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] })).newPage();
const prep = async (p) => { await p.goto(base + q); await p.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }))); };
async function create(p, name) {
  await prep(p);
  await p.goto(`${base}/online${q}`);
  await p.getByLabel('Your name').fill(name);
  await p.getByTestId('create-table').click();
  await p.getByTestId('lobby').waitFor({ timeout: 25000 });
  return (await p.getByTestId('room-code').locator('b').innerText()).trim();
}
async function join(p, code, name, seat) {
  await prep(p);
  await p.goto(`${base}/t/${code}${q}`);
  await p.getByLabel('Your name').fill(name);
  await p.getByRole('button', { name: `Join table ${code}` }).click();
  await p.getByTestId('lobby').waitFor({ timeout: 25000 });
  if (seat != null) await p.getByTestId(`lobby-seat-${seat}`).getByRole('button', { name: /sit here/i }).dispatchEvent('click', {}, { timeout: 8000 }).catch(() => console.log('no sit', seat));
}
const settle = (p) => p.waitForTimeout(1500);
try {
  // 1) phone host + guest + bot
  const host = await phone();
  const code = await create(host, 'M33CH');
  const guest = await desk();
  await join(guest, code, 'Keisha', 2);
  await host.getByTestId('lobby-seat-1').getByRole('button', { name: /bot/i }).click().catch(() => {});
  await host.getByRole('button', { name: 'Turn camera on' }).click().catch(() => {});
  await guest.getByRole('button', { name: 'Turn camera on' }).click().catch(() => {});
  await settle(host); await settle(guest);
  await host.evaluate(() => scrollTo(0, 0));
  await host.screenshot({ path: `${out}/${tag}-phone-390.png` });
  await host.screenshot({ path: `${out}/${tag}-phone-390-full.png`, fullPage: true });
  await host.getByTestId('start').scrollIntoViewIfNeeded().catch(() => {});
  await settle(host);
  await host.screenshot({ path: `${out}/${tag}-phone-390-start.png` });
  await guest.screenshot({ path: `${out}/${tag}-desktop-1440.png` });
  // 2) cutthroat (phone + desktop)
  const h3 = await desk();
  const code3 = await create(h3, 'M33CH');
  await h3.locator('.mode', { hasText: /3 players/i }).first().click();
  await h3.waitForTimeout(800);
  const g3 = await phone();
  await join(g3, code3, 'Keisha', 1);
  await settle(g3);
  await g3.screenshot({ path: `${out}/${tag}-phone-390-cutthroat.png` });
  await h3.screenshot({ path: `${out}/${tag}-desktop-1440-cutthroat.png` });
  console.log('ok', code, code3);
} finally { await b.close(); }
