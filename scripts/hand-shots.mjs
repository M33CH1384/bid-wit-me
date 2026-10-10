/**
 * Desktop hand on your turn when only some cards are playable (follow suit): shows the dimmed / glowing contrast.
 * Usage: node scripts/hand-shots.mjs <outFile> [web=http://localhost:4173] [w=1440] [h=900]
 */
import { chromium } from 'playwright-core';
const outFile = process.argv[2] ?? 'screenshots/release-3/hand.png';
const base = process.argv[3] ?? 'http://localhost:4173';
const w = Number(process.argv[4] ?? 1440), h = Number(process.argv[5] ?? 900);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', blindNil: 'never', quality: 'high', firstHandBidsItself: true })); });
await p.goto(`${base}/?autostart=1&seed=hand-contrast`);
const all = p.locator('[data-testid^="card-"]'), legal = p.locator('[data-testid^="card-"][data-legal="true"]');
let ok = false;
for (let i = 0; i < 3000; i++) {
  const n = await legal.count();
  if (n) {
    const total = await all.count();
    if (n < total && n >= 2) { ok = true; break; }
    const c = legal.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {});
  }
  const bid = p.locator('.bid-grid button'); if (await bid.count()) await bid.nth(2).click().catch(() => {});
  await p.waitForTimeout(60);
}
await p.waitForTimeout(1500);
await p.screenshot({ path: outFile });
console.log(ok ? 'shot' : 'no follow-suit turn found', outFile);
await b.close();
