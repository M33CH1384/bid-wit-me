/** Lobby v5 screenshots → screenshots/lobby-v5/. Usage: node scripts/lobby-v5-shots.mjs [web] */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'https://bid-wit-me.pages.dev';
const out = 'screenshots/lobby-v5'; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const phone = async () => (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, permissions: ['camera', 'microphone'] })).newPage();
const desk = async () => (await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] })).newPage();
const prep = async (p) => { await p.goto(base); await p.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }))); };
async function create(p, name) { await prep(p); await p.goto(`${base}/online`); await p.getByLabel('Your name').fill(name); await p.getByTestId('create-table').click(); await p.getByTestId('lobby').waitFor({ timeout: 25000 }); return (await p.getByTestId('room-code').locator('b').innerText()).trim(); }
async function join(p, code, name, seat) { await prep(p); await p.goto(`${base}/t/${code}`); await p.getByLabel('Your name').fill(name); await p.getByRole('button', { name: `Join table ${code}` }).click(); await p.getByTestId('lobby').waitFor({ timeout: 25000 }); if (seat != null) await p.getByTestId(`lobby-seat-${seat}`).getByRole('button', { name: 'Sit here' }).click({ timeout: 8000 }); }
const wait = (p, ms = 1500) => p.waitForTimeout(ms);
try {
  const host = await phone();
  const code = await create(host, 'M33CH');
  await wait(host); await host.screenshot({ path: `${out}/phone-390-1-empty.png` });
  const guest = await desk();
  await join(guest, code, 'Keisha', 2);
  await host.getByRole('button', { name: 'Turn camera on' }).click().catch(() => {});
  await wait(host, 2500); await host.screenshot({ path: `${out}/phone-390-2-two-seated.png` });
  for (const s of [1, 3]) await host.getByTestId(`lobby-seat-${s}`).getByRole('button', { name: /Add a bot/ }).click();
  await wait(host); await host.screenshot({ path: `${out}/phone-390-3-full-ready.png` });
  await host.screenshot({ path: `${out}/phone-390-3-full-ready-fullpage.png`, fullPage: true });
  await guest.getByTestId('team-name-edit').click().catch(() => {});
  await wait(guest, 500); await guest.screenshot({ path: `${out}/desktop-1440.png` });
  const h3 = await desk(); const c3 = await create(h3, 'M33CH');
  await h3.locator('.mode', { hasText: /3 players/i }).first().click(); await wait(h3, 800);
  const g3 = await phone(); await join(g3, c3, 'Keisha', null);
  const open = g3.locator('[data-testid^="lobby-seat-"] button[aria-label="Sit here"]').first();
  await open.click({ timeout: 8000 }).catch(() => console.log('no open seat'));
  await wait(g3); await g3.screenshot({ path: `${out}/phone-390-cutthroat.png` });
  console.log('ok');
} finally { await b.close(); }
