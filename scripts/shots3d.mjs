/**
 * 3D screenshots with WebGL (SwiftShader) in headless Chrome: start screen, bidding, mid-trick at phone + desktop sizes.
 * Usage: node scripts/shots3d.mjs [baseUrl] [chromePath]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173';
const executablePath = process.argv[3] ?? '/usr/bin/google-chrome';
const out = 'screenshots/3d';
mkdirSync(out, { recursive: true });
const only = process.env.ONLY;

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const errors = [];

const sizes = [
  ['phone', { width: 430, height: 932 }, 2, true],
  ['desktop', { width: 1280, height: 800 }, 1, false],
];

for (const [label, viewport, dpr, mobile] of sizes) {
  if (only && only !== label) continue;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  const shot = (name) => page.screenshot({ path: `${out}/${label}-${name}.png` });

  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await shot('1-start');

  const mode = process.env.MODE ?? 'joker';
  await page.evaluate(([m, q]) => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: m, speed: 'fast', quality: q })), [mode, process.env.Q ?? 'high']);
  await page.goto(`${base}/?autostart=1&seed=${process.env.SEED ?? 'shots-3d-7'}`);
  // bidding: wait for our bid grid (or blind-nil prompt)
  await page.locator('.bid-grid button, .bid-panel button.primary').first().waitFor({ timeout: 60000 });
  if (await page.getByRole('button', { name: 'See my cards' }).count()) await page.getByRole('button', { name: 'See my cards' }).click();
  await page.waitForSelector('.bid-grid button', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot('2-bidding');
  await page.locator('.bid-grid button').nth(2).click();

  // mid-trick: our turn with ≥2 cards on the table
  for (let i = 0; i < 600; i++) {
    const legal = page.locator('[data-testid^="card-"][data-legal="true"]');
    const count = Number(await page.getByTestId('hand').getAttribute('data-trick-count'));
    if ((await legal.count()) && count >= 2) break;
    if ((await legal.count()) && count < 2) { await legal.first().dispatchEvent('click'); await legal.first().dispatchEvent('click'); }
    await page.waitForTimeout(120);
  }
  // select a card (lifted) for the shot
  await page.locator('[data-testid^="card-"][data-legal="true"]').last().dispatchEvent('click');
  await page.waitForTimeout(3000);
  await shot('3-mid-trick');
  await ctx.close();
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok');
