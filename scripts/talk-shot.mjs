/**
 * Dev helper: open a saved game at hand-over (from scripts/gen-save.ts) and screenshot Table Talk.
 * Usage: node scripts/talk-shot.mjs <save.json> <w> <h> <out.png>
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [file, w, h, out] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:4173';
const save = readFileSync(file, 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
p.on('pageerror', (e) => console.error('pageerror', String(e)));
await p.goto(base);
await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', s); }, save);
await p.goto(base);
await p.getByTestId('table-talk').waitFor({ timeout: 60000 });
await p.waitForTimeout(1500);
const o = await p.evaluate(() => {
  const el = document.querySelector('.tt');
  const over = [...document.querySelectorAll('.tt *')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).map((x) => x.className).slice(0, 5);
  return { sw: document.documentElement.scrollWidth, iw: innerWidth, tt: el?.getBoundingClientRect().toJSON(), over };
});
console.log(JSON.stringify(o));
await p.screenshot({ path: out });
await b.close();
