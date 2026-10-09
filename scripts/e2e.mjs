/**
 * Browser smoke test: drives the built app (vite preview) with headless Chrome, plays one full game per mode
 * through the UI as the human seat, and saves screenshots to ./screenshots.
 * Usage: node scripts/e2e.mjs [baseUrl=http://localhost:4173] [chromePath=/usr/bin/google-chrome]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173';
const executablePath = process.argv[3] ?? '/usr/bin/google-chrome';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const shot = (name) => page.screenshot({ path: `screenshots/${name}.png` });

// 1. Setup screen (default settings, house rules open)
await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByText('House rules').click();
await shot('01-setup');
await page.getByRole('button', { name: /^Cutthroat\b/ }).first().click();
await page.getByRole('radio', { name: 'Standard 52' }).click();
await shot('01b-setup-cutthroat-deck');
await page.evaluate(() => localStorage.clear());

async function playGame(mode, label, { shots = false, speed = 'turbo', extra = {} } = {}) {
  await page.evaluate(([m, sp, ex]) => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: m, speed: sp, blindNil: 'always', ...ex })), [mode, speed, extra]);
  await page.goto(`${base}/?autostart=1&seed=e2e-${mode}-${extra.cutthroatDeck ?? ''}`);
  let hands = 0, plays = 0, tookBidShot = false, tookTrickShot = false, tookSummary = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 420_000) {
    if (await page.locator('.gameover').count()) break;
    const next = page.getByRole('button', { name: 'Next hand' });
    if (await next.count()) {
      if (shots && !tookSummary) { await shot('04-hand-summary'); tookSummary = true; }
      await next.click(); hands++; continue;
    }
    const see = page.getByRole('button', { name: 'See my cards' });
    if (await see.count()) { await see.click(); continue; }
    const bidBtn = page.locator('.bid-grid button').first();
    if (await bidBtn.count()) {
      if (shots && !tookBidShot) { await shot('02-bidding'); tookBidShot = true; }
      const btns = page.locator('.bid-grid button');
      const n = await btns.count();
      await btns.nth(Math.min(2, n - 1)).click(); continue;
    }
    const pass = page.getByRole('button', { name: 'Pass cards' });
    if (await pass.count()) {
      const cards = page.locator('.hand .card');
      await cards.nth(0).click({ position: { x: 6, y: 20 } }); await cards.nth(1).click({ position: { x: 6, y: 20 } }); await pass.click(); continue;
    }
    const legal = page.locator('.hand .card.legal');
    if (await legal.count()) {
      if (shots && !tookTrickShot && plays >= 6 && (await page.locator('.trick .played').count()) >= 2) { await shot('03-trick'); tookTrickShot = true; }
      const c = legal.last();
      await c.click({ position: { x: 6, y: 20 } }); await c.click({ position: { x: 6, y: 20 }, timeout: 2000 }).catch(() => {}); plays++; continue;
    }
    await page.waitForTimeout(40);
  }
  const over = await page.locator('.gameover').count();
  if (!over) { await shot(`timeout-${mode}`); throw new Error(`${label}: game did not finish in time (${hands + 1} hands, ${plays} plays)`); }
  await shot(`05-gameover-${mode}${extra.cutthroatDeck === 'standard52' ? '-standard52' : ''}`);
  const title = await page.locator('.gameover h2').innerText();
  console.log(`✓ ${label}: finished via UI — ${hands + 1} hands, ${plays} human plays — "${title}" (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const only = process.env.ONLY;
const games = [
  ['joker', 'Joker Spades 2v2', { shots: true }],
  ['cutthroat4', 'Cutthroat 4p', {}],
  ['cutthroat3', 'Cutthroat 3p', {}],
  ['cutthroat4', 'Cutthroat 4p (standard 52 deck)', { extra: { cutthroatDeck: 'standard52' } }],
  ['aceDown', 'Ace Down', {}],
];
for (const [mode, label, opts] of games) if (!only || only === mode) await playGame(mode, label, opts);
if (process.env.SKIP_SHOTS) { await browser.close(); process.exit(errors.length ? 1 : 0); }

// a calm mid-game screenshot at normal speed for each table layout
for (const mode of ['joker', 'cutthroat3']) {
  await page.evaluate((m) => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: m, speed: 'fast' })), mode);
  await page.goto(`${base}/?autostart=1&seed=shot-${mode}`);
  for (let i = 0; i < 400; i++) {
    const bid = page.locator('.bid-grid button');
    if (await bid.count()) { await bid.nth(2).click(); continue; }
    const see = page.getByRole('button', { name: 'See my cards' });
    if (await see.count()) { await see.click(); continue; }
    if ((await page.locator('.hand .card.legal').count()) && (await page.locator('.trick .played').count()) >= (mode === 'joker' ? 2 : 1)) break;
    if (await page.locator('.hand .card.legal').count()) { const c = page.locator('.hand .card.legal').first(); await c.click({ position: { x: 6, y: 20 } }); await c.click({ position: { x: 6, y: 20 }, timeout: 2000 }).catch(() => {}); }
    await page.waitForTimeout(100);
  }
  await page.locator('.hand .card.legal').first().click({ position: { x: 6, y: 20 } }).catch(() => {});
  await page.waitForTimeout(150);
  await shot(`06-table-${mode}`);
}

await browser.close();
if (errors.length) { console.error('Browser errors:', errors); process.exit(1); }
console.log('UI smoke test passed; screenshots in ./screenshots');
