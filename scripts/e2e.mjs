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

// 1. Start wizard: first-visit tips prompt → splash → mode → essentials (+ gear sheet); phone back gesture steps back
await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole('dialog', { name: 'New to Spades?' }).waitFor({ timeout: 10000 });
await shot('00-tips-prompt');
await page.getByRole('button', { name: 'No thanks' }).click();
if (JSON.parse(await page.evaluate(() => localStorage.getItem('bwm.tips'))).on !== false) throw new Error('tips should be off after "No thanks"');
await page.waitForTimeout(1300);
await shot('01-splash');
await page.getByTestId('play-bots').click();
await page.getByTestId('mode-cutthroat4').waitFor();
await page.waitForTimeout(500);
await shot('01a-mode');
await page.getByTestId('mode-cutthroat4').click();
await page.getByRole('radio', { name: 'Standard 52' }).click();
await page.waitForTimeout(500);
await shot('01b-essentials-cutthroat-deck');
if (!(await page.getByRole('switch', { name: 'Show me how to play (tips during first hand)' }).count())) throw new Error('tips toggle missing on the essentials step');
await page.getByTestId('more').click();
await page.getByRole('button', { name: /House rules/ }).click();
await shot('01c-more-options');
await page.getByRole('dialog', { name: 'More options' }).getByRole('button', { name: 'Close' }).click();
await page.goBack(); // browser / phone back gesture → previous step
await page.getByTestId('mode-joker').waitFor({ timeout: 5000 });
await page.goBack();
await page.getByTestId('play-bots').waitFor({ timeout: 5000 });
console.log('✓ Wizard: tips prompt, splash → mode → essentials, gear sheet, back gesture');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });

// 1b. Learn as you play: tips on from the first-visit prompt → coach marks during the first hand, dismissable,
//     "Skip tips" ends them for this game, "Don't show again" turns them off for good (off by default afterwards).
async function tipsTest() {
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low' })); });
  // the settings key exists, so this isn't a "first visit": tips stay off and no prompt
  await page.reload();
  await page.getByTestId('play-bots').waitFor();
  if (await page.getByRole('dialog', { name: 'New to Spades?' }).count()) throw new Error('returning player got the tips prompt');
  await page.evaluate(() => localStorage.removeItem('spades.settings.v2'));
  await page.reload();
  await page.getByRole('dialog', { name: 'New to Spades?' }).waitFor();
  await page.getByTestId('tips-yes').click();
  await page.evaluate(() => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low' })));
  await page.getByTestId('play-bots').click();
  await page.getByTestId('mode-joker').click();
  const sw = page.getByRole('switch', { name: 'Show me how to play (tips during first hand)' });
  if ((await sw.getAttribute('aria-checked')) !== 'true') throw new Error('tips toggle should be on after "Yes"');
  await page.getByTestId('start-bots').click();
  const coach = page.getByTestId('coach');
  await coach.waitFor({ timeout: 20000 });
  const seen = [];
  await page.waitForTimeout(400);
  await shot('08-tip-first');
  for (let i = 0; i < 300 && seen.length < 5; i++) {
    if (await coach.count()) {
      const id = await coach.getAttribute('data-tip');
      if (id && !seen.includes(id)) { seen.push(id); if (id === 'bid') await shot('08b-tip-bid'); }
      await page.getByTestId('coach-ok').click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    const bid = page.locator('.bid-grid button');
    if (await bid.count()) { await bid.nth(2).click().catch(() => {}); continue; }
    const l = legalCards();
    if (await l.count()) { const c = l.last(); await tap(c); await tap(c).catch(() => {}); continue; }
    await page.waitForTimeout(60);
  }
  if (!seen.includes('goal') || !seen.includes('bid') || seen.length < 4) throw new Error(`expected tips (goal, trumps, bid, …), saw ${seen}`);
  // wait for a play-phase tip, then skip the rest
  for (let i = 0; i < 400 && !(await coach.count()); i++) {
    const l = legalCards();
    if (await l.count()) { const c = l.last(); await tap(c); await tap(c).catch(() => {}); }
    await page.waitForTimeout(60);
  }
  if (await coach.count()) { seen.push(await coach.getAttribute('data-tip')); await shot('08c-tip-play'); await page.getByTestId('coach-skip').click(); }
  await page.waitForTimeout(2500);
  if (await coach.count()) throw new Error('coach still visible after "Skip tips"');
  console.log(`✓ Tips: prompt → on; coach marks ${seen.join(', ')} shown + dismissed; "Skip tips" hides them`);
  // a new game still has tips (skip is per game) → "Don't show again" turns them off for good
  await page.getByTestId('menu').click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByTestId('play-bots').click();
  await page.getByTestId('mode-joker').click();
  await page.getByTestId('start-bots').click();
  await coach.waitFor({ timeout: 20000 });
  await page.getByTestId('coach-never').click();
  if (JSON.parse(await page.evaluate(() => localStorage.getItem('bwm.tips'))).on) throw new Error('"Don\'t show again" did not turn tips off');
  await page.getByTestId('menu').click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByTestId('play-bots').click();
  await page.getByTestId('mode-joker').click();
  if ((await sw.getAttribute('aria-checked')) !== 'false') throw new Error('tips toggle should be off after "Don\'t show again"');
  await page.getByTestId('start-bots').click();
  await page.waitForTimeout(5000);
  if (await coach.count()) throw new Error('tips shown although turned off');
  console.log('✓ Tips: "Don\'t show again" → off for the next game (toggle off, no coach marks)');
  await page.getByTestId('menu').click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });
}
if (!process.env.ONLY || process.env.ONLY === 'tips') await tipsTest();

