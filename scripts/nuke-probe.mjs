/**
 * Nuke regression probe: loads a forced save (scripts/nuke-state.ts) where your next card drops the second Joker on a
 * trick, plays it, and reports whether the 3D blast ran (fx 'nuke' fired, Nuke3D mounted and advanced) under each
 * engine / OS reduced-motion / graphics combo.
 * Usage: node scripts/nuke-probe.mjs [web=http://localhost:4173]   env: ENGINES=chromium,webkit ORDERS=lb,bl RM=no-preference,reduce Q=high,low
 */
import { chromium, webkit } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const list = (k, d) => (process.env[k] ?? d).split(',');
const out = process.env.SHOTS_OUT ?? 'screenshots/nuke-bug';
mkdirSync(out, { recursive: true });
const saves = {};
for (const o of list('ORDERS', 'lb,bl')) {
  const res = execFileSync('npx', ['tsx', 'scripts/nuke-state.ts', o, 'mid'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  saves[o] = { save: res, card: o === 'lb' ? 'BJ' : 'LJ' };
}
let fails = 0;
for (const eng of list('ENGINES', 'chromium,webkit')) {
  const b = eng === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  for (const rm of list('RM', 'no-preference,reduce')) for (const q of list('Q', 'high,low')) for (const [o, { save, card }] of Object.entries(saves)) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: rm });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' || /shader|webgl/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
    await p.goto(base);
    const s = JSON.parse(save); s.settings.quality = q;
    await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', JSON.stringify(s)); }, s);
    await p.goto(base);
    const c = p.getByTestId(`card-${card}`);
    await c.waitFor({ timeout: 60000 });
    await p.waitForTimeout(1500);
    await c.dispatchEvent('click'); await p.waitForTimeout(250); await c.dispatchEvent('click');
    let r = { fired: 0, active: false, maxT: 0, flash: false, calm: false };
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const x = await p.evaluate(() => ({ fired: window.__bwmFx?.fired?.nuke ?? 0, active: !!window.__bwmNuke?.active, T: window.__bwmNukeT ?? 0, flash: !!document.querySelector('[data-testid="nuke-flash"]'), calm: !!document.querySelector('.nuke-banner.calm'), mode: window.__bwmFx?.nukeMode }));
      r = { ...r, fired: x.fired, mode: x.mode, active: r.active || x.active, maxT: Math.max(r.maxT, x.T), flash: r.flash || x.flash, calm: r.calm || x.calm };
      if (x.active && x.T > 0.7 && !r.shot) { await p.screenshot({ path: `${out}/${eng}-${rm}-${q}-${o}.png` }); r.shot = true; }
      if (r.maxT > 0.7 && r.shot) break;
      if (x.fired && x.mode === 'off' && Date.now() - t0 > 6000) break;
      await p.waitForTimeout(150);
    }
    const ok = r.fired > 0 && r.active && r.maxT > 0.5; // (software GL: the first blast frame can take seconds while shaders compile)
    if (!ok) fails++;
    console.log(`${ok ? '✓' : '✗'} ${eng} reducedMotion=${rm} quality=${q} ${o === 'lb' ? 'Little→Big' : 'Big→Little'}: fired=${r.fired} mode=${r.mode} blast=${r.active} T=${r.maxT.toFixed(2)} flash=${r.flash} calmBanner=${r.calm}${errs.length ? ` errors: ${errs.slice(0, 3).join(' | ')}` : ''}`);
    await ctx.close();
  }
  await b.close();
}
console.log(fails ? `${fails} NUKE PROBE FAILURE(S)` : 'NUKE PROBE OK');
process.exit(fails ? 1 : 0);
