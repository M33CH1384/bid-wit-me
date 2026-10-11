/**
 * Release 7: every venue on phone portrait (390×844) + desktop (1280×800), mid-game (bidding, cards on the table).
 * Usage: node scripts/venue-shots.mjs [web=http://localhost:4173]   (ONLY=backyard,mansion  SHOTS_OUT=screenshots/release-7/venues  QUALITY=high|low)
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = process.env.SHOTS_OUT ?? 'screenshots/release-7/venues';
mkdirSync(out, { recursive: true });
const ALL = ['classic', 'backyard', 'mansion', 'barbershop', 'church', 'rooftop', 'speakeasy', 'vegas', 'beach', 'grandma', 'yacht'];
const only = process.env.ONLY ? process.env.ONLY.split(',') : ALL;
const sizes = (process.env.SIZES ?? 'phone,desktop').split(',');
const save = JSON.parse(execFileSync('npx', ['tsx', 'scripts/release6-state.ts', 'pad'], { encoding: 'utf8' }));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
const SIZE = { phone: [390, 844], desktop: [1280, 800] };
for (const v of only) {
  for (const label of sizes) {
    const [w, h] = SIZE[label];
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, isMobile: w < 600, hasTouch: w < 600 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${v}/${label}: ${e}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|404/.test(m.text())) errors.push(`${v}/${label} console: ${m.text()}`); });
    await p.goto(base);
    const s = { ...save, settings: { ...save.settings, venue: v, quality: process.env.QUALITY ?? 'high' } };
    await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', JSON.stringify(s)); }, s);
    await p.goto(base);
    await p.waitForFunction(() => (window).__bwmTableAt, null, { timeout: 90000 });
    // venue backdrop + floor land after the table: give them a moment (lazy, separate Suspense)
    await p.waitForLoadState('networkidle').catch(() => {});
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/${v}-${label}.png` });
    console.log('shot', `${v}-${label}`);
    await ctx.close();
  }
}
await b.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
