/** Lobby v7: phone lobby (no music block) + speaker sheet with host music → screenshots/lobby-v7/ */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'https://bid-wit-me.pages.dev';
const out = 'screenshots/lobby-v7'; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
  await p.goto(base); await p.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })));
  await p.goto(`${base}/online`); await p.getByLabel('Your name').fill('M33CH'); await p.getByTestId('create-table').click();
  await p.getByTestId('lobby').waitFor({ timeout: 25000 }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/phone-390-lobby.png` });
  await p.screenshot({ path: `${out}/phone-390-lobby-fullpage.png`, fullPage: true });
  await p.getByTestId('sound-button').first().click(); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/phone-390-sound-sheet.png` });
  const hm = p.getByTestId('host-music').first();
  await hm.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/phone-390-sound-sheet-host-music.png` });
  console.log('ok', await hm.count());
} finally { await b.close(); }
