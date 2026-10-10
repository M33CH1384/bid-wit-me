/**
 * Menu sheets + top-right button pair: screenshots and measurements at iPhone Safari's visible area (390x664),
 * a short Mac window (1024x640) and 1440x900: start screen with More options open (House rules expanded too),
 * the sound popover, and the in-game top-right buttons.
 * Usage: node scripts/menu-shots.mjs [outDir] [prefix=after] [web=http://localhost:4173]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'screenshots/release-3';
const prefix = process.argv[3] ?? 'after';
const base = process.argv[4] ?? 'http://localhost:4173';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SIZES = [['iphone', 390, 664, true], ['mac', 1024, 640, false], ['desktop', 1440, 900, false]];
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }; }, sel);
for (const [label, w, h, mobile] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, ...(mobile ? { userAgent: UA } : {}) });
  const p = await ctx.newPage();
  await p.goto(base); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'normal', quality: 'low' })); });
  await p.goto(base); await p.getByTestId('more').waitFor(); await p.waitForTimeout(800);
  const gear = await rect(p, '[data-testid="more"]'), snd = await rect(p, '[data-testid="sound-button"]');
  await p.screenshot({ path: `${out}/${prefix}-start-buttons-${w}x${h}.png`, clip: { x: Math.max(0, w - 160), y: 0, width: 160, height: 80 } });
  await p.getByTestId('more').click(); await p.waitForTimeout(700);
  const sheet = await rect(p, '[data-testid="more-options"]');
  await p.screenshot({ path: `${out}/${prefix}-more-options-${w}x${h}.png` });
  await p.getByRole('button', { name: /House rules/ }).click(); await p.waitForTimeout(400);
  const sheetH = await rect(p, '[data-testid="more-options"]');
  const scrolls = await p.evaluate(() => { const s = document.querySelector('[data-testid="more-options"] .sheet-body'); return s ? s.scrollHeight > s.clientHeight + 2 : null; });
  await p.evaluate(() => { const s = document.querySelector('[data-testid="more-options"] .sheet-body'); if (s) s.scrollTop = s.scrollHeight; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${prefix}-house-rules-scrolled-${w}x${h}.png` });
  await p.keyboard.press('Escape'); await p.locator('[data-testid="more-options"] [aria-label="Close"], [data-testid="more-options"] .sheet-head button').first().click().catch(() => {});
  await p.waitForTimeout(300);
  await p.getByTestId('sound-button').click(); await p.waitForTimeout(500);
  const pop = await rect(p, '.sound-pop');
  await p.screenshot({ path: `${out}/${prefix}-sound-popover-${w}x${h}.png` });
  console.log(JSON.stringify({ label, w, h, gear, snd, sheet, sheetHouse: sheetH, houseScrolls: scrolls, pop }));
  await ctx.close();
}
await b.close();
