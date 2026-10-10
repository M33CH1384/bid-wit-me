/**
 * Browser smoke test: drives the built app (vite preview) with headless Chrome, plays one full game per mode
 * through the UI as the human seat, and saves screenshots to ./screenshots.
 * The table is a WebGL (three.js) scene, so Chrome runs with SwiftShader; cards are driven through the
 * accessible hidden hand buttons (data-testid="card-XX", data-legal) that mirror the 3D hand.
 * Usage: node scripts/e2e.mjs [baseUrl=http://localhost:4173] [chromePath=/usr/bin/google-chrome]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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
if (!(await page.getByRole('switch', { name: 'Show me how to play (tips as you play)' }).count())) throw new Error('tips toggle missing on the essentials step');
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
  await page.evaluate(() => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low', firstHandBidsItself: false })));
  await page.getByTestId('play-bots').click();
  await page.getByTestId('mode-joker').click();
  const sw = page.getByRole('switch', { name: 'Show me how to play (tips as you play)' });
  if ((await sw.getAttribute('aria-checked')) !== 'true') throw new Error('tips toggle should be on after "Yes"');
  await page.getByTestId('start-bots').click();
  const coach = page.getByTestId('coach');
  await coach.waitFor({ timeout: 20000 });
  const seen = [];
  let termChecked = null; const markChecked = [];
  await page.waitForTimeout(400);
  await shot('08-tip-first');
  if (!(await page.getByTestId('learning-badge').count())) throw new Error('learning mode badge missing with tips on');
  // hand 1 is "books bid themselves" (no bidding), so the bid tip comes in hand 2 — tips carry across hands
  let actionChecked = '';
  for (let i = 0; i < 2500 && !(seen.includes('bid') && seen.length >= 4 && actionChecked); i++) {
    const talk = page.locator('[data-testid="talk-ready"]:not([disabled])');
    if (await talk.count()) { await talk.click().catch(() => {}); continue; }
    if (await coach.count()) {
      const id = await coach.getAttribute('data-tip');
      if (id && !seen.includes(id)) {
        seen.push(id); if (id === 'bid') await shot('08b-tip-bid');
        // plain-language tips: tappable terms open a quick definition (without dismissing the tip)
        const term = coach.locator('button.term').first();
        if (!termChecked && (await term.count())) {
          await term.click();
          await page.getByTestId('term-def').waitFor({ timeout: 3000 });
          if ((await coach.getAttribute('data-tip')) !== id) throw new Error('tapping a term dismissed the tip');
          termChecked = (await term.getAttribute('data-term')) ?? 'yes';
        }
        // tips that talk about cards mark them (LED ring on the table, tags in the hand)
        if (['follow', 'cut'].includes(id)) {
          await page.locator('[data-testid="tip-marks"] [data-mark$=":led"]').waitFor({ timeout: 3000 }).catch(() => { throw new Error(`${id} tip: led card not marked`); });
          markChecked.push(id);
        }
        // a tip tied to an action closes the moment you take it: play a card with the play tip open → gone ≤ ~300 ms
        if (['follow', 'cut', 'broken'].includes(id) && !actionChecked) {
          const l = legalCards();
          if (await l.count()) {
            const c = l.first(); await tap(c); if (await coach.count()) await tap(c).catch(() => {});
            const t0 = Date.now();
            await page.waitForFunction((tid) => !document.querySelector(`[data-testid="coach"][data-tip="${tid}"]`), id, { timeout: 300, polling: 20 })
              .catch(() => { throw new Error(`${id} tip still open ${Date.now() - t0} ms after playing a card`); });
            actionChecked = `${id} (${Date.now() - t0} ms)`;
            continue;
          }
        }
      }
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
  if (!actionChecked) throw new Error('never got a play tip open to check it closes on play');
  // wait for a play-phase tip, then skip the rest
  for (let i = 0; i < 400 && !(await coach.count()); i++) {
    const l = legalCards();
    if (await l.count()) { const c = l.last(); await tap(c); await tap(c).catch(() => {}); }
    await page.waitForTimeout(60);
  }
  if (await coach.count()) { seen.push(await coach.getAttribute('data-tip')); await shot('08c-tip-play'); await page.getByTestId('coach-skip').click(); }
  await page.waitForTimeout(2500);
  if (await coach.count()) throw new Error('coach still visible after "Skip tips"');
  if (!termChecked) throw new Error('no tappable glossary term in any tip');
  // "?" help opens with Card basics
  await page.getByTestId('help').click();
  await page.getByTestId('card-basics').waitFor({ timeout: 5000 });
  const nTerms = await page.locator('[data-testid="card-basics"] dt').count();
  if (nTerms < 10) throw new Error(`Card basics has only ${nTerms} terms`);
  await page.getByTestId('help').click();
  await page.waitForTimeout(400);
  console.log(`✓ Tips: prompt → on; coach marks ${seen.join(', ')} shown + dismissed (term "${termChecked}" defined, cards marked for ${markChecked.join('/') || '—'}; Card basics ${nTerms} terms; play tip closed on play: ${actionChecked}); "Skip tips" hides them`);
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
  await page.evaluate(() => { localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'normal', blindNil: 'always', quality: 'low', firstHandBidsItself: false })); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.removeItem('bwm.game'); });
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
    names: [1, 2, 3].map((k) => document.querySelector(`[data-testid="seat-${k}"] .plate-name`)?.firstChild?.textContent ?? '').join(','),
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
  const savedNames = await page.evaluate(() => JSON.parse(localStorage.getItem('bwm.game') ?? '{}').names?.slice(1).join(','));
  if (!before.names || savedNames !== before.names) throw new Error(`bot names not kept in the save: plates "${before.names}", save "${savedNames}"`);
  console.log(`✓ Random bot names kept across refresh: ${before.names}`);
  console.log(`✓ Refresh resume (my turn): same hand (${before.hand.split(' ').length} cards), score "${before.score}", turn ${before.turn}`);
  // reload mid-bot-turn: play a card, reload immediately, the bots must carry on until it's my turn again
  const handN = before.hand.split(' ').length;
  const c = legalCards().last(); await tap(c); await tap(c).catch(() => {});
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="card-"]').length === n - 1, handN, { timeout: 10000 });
  await page.reload();
  await page.getByText(/RESUMING YOUR GAME/).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="card-"][data-legal="true"]').length > 0 || document.querySelector('.bid-grid') || document.querySelector('[data-testid="talk-ready"]'), null, { timeout: 30000 });
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

// 2b. 'Run it!': a guaranteed lead (built by scripts/runit-state.ts) → button + one-time spotlight tip (tips are off) →
//     tap → slam + tornado → every hand empty, all remaining books ours, chat line, Storm Chaser badge, tip retired.
async function runItTest() {
  const save = execFileSync('npx', ['tsx', 'scripts/runit-state.ts', 'joker', '3'], { encoding: 'utf8' });
  const st = JSON.parse(save).state;
  const took = st.tricksWon[0] + st.tricksWon[2];
  await page.evaluate((save) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', save); }, save);
  await page.goto(base);
  await page.getByTestId('run-it').waitFor({ timeout: 60000 });
  await page.getByTestId('run-it-tip').waitFor({ timeout: 5000 });
  if (!(await page.locator('.run-it-btn.attention').count())) throw new Error('Run it! button should pulse while the tip is up');
  await shot('11a-run-it-tip');
  await tap(page.getByTestId('run-it')); // (the attention pulse never 'settles' for Playwright's stability check)
  await page.getByTestId('run-skip').waitFor({ timeout: 5000 });
  await page.getByTestId('pop-ranIt').waitFor({ timeout: 5000 });
  await page.waitForTimeout(900);
  await shot('11b-run-it-tornado');
  await page.getByTestId('run-skip').waitFor({ state: 'detached', timeout: 15000 });
  const r = await page.evaluate(() => ({
    hand: document.querySelectorAll('[data-testid="hand"] button').length,
    chat: [...document.querySelectorAll('.chat-line')].some((e) => /You ran the board \(\+3 books\)/.test(e.textContent ?? '')),
    badges: JSON.parse(localStorage.getItem('bwm.badges.v1') ?? 'null')?.badges?.map((b) => b.id) ?? [],
    tip: JSON.parse(localStorage.getItem('bwm.runItTip.v1') ?? 'null'),
    took: JSON.parse(localStorage.getItem('bwm.game') ?? 'null')?.state?.history?.at(-1)?.sides?.[0]?.tricks,
  }));
  if (r.hand !== 0) throw new Error(`hand should be empty after Run it!, got ${r.hand}`);
  if (!r.chat) throw new Error('missing "ran the board" chat line');
  if (!r.badges.includes('storm-chaser')) throw new Error('Storm Chaser badge not awarded');
  if (!r.tip?.used) throw new Error('Run it! tip should be retired after first use');
  if (r.took !== undefined && r.took !== took + 3) throw new Error(`expected ${took + 3} books for our side, got ${r.took}`);
  await page.getByTestId('badge-unlock').waitFor({ timeout: 5000 }).catch(() => { throw new Error('no badge unlock toast'); });
  await shot('11c-run-it-badge');
  await page.evaluate(() => localStorage.removeItem('bwm.game'));
  console.log(`✓ Run it!: tip + pulse, tornado + RAN IT!, hands empty, +3 books (${took} → ${r.took ?? '?'}), chat line, Storm Chaser badge`);
}
if (!process.env.ONLY || process.env.ONLY === 'runit') await runItTest();

async function playGame(mode, label, { shots = false, speed = 'turbo', extra = {} } = {}) {
  await page.evaluate(([m, sp, ex]) => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: m, speed: sp, blindNil: 'always', quality: 'low', ...ex })), [mode, speed, extra]);
  await page.goto(`${base}/?autostart=1&seed=e2e-${mode}-${extra.cutthroatDeck ?? ''}`);
  let hands = 0, plays = 0, tookBidShot = false, tookTrickShot = false, tookSummary = false;
  if (shots) { // a real (trusted) tap unlocks Web Audio, as on iOS; toggle the sound popover open/closed
    const sb = page.getByTestId('sound-button');
    await sb.waitFor({ timeout: 30000 }); await sb.click(); await page.getByRole('dialog', { name: 'Sound' }).waitFor();
    await page.getByTestId('music-switch').click(); // music on (lazy-loads the playlist)
    await page.getByTestId('now-playing').waitFor({ timeout: 10000 });
    await page.waitForTimeout(450); // two dock taps within 320 ms are the double-tap 'mute all' gesture
    await sb.click();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 420_000) {
    if (await page.locator('.gameover').count()) break;
    const next = page.locator('[data-testid="talk-ready"]:not([disabled])');
    if (await next.count()) {
      if (!tookSummary) {
        if (shots) await shot('04-table-talk');
        for (const id of ['talk-recap', 'talk-grid', 'react-gg', 'react-run it back', 'react-too easy', 'react-🔥', 'react-😭']) if (!(await page.getByTestId(id).count())) throw new Error(`${label}: Table Talk is missing ${id}`);
        tookSummary = true;
      }
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
    const snd = await page.evaluate(() => { const s = window.__bwmSound; return { state: s.state, loaded: s.loaded, played: s.played, settings: s.settings }; });
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
  if (shots) {
    // game over → Main menu goes straight to the splash (no confirm), the finished game is gone
    await page.getByTestId('main-menu').click();
    await page.getByTestId('play-bots').waitFor({ timeout: 10000 });
    // back never re-enters the finished game: stays in the menu flow
    await page.goBack().catch(() => {});
    await page.waitForTimeout(1200);
    if (await page.locator('.table-screen').count()) throw new Error('browser back re-entered the finished game');
    if (!(await page.getByTestId('wizard').count())) throw new Error('browser back left the menu flow');
    // wizard: Home jumps to the splash; the back arrow steps essentials → mode → splash
    await page.goto(base);
    await page.getByTestId('play-bots').click();
    await page.getByTestId('mode-joker').click();
    await page.getByTestId('wiz-home').click();
    await page.getByTestId('play-bots').waitFor({ timeout: 5000 });
    await page.getByTestId('play-online').click();
    await page.getByTestId('mode-joker').click();
    await page.getByTestId('wiz-back').click();
    await page.getByTestId('mode-joker').waitFor({ timeout: 5000 });
    await page.getByTestId('wiz-back').click();
    await page.getByTestId('play-bots').waitFor({ timeout: 5000 });
    console.log('  ✓ game over → Main menu → splash; back stays in the menu; wizard Home + back arrow');
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