// 1c. Sound dock: on every screen; double-tap / long-press mutes everything, again restores
async function soundDockTest() {
  await page.goto(base);
  const dock = page.getByTestId('sound-button');
  await dock.waitFor();
  await page.evaluate(() => window.__bwmSound.set({ on: true, music: false }));
  await dock.dblclick();
  if (!(await page.evaluate(() => window.__bwmSound.allMuted))) throw new Error('double-tap did not mute all');
  await page.waitForTimeout(400);
  await dock.dispatchEvent('pointerdown'); await page.waitForTimeout(700); await dock.dispatchEvent('pointerup');
  if (await page.evaluate(() => window.__bwmSound.allMuted)) throw new Error('long-press did not restore sound');
  for (const step of ['play-bots', 'mode-joker']) { await page.getByTestId(step).click(); if (!(await dock.isVisible())) throw new Error(`no sound button on ${step}`); }
  await page.getByTestId('more').click(); await page.getByRole('button', { name: 'Credits & licenses' }).click();
  await page.getByRole('dialog', { name: 'Credits' }).waitFor();
  await dock.click(); await page.getByRole('dialog', { name: 'Sound' }).waitFor({ timeout: 3000 });
  await shot('09-sound-over-credits');
  console.log('✓ Sound dock: visible on splash/mode/credits; double-tap mutes all, long-press restores; popover over modals');
}
if (!process.env.ONLY || process.env.ONLY === 'tips') await soundDockTest();

// 1d. Blind Nil reveal: cards are dealt once, face-down; "See my cards" flips them in place (no second deal)
async function dealOnceTest() {
  await page.evaluate(() => { localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'normal', blindNil: 'always', quality: 'low' })); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.removeItem('bwm.game'); });
  await page.goto(`${base}/?autostart=1&seed=e2e-blind-reveal`);
  const see = page.getByRole('button', { name: /^See (my )?cards$/ });
  await see.first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => { const d = window.__bwmDealt ?? {}; const h = Object.keys(d).map(Number).sort((a, b) => b - a)[0]; return { h, n: d[h]?.length ?? 0, cards: document.querySelectorAll('[data-testid^="card-"]').length }; });
  if (!before.n) throw new Error('no deal recorded');
  if (before.cards) throw new Error(`cards visible before "See my cards" (${before.cards})`);
  await shot('10a-blind-nil-facedown');
  await see.first().click();
  await page.locator('[data-testid^="card-"]').first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(160); await shot('10b-flip-midway');
  await page.waitForTimeout(1500);
  const after = await page.evaluate((h) => ({ n: window.__bwmDealt[h].length, flips: window.__bwmFlips?.[h] ?? 0, flipSfx: window.__bwmSound.played.flip ?? 0 }), before.h);
  if (after.n !== before.n) throw new Error(`hand re-dealt on reveal: ${before.n} → ${after.n} cards dealt from the deck`);
  if (after.flips !== 1) throw new Error(`expected one flip-in-place, got ${after.flips}`);
  await shot('10c-revealed');
  console.log(`✓ Blind Nil reveal: dealt once (${before.n} cards), face-down until tapped, flipped in place (flip sfx ${after.flipSfx})`);
}
if (!process.env.ONLY || process.env.ONLY === 'deal') await dealOnceTest();

