/**
 * Release 6 captures: score pad (phone + desktop), the Bots row at 390, the bid order indicator, partner talk presets,
 * plus a phone sweep (table while bidding, Table Talk) for a visual check.
 * Usage: node scripts/release6-shots.mjs [web=http://localhost:4173]   (SHOTS_OUT=screenshots/release-6)
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = process.env.SHOTS_OUT ?? 'screenshots/release-6';
mkdirSync(out, { recursive: true });
const state = (w) => execFileSync('npx', ['tsx', 'scripts/release6-state.ts', w], { encoding: 'utf8' });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
const PHONE = [390, 844], DESK = [1280, 800];
async function open([w, h], save) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, isMobile: w < 600, hasTouch: w < 600 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base);
  await p.evaluate((save) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); if (save) localStorage.setItem('bwm.game', save); }, save);
  await p.goto(base);
  return { p, ctx };
}
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` }).then(() => console.log('shot', name));

// 1) Bots row at 390 (wizard essentials)
{
  const { p, ctx } = await open(PHONE);
  await p.getByTestId('play-bots').click();
  await p.getByTestId('mode-joker').click();
  await p.getByTestId('bots-row').waitFor();
  await p.waitForTimeout(500);
  await shot(p, 'bots-row-390');
  await ctx.close();
}
// 2) partner talk + bid order inside the bid panel (my turn, partner bot hasn't bid → its hint lands partner-only)
for (const [label, size] of [['phone', PHONE], ['desktop', DESK]]) {
  const save = state('bidme');
  const { p, ctx } = await open(size, save);
  await p.getByTestId('partner-talk').waitFor({ timeout: 60000 });
  await p.waitForTimeout(1500);
  await shot(p, `partner-talk-${label}`);
  await p.locator('[data-testid="pt-3-ish"]').click();
  if (label === 'desktop' || true) {
    const chat = p.locator('.chat.open');
    if (!(await chat.count())) await p.getByRole('button', { name: 'Toggle chat' }).click();
  }
  await p.locator('.chat-line', { hasText: '3-ish' }).first().waitFor({ timeout: 5000 });
  await p.waitForTimeout(600);
  await shot(p, `partner-talk-chat-${label}`);
  await ctx.close();
}
// 3) BID ORDER strip while an opponent bids
for (const [label, size] of [['phone', PHONE], ['desktop', DESK]]) {
  const { p, ctx } = await open(size, state('bidwait'));
  await p.getByTestId('bid-order').waitFor({ timeout: 60000 });
  await p.waitForTimeout(300);
  await shot(p, `bid-order-${label}`);
  await ctx.close();
}
// 4) score pad (phone + desktop)
for (const [label, size] of [['phone', PHONE], ['desktop', DESK], ['phone-375', [375, 667]]]) {
  const { p, ctx } = await open(size, state('pad'));
  await p.getByTestId('scorepad-button').waitFor({ timeout: 60000 });
  await p.waitForTimeout(1200);
  await p.getByTestId('scorepad-button').click();
  await p.getByTestId('score-pad').waitFor();
  await p.locator('.pad-hand.last .pts summary').first().click();
  await p.waitForTimeout(400);
  await shot(p, `score-pad-${label}`);
  await ctx.close();
}
await b.close();
console.log(errors.length ? `page errors: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
