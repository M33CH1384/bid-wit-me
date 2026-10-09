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

// [label, viewport, dpr, mobile, mode] — iPhone SE/8, iPhone 12–15, iPhone Pro Max, desktop, + a 17-card 3-player hand on the narrowest phone
const sizes = [
  ['iphone-375x667', { width: 375, height: 667 }, 2, true, 'joker'],
  ['iphone-390x844', { width: 390, height: 844 }, 2, true, 'joker'],
  ['iphone-430x932', { width: 430, height: 932 }, 2, true, 'joker'],
  ['desktop-1280x800', { width: 1280, height: 800 }, 1, false, 'joker'],
  ['iphone-375x667-3p', { width: 375, height: 667 }, 2, true, 'cutthroat3'],
];

for (const [label, viewport, dpr, mobile, sizeMode] of sizes) {
  if (only && !label.startsWith(only)) continue;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  const shot = (name) => page.screenshot({ path: `${out}/${label}-${name}.png` });

  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  if (sizeMode === 'joker') await shot('1-start');
  if (label === 'iphone-390x844') {
    await page.getByRole('button', { name: /Credits/ }).click();
    await page.getByRole('dialog', { name: 'Credits' }).waitFor();
    await shot('6-credits');
    await page.getByRole('dialog', { name: 'Credits' }).getByRole('button', { name: 'Close' }).click();
  }

  const mode = process.env.MODE ?? sizeMode;
  await page.evaluate(([m, q]) => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: m, speed: 'fast', quality: q })), [mode, process.env.Q ?? 'high']);
  await page.goto(`${base}/?autostart=1&seed=${process.env.SEED ?? 'shots-3d-7'}`);
  // bidding: wait for our bid grid (or blind-nil prompt)
  await page.locator('.bid-grid button, .bid-panel button.primary').first().waitFor({ timeout: 60000 });
  if (await page.getByRole('button', { name: 'See my cards' }).count()) await page.getByRole('button', { name: 'See my cards' }).click();
  await page.waitForSelector('.bid-grid button', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot('2-bidding');
  await page.locator('.bid-grid button').nth(2).click();

  const legal = () => page.locator('[data-testid^="card-"][data-legal="true"]');
  const handSize = () => page.locator('[data-testid^="card-"]').count();
  const trickCount = async () => Number(await page.getByTestId('hand').getAttribute('data-trick-count'));

  // first turn with the full hand: lift the right-most playable card (worst case for right-edge clipping)
  for (let i = 0; i < 600 && !(await legal().count()); i++) await page.waitForTimeout(120);
  const full = await handSize();
  await legal().last().dispatchEvent('click');
  await page.waitForTimeout(1500);
  await shot(`3-first-turn-${full}-cards`);
  await legal().last().dispatchEvent('click');

  // mid-hand: our turn with ≥2 cards on the table and a partly played hand
  for (let i = 0; i < 900; i++) {
    const n = await legal().count();
    if (n && (await trickCount()) >= 2 && (await handSize()) <= full - 4) break;
    if (n) { await legal().first().dispatchEvent('click'); await legal().first().dispatchEvent('click'); }
    await page.waitForTimeout(120);
  }
  await legal().last().dispatchEvent('click');
  await page.waitForTimeout(3000);
  await shot('4-mid-hand');
  if (label === 'iphone-390x844' || label.startsWith('desktop')) {
    await page.getByTestId('sound-button').click();
    await page.getByTestId('music-switch').click();
    await page.getByTestId('now-playing').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await shot('5-sound-now-playing');
  }
  await ctx.close();
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok');