// 2. Refresh keeps you in your game: play a few cards, reload, same hand/score/turn; bots resume; leave clears the save.
async function reloadTest() {
  await page.evaluate(() => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', blindNil: 'never', quality: 'low' })));
  await page.goto(`${base}/?autostart=1&seed=e2e-reload`);
  const sb = page.getByTestId('sound-button'); await sb.waitFor({ timeout: 30000 }); await sb.click(); await page.waitForTimeout(450); await sb.click(); // trusted tap unlocks audio (taps apart: a double-tap mutes all)
  const snap = () => page.evaluate(() => ({
    hand: [...document.querySelectorAll('[data-testid^="card-"]')].map((b) => b.dataset.testid).join(' '),
    legal: [...document.querySelectorAll('[data-testid^="card-"][data-legal="true"]')].map((b) => b.dataset.testid).join(' '),
    score: document.querySelector('.scorebug')?.innerText.replace(/\s+/g, ' ').trim(),
    turn: [...document.querySelectorAll('.plate.turn')].map((p) => p.dataset.testid).join(' '),
    trick: document.querySelector('[data-testid="hand"]')?.dataset.trickCount,
  }));
  let plays = 0;
  for (let i = 0; i < 1500 && plays < 4; i++) {
    const bid = page.locator('.bid-grid button');
    if (await bid.count()) { await bid.nth(2).click(); continue; }
    const see = page.getByRole('button', { name: 'See my cards' });
    if (await see.count()) { await see.click(); continue; }
    if (await legalCards().count()) { const c = legalCards().last(); await tap(c); await tap(c).catch(() => {}); plays++; await page.waitForTimeout(300); continue; }
    await page.waitForTimeout(50);
  }
  await legalCards().first().waitFor({ timeout: 30000 }); // my turn
  // at a real speed every played card makes its sound when it lands on the felt, and full tricks sweep
  const snd = await page.evaluate(() => window.__bwmSound.played);
  // SwiftShader runs at a few fps, so some trick cards are swept before they land
  if (!(snd.play >= 6) || !(snd.sweep >= 3)) throw new Error(`card sounds missing at Fast speed: ${JSON.stringify(snd)}`);
  console.log(`  ♪ Fast speed card cues: ${JSON.stringify(snd)}`); // bots are waiting on me, the state is stable
  await page.waitForTimeout(1200);
  const before = await snap();
  if (!(await page.evaluate(() => localStorage.getItem('bwm.game')))) throw new Error('no save written');
  await page.goto(base); // a plain refresh of the site
  await page.getByText(/RESUMING YOUR GAME/).waitFor({ timeout: 15000 });
  await legalCards().first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const after = await snap();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`resume mismatch:\n${JSON.stringify(before)}\n${JSON.stringify(after)}`);
  await shot('07-resumed');
  console.log(`✓ Refresh resume (my turn): same hand (${before.hand.split(' ').length} cards), score "${before.score}", turn ${before.turn}`);
  // reload mid-bot-turn: play a card, reload immediately, the bots must carry on until it's my turn again
  const handN = before.hand.split(' ').length;
  const c = legalCards().last(); await tap(c); await tap(c).catch(() => {});
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="card-"]').length === n - 1, handN, { timeout: 10000 });
  await page.reload();
  await page.getByText(/RESUMING YOUR GAME/).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="card-"][data-legal="true"]').length > 0 || document.querySelector('.bid-grid') || [...document.querySelectorAll('button')].some((b) => /Next hand/.test(b.textContent)), null, { timeout: 30000 });
  const n2 = await page.locator('[data-testid^="card-"]').count();
  console.log(`✓ Refresh resume (bots' turn): bots continued, back to me with ${n2} cards`);
  // leave → confirm → start screen, save cleared
  await page.getByTestId('menu').click();
  await page.getByText('LEAVE THIS GAME?').waitFor();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByTestId('play-bots').waitFor({ timeout: 10000 });
  if (await page.evaluate(() => localStorage.getItem('bwm.game'))) throw new Error('save not cleared on leave');
  // corrupted save → start screen, no crash
  await page.evaluate(() => localStorage.setItem('bwm.game', '{"v":1,"state":{garbage'));
  await page.reload();
  await page.getByTestId('play-bots').waitFor({ timeout: 10000 });
  if (await page.evaluate(() => localStorage.getItem('bwm.game'))) throw new Error('corrupt save not discarded');
  console.log('✓ Leave confirm clears the save; corrupted save → start screen');
}
if (!process.env.ONLY || process.env.ONLY === 'reload') await reloadTest();

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
  if (await page.evaluate(() => localStorage.getItem('bwm.game'))) throw new Error(`${label}: save not cleared at game over`);
  if (shots) {
    await page.waitForTimeout(800);
    const snd = await page.evaluate(() => { const s = window.__bwmSound; return { state: s.state, loaded: s.loaded, played: s.played }; });
    const need = ['shuffle', 'deal', 'sweep', 'turn', 'bid', 'tap']; // 'play' lands are checked at Fast speed (turbo sweeps tricks before cards land)
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
