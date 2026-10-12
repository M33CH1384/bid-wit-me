/** Social "just you" empty state, off-table and at a table, against a local server (http://localhost:4173 + wrangler dev). */
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = 'screenshots/social-v2';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
  await p.goto(base); await p.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }))); await p.goto(base + '/?server=http://127.0.0.1:8787');
  await p.getByTestId('play-online').click(); await p.waitForTimeout(1500);
  await p.getByTestId('social-btn').first().click(); await p.getByTestId('soc-alone').waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/phone-390-social-empty-home.png` });
  await p.getByTestId('social-close').click();
  await p.goto(`${base}/online`); await p.getByLabel('Your name').fill('M33CH'); await p.getByTestId('create-table').click();
  await p.getByTestId('lobby').waitFor({ timeout: 25000 }); await p.waitForTimeout(1500);
  await p.getByTestId('social-btn').first().click(); await p.getByTestId('alone-share-code').waitFor({ timeout: 30000 }); await p.waitForTimeout(1000);
  await p.screenshot({ path: `${out}/phone-390-social-empty-table.png` });
  console.log('ok');
} finally { await b.close(); }
