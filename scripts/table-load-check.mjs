/**
 * Time-to-table on a throttled phone profile (cold cache each run): splash → Bots → Joker → "Deal me in" → the first
 * frame with the textured 3D table (window.__bwmTableAt). Phone: 390×844 @2x, 4× CPU slowdown, ~1.6 Mbps / 150 ms RTT.
 * Usage: node scripts/table-load-check.mjs [web=http://localhost:4173] [runs=3] [dwellMs=0,2500]   (VENUE=beach: that venue; also reports when its backdrop landed)
 */
import { chromium } from 'playwright-core';

const web = process.argv[2] ?? 'http://localhost:4173';
const runs = Number(process.argv[3] ?? 3);
const dwells = (process.argv[4] ?? '0,2500').split(',').map(Number);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const out = {};
const venue = process.env.VENUE ?? 'classic';
for (const dwell of dwells) {
  const ttt = [], ttp = [], ttv = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript((venue) => {
      if (sessionStorage.getItem('init')) return;
      sessionStorage.setItem('init', '1');
      localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }));
      localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', quality: 'high', speed: 'normal', venue }));
    }, venue);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(web);
    await page.getByTestId('play-bots').waitFor({ timeout: 120000 });
    await page.getByTestId('play-bots').click();
    await page.getByTestId('mode-joker').click();
    await page.getByTestId('start-bots').waitFor();
    if (dwell) await page.waitForTimeout(dwell);
    await page.evaluate(() => { window.__t0 = performance.now(); new MutationObserver((_, o) => { if (document.querySelector('.table-placeholder, .loading3d')) { window.__ph ??= performance.now(); o.disconnect(); } }).observe(document.body, { subtree: true, childList: true }); });
    await page.getByTestId('start-bots').click();
    await page.waitForFunction(() => window.__bwmTableAt !== undefined, null, { timeout: 180000, polling: 50 });
    const r = await page.evaluate(() => ({ t: window.__bwmTableAt - window.__t0, p: window.__ph ? window.__ph - window.__t0 : null }));
    ttt.push(Math.round(r.t)); if (r.p !== null) ttp.push(Math.round(r.p));
    if (venue !== 'classic') {
      await page.waitForFunction(() => window.__bwmVenueAt !== undefined, null, { timeout: 180000, polling: 50 }).catch(() => {});
      const v = await page.evaluate(() => (window.__bwmVenueAt ? window.__bwmVenueAt - window.__t0 : null));
      if (v !== null) ttv.push(Math.round(v));
    }
    await ctx.close();
  }
  out[`dwell ${dwell} ms`] = { timeToTableMs: ttt, median: med(ttt), placeholderMs: ttp.length ? med(ttp) : null, ...(ttv.length ? { venueBackdropMs: ttv, venueMedian: med(ttv) } : {}) };
}
console.log(JSON.stringify({ web, venue, ...out }, null, 1));
await browser.close();
