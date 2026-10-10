/**
 * Mid-animation screenshots of the Wheels celebration (supercar peel-out) on desktop + phone.
 * Usage: node scripts/wheels-shot.mjs [web=http://localhost:4173]
 */
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'phone' ? 2 : 1 })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low' })); });
  await p.goto(`${base}/?autostart=1&seed=wheels-shot`);
  await p.waitForTimeout(6000);
  await p.mouse.click(5, h - 5).catch(() => {});
  await p.evaluate(() => window.__bwmFx.emit('wheelsCar', { text: 'You + Fatima made 10 · took 11' }));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `screenshots/release-3/15a-wheels-revving-${tag}.png` });
  await p.waitForTimeout(600);
  // freeze the CSS animations mid peel-out (screenshots are slow under software GL)
  await p.evaluate(() => document.getAnimations().filter((a) => /wc-|wheels/.test(a.animationName ?? '')).forEach((a) => { a.pause(); a.currentTime = 1250; }));
  await p.waitForTimeout(100);
  await p.screenshot({ path: `screenshots/release-3/15b-wheels-peel-out-${tag}.png` });
  await p.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await p.waitForTimeout(2600);
  const left = await p.getByTestId('wheels-fx').count();
  if (left) errors.push(`${tag}: celebration still on screen after 3.4 s`);
  console.log(`✓ ${tag} shots; fired`, await p.evaluate(() => window.__bwmFx.fired.wheelsCar));
  await p.close();
}
await b.close();
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'WHEELS OK');
