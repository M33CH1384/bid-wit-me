import { chromium } from 'playwright-core';
const base = 'http://localhost:4173';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
  await p.goto(base); await p.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }))); await p.goto(base);
  await p.getByTestId('play-online').click(); await p.waitForTimeout(1500);
  await p.getByTestId('social-btn').first().click(); await p.getByTestId('soc-alone').waitFor({ timeout: 30000 }); await p.locator(".soc-conn.open").waitFor({ timeout: 30000 }).catch(() => console.log("conn label never open")); await p.waitForTimeout(500);
  await p.screenshot({ path: 'screenshots/social-v2/phone-390-social-empty.png' });
  console.log('ok');
} finally { await b.close(); }
