/**
 * Browser smoke test: drives the built app (vite preview) with headless Chrome, plays one full game per mode
 * through the UI as the human seat, and saves screenshots to ./screenshots.
 * The table is a WebGL (three.js) scene, so Chrome runs with SwiftShader; cards are driven through the
 * accessible hidden hand buttons (data-testid="card-XX", data-legal) that mirror the 3D hand.
 * Usage: node scripts/e2e.mjs [baseUrl=http://localhost:4173] [chromePath=/usr/bin/google-chrome]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173';
const executablePath = process.argv[3] ?? '/usr/bin/google-chrome';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const tap = async (loc) => { await loc.dispatchEvent('click'); };
const legalCards = () => page.locator('[data-testid^="card-"][data-legal="true"]');
const trickCount = async () => Number(await page.getByTestId('hand').getAttribute('data-trick-count').catch(() => 0));

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
  await page.evaluate(([m, sp, ex]) => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: m, speed: sp, blindNil: 'always', quality: 'low', ...ex })), [mode, speed, extra]);
  await page.goto(`${base}/?autostart=1&seed=e2e-${mode}-${extra.cutthroatDeck ?? ''}`);
  let hands = 0, plays = 0, tookBidShot = false, tookTrickShot = false, tookSummary = false;
  if (shots) { // a real (trusted) tap unlocks Web Audio, as on iOS; toggle the sound popover open/closed
    const sb = page.getByTestId('sound-button');
    await sb.waitFor({ timeout: 30000 }); await sb.click(); await page.getByRole('dialog', { name: 'Sound' }).waitFor();
    await page.getByTestId('music-switch').click(); // music on (lazy-loads the playlist)
    await page.getByTestId('now-playing').waitFor({ timeout: 10000 });
    await sb.click();
  }
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
    const pass = page.getByRole('button', { name: /^Pass cards/ });
    if (await pass.count()) {
      const cards = page.locator('[data-testid^="card-"]');
      await tap(cards.nth(0)); await tap(cards.nth(1)); await pass.click(); continue;
    }
    const legal = legalCards();
    if (await legal.count()) {
      if (shots && !tookTrickShot && plays >= 6 && (await trickCount()) >= 2) { await shot('03-trick'); tookTrickShot = true; }
      const c = legal.last();
      await tap(c); await tap(c).catch(() => {}); plays++; continue;
    }
    await page.waitForTimeout(40);
  }
  const over = await page.locator('.gameover').count();
  if (!over) { await shot(`timeout-${mode}`); throw new Error(`${label}: game did not finish in time (${hands + 1} hands, ${plays} plays)`); }
  await shot(`05-gameover-${mode}${extra.cutthroatDeck === 'standard52' ? '-standard52' : ''}`);
  const title = await page.locator('.gameover h2').innerText();
  if (shots) {
    await page.waitForTimeout(800);
    const snd = await page.evaluate(() => { const s = window.__bwmSound; return { state: s.state, loaded: s.loaded, played: s.played }; });
    const need = ['shuffle', 'deal', 'play', 'sweep', 'turn', 'bid', 'tap'];
    const missing = need.filter((k) => !snd.played[k]);
    if (snd.state !== 'running' || snd.loaded < 12 || missing.length || !(snd.played.win || snd.played.lose) || !(snd.played.made || snd.played.set || snd.played.nil))
      throw new Error(`sound check failed: ${JSON.stringify(snd)} missing=${missing}`);
    console.log(`  ♪ sound: context ${snd.state}, ${snd.loaded} samples, cues ${JSON.stringify(snd.played)}`);
    // music: playing, then force a crossfade by seeking near the end and check the next (different) track starts
    const m1 = await page.evaluate(() => ({ status: window.__bwmSound.musicStatus, title: window.__bwmSound.nowPlaying?.track.title }));
    if (m1.status !== 'playing') throw new Error(`music not playing: ${JSON.stringify(m1)}`);
    await page.evaluate(() => { const s = window.__bwmSound; const d = s.decks[s.active]; d.el.currentTime = Math.max(0, d.el.duration - 6); });
    await page.waitForTimeout(9000);
    const m2 = await page.evaluate(() => ({ status: window.__bwmSound.musicStatus, title: window.__bwmSound.nowPlaying?.track.title, paused: window.__bwmSound.decks.map((d) => d.el.paused) }));
    if (m2.status !== 'playing' || !m2.title || m2.title === m1.title) throw new Error(`music crossfade failed: ${JSON.stringify([m1, m2])}`);
    console.log(`  ♫ music: "${m1.title}" → crossfade → "${m2.title}"`);
  }
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
  await page.evaluate((m) => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: m, speed: 'fast', quality: 'high' })), mode);
  await page.goto(`${base}/?autostart=1&seed=shot-${mode}`);
  for (let i = 0; i < 400; i++) {
    const bid = page.locator('.bid-grid button');
    if (await bid.count()) { await bid.nth(2).click(); continue; }
    const see = page.getByRole('button', { name: 'See my cards' });
    if (await see.count()) { await see.click(); continue; }
    if ((await legalCards().count()) && (await trickCount()) >= (mode === 'joker' ? 2 : 1)) break;
    if (await legalCards().count()) { const c = legalCards().first(); await tap(c); await tap(c).catch(() => {}); }
    await page.waitForTimeout(100);
  }
  await tap(legalCards().first()).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(`06-table-${mode}`);
}

await browser.close();
if (errors.length) { console.error('Browser errors:', errors); process.exit(1); }
console.log('UI smoke test passed; screenshots in ./screenshots');
