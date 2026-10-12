/** Social v2 screenshots → screenshots/social-v2/ (phone 390). Live presence: run when few others are online. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'https://bid-wit-me.pages.dev';
const out = 'screenshots/social-v2'; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const phone = async () => { const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage(); await p.goto(base); await p.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }))); await p.goto(base); return p; };
try {
  const p = await phone();
  await p.getByTestId('play-online').click(); await p.getByTestId('open-tables').waitFor(); await p.waitForTimeout(3000);
  await p.screenshot({ path: `${out}/phone-390-open-tables-empty.png` });
  await p.getByTestId('social-btn').first().click(); await p.getByTestId('social-panel').waitFor(); await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/phone-390-social-empty.png` });
  await p.getByTestId('social-gear').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/phone-390-social-gear-menu.png` });
  await p.getByTestId('social-gear').click();
  const others = [];
  for (const n of [1, 2, 3]) { const q = await phone(); await q.getByTestId('social-btn').first().click().catch(() => {}); others.push(q); }
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${out}/phone-390-social-players.png` });
  await p.getByTestId('soc-tab-chat').click(); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/phone-390-social-chat.png` });
  await p.getByTestId('soc-tab-friends').click(); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/phone-390-social-friends.png` });
  console.log('ok');
} finally { await b.close(); }
