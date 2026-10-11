/**
 * Release 5 captures: DEALER chip, ON NOTICE, SHOT OUT game over, locked rules (offline score pad), Run it! zoom with
 * the slick line, Talk trash quick chat. (The WebKit Big-over-Little nuke frame comes from scripts/nuke-probe.mjs.)
 * Usage: node scripts/release5-shots.mjs [web=http://localhost:4173]   (SHOTS_OUT=screenshots/release-5, SIZE=1280x720)
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = process.env.SHOTS_OUT ?? 'screenshots/release-5';
mkdirSync(out, { recursive: true });
const [vw, vh] = (process.env.SIZE ?? '1280x720').split('x').map(Number);
const sfx = process.env.SIZE ? `-${process.env.SIZE}` : '';
const state = (...a) => execFileSync('npx', ['tsx', ...a], { encoding: 'utf8' });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
async function open(save) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 600, hasTouch: vw < 600 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base);
  await p.evaluate((save) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', save); }, save);
  await p.goto(base);
  return { p, ctx };
}
const shot = (p, name) => p.screenshot({ path: `${out}/${name}${sfx}.png` }).then(() => console.log('shot', name));

// 1) ON NOTICE + DEALER chip (a new hand right after a side got shot)
{
  const { p, ctx } = await open(state('scripts/release5-state.ts', 'notice'));
  await p.locator('[data-testid^="notice-"]').first().waitFor({ timeout: 60000 });
  await p.locator('[data-testid^="dealer-"]').first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(2500);
  await shot(p, 'on-notice-dealer');
  const d = p.locator('[data-testid^="dealer-"]').first();
  await d.scrollIntoViewIfNeeded();
  const box = await d.locator('xpath=ancestor::div[starts-with(@data-testid,"seat-")]').boundingBox();
  if (box) await p.screenshot({ path: `${out}/dealer-chip${sfx}.png`, clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 30), width: Math.min(vw, box.width + 80), height: Math.min(vh, box.height + 60) } });
  // locked house rules (offline): score pad
  await p.locator('[data-testid="scorepad-button"], button[aria-label*="Score"]').first().click({ timeout: 5000 }).catch(() => {});
  const det = p.getByTestId('locked-rules-details');
  if (await det.count()) { await det.locator('summary').click(); await p.waitForTimeout(400); await shot(p, 'locked-rules-offline'); }
  else console.log('! no score pad / locked rules found');
  // talk trash quick chat
  await p.keyboard.press('Escape').catch(() => {});
  await p.locator('.modal-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await p.getByTestId('talk-trash').click();
  await p.getByTestId('trash-pop').waitFor();
  await shot(p, 'talk-trash-menu');
  await p.locator('.trash-line').first().click();
  await p.getByTestId('trash-callout').waitFor({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(400);
  await shot(p, 'talk-trash-callout');
  await ctx.close();
}
// 2) SHOT OUT game over
{
  const { p, ctx } = await open(state('scripts/release5-state.ts', 'shotout'));
  const card = p.locator('[data-testid^="card-"]').first();
  await card.waitFor({ timeout: 60000 });
  await p.waitForTimeout(2000);
  await card.dispatchEvent('click'); await p.waitForTimeout(250); await card.dispatchEvent('click');
  await p.getByTestId('shot-out').waitFor({ timeout: 40000 });
  await p.waitForTimeout(1500);
  await shot(p, 'shot-out-game-over');
  await ctx.close();
}
// 3) Run it! zoom with the slick line
{
  const { p, ctx } = await open(state('scripts/runit-state.ts', 'joker', process.env.RUN_CARDS ?? '4'));
  await p.getByTestId('run-it').waitFor({ timeout: 60000 });
  await p.waitForTimeout(1200);
  // software-GL screenshots take ~1-2 s each, so stretch the app's long timers ×8 for the capture only (CSS anims untouched)
  const SLOW = 8;
  await p.evaluate((k) => { const st = window.setTimeout; window.setTimeout = ((f, ms, ...a) => st(f, (ms ?? 0) >= 300 ? ms * k : ms, ...a)); }, SLOW);
  await p.getByTestId('run-it').dispatchEvent('click');
  await p.getByTestId('run-zoom').waitFor({ timeout: 5000 });
  await p.getByTestId('run-line').waitFor({ timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(900);
  await shot(p, 'run-it-zoom');
  await p.getByTestId('run-zoom').waitFor({ state: 'detached', timeout: 30000 });
  await p.waitForTimeout(150);
  await shot(p, 'run-it-slam-tornado'); // (software GL: the capture lands ~1 s late, i.e. on the RAN IT! tornado)
  await ctx.close();
}
await b.close();
console.log(errors.length ? `page errors: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
