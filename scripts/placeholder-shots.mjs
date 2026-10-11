/** Captures the styled stand-in table while the 3D table loads (throttled), phone + desktop → screenshots/release-6/. */
import { chromium } from 'playwright-core';
const web = process.argv[2] ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
try {
  for (const [w, h, name] of [[390, 844, 'phone'], [1440, 900, 'desktop']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500 });
    await ctx.addInitScript(() => { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 90000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(web);
    await page.getByTestId('play-bots').click({ timeout: 60000 }); await page.getByTestId('mode-joker').click();
    await page.getByTestId('start-bots').click();
    await page.getByTestId('table-placeholder').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `screenshots/release-6/table-placeholder-${name}.png` });
    await ctx.close();
  }
} finally { await browser.close(); }
console.log('PLACEHOLDER OK');
