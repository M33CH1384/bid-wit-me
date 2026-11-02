/**
 * Photoreal overlays at 390×844 portrait and 844×390 landscape on a real table (forced save from scripts/nuke-state.ts),
 * one pinned frame per effect via window.__bwmPhotorealPreview(name, t). Also records the projected table box.
 * Usage: node scripts/photoreal-shots.mjs [web=http://localhost:4173] [out=screenshots/photoreal]
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'screenshots/photoreal';
mkdirSync(out, { recursive: true });
const save = execFileSync('npx', ['tsx', 'scripts/nuke-state.ts', 'lb', 'mid'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const SHOTS = (process.env.SHOTS ?? 'lightning:0.62,meteor:1.45,quake:1.2,goldrain:2.2,nuke:0.9,nuke:1.6,nuke:2.6').split(',').map((x) => { const [n, t] = x.split(':'); return [n, Number(t)]; });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0;
for (const [w, h, tag] of [[390, 844, 'portrait'], [844, 390, 'landscape']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base);
  await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', s); }, save);
  await p.goto(base);
  await p.getByText(/resume game/i).first().click({ timeout: 30000 }).catch(() => {});
  await p.getByTestId('card-BJ').waitFor({ state: 'attached', timeout: 90000 }).catch(async (e) => { await p.screenshot({ path: `${out}/${tag}-FAIL.png` }); throw e; });
  await p.waitForFunction(() => typeof window.__bwmPhotorealPreview === 'function' && window.__bwmLayout?.table, null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  const table = await p.evaluate(() => window.__bwmLayout.table);
  console.log(tag, 'table', JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, Math.round(v)]))));
  await p.screenshot({ path: `${out}/${tag}-table.png` });
  for (const [name, t] of SHOTS) {
    await p.evaluate(([n, t]) => window.__bwmPhotorealPreview(n, t), [name, t]);
    await p.waitForSelector(`canvas.photoreal-${name}`, { timeout: 20000 });
    await p.waitForTimeout(600);
    const box = await p.evaluate((n) => { const c = document.querySelector(`canvas.photoreal-${n}`); return { tf: c.style.transform, origin: c.style.transformOrigin }; }, name);
    await p.screenshot({ path: `${out}/${tag}-${name}${name === 'nuke' ? '-' + t : ''}.png` });
    console.log(tag, name, `t=${t}`, JSON.stringify(box));
    await p.evaluate((n) => document.querySelectorAll(`canvas.photoreal-${n}`).forEach((c) => c.remove()), name);
  }
  if (errs.length) { fails++; console.log(tag, 'errors', errs.slice(0, 3)); }
  await ctx.close();
}
await b.close();
process.exit(fails ? 1 : 0);
