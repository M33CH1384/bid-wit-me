/** Release 9 shot popup screenshots (phone 390 + desktop): offline save where the other team gets shot.
 * Needs vite preview on :4173. Usage: node scripts/shot-popup-shots.mjs [web=http://localhost:4173] */
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173';
const save = execFileSync('npx', ['tsx', 'scripts/handend-state.ts'], { encoding: 'utf8', env: { ...process.env, SHOT: '1' } });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const [tag, vp, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', s); }, save);
  await page.goto(base);
  const bj = page.locator('[data-testid="card-BJ"][data-legal="true"]');
  await bj.waitFor({ timeout: 60000 });
  await bj.dispatchEvent('click'); await bj.dispatchEvent('click', {}, { timeout: 2000 }).catch(() => {});
  await page.waitForSelector('[data-testid="table-talk"] .tt-team.blast', { timeout: 45000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `screenshots/release-9/shot-popup-${tag}.png` });
  console.log(`✓ shot-popup-${tag}: blast panels ${(await page.evaluate(() => document.querySelectorAll('.tt-team.blast').length))}`);
  await ctx.close();
}
await browser.close();
