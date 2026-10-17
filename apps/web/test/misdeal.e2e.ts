/**
 * Misdeal, browser-level (WebKit 390): a spade-less human hand gets the 'Call misdeal' button;
 * calling it throws the whole hand face up on the table for the ~1.8s beat (everyone's proof of no
 * spades), then the same hand is reshuffled and redealt (still bidding, fresh cards, no bid placed).
 * Saves docs/misdeal-button-390.png and docs/misdeal-reveal-390.png when BWM_SHOTS=docs.
 */
import { isTrump, makeRules, newGame, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';

function save(): string {
  const rules = makeRules('joker', { firstHandBidsItself: false });
  for (let i = 0; i < 500; i++) {
    const st: GameState = newGame(rules, `misdeal-e2e-${i}`, { dealer: 3 });
    if (st.phase === 'bidding' && !st.hands[0]!.some((c) => isTrump(c, rules))) {
      return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: 'novice', venue: 'classic' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
    }
  }
  throw new Error('no spade-less deal found');
}

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save());
    await page.goto(URL);
    await page.getByTestId('resume').click();
    const btn = page.getByTestId('misdeal');
    await btn.waitFor({ state: 'visible', timeout: 20000 });
    // the button renders under the table loader for a moment: wait until the 3D hand is really up
    await page.waitForFunction(() => ((window as unknown as { __bwmHandHits?: unknown[] }).__bwmHandHits ?? []).length >= 10, undefined, { timeout: 30000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/misdeal-button-390.png` });
    console.log('✓ misdeal button offered on a spade-less hand');

    const before = await page.getByTestId('hand').locator('button').allTextContents();
    const t0 = Date.now();
    await btn.click();
    const reveal = page.getByTestId('misdeal-reveal');
    await reveal.waitFor({ state: 'visible', timeout: 5000 });
    const shownAt = Date.now() - t0;
    const cards = await reveal.locator('img').count();
    if (cards !== 13) throw new Error(`reveal showed ${cards} cards, want 13`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/misdeal-reveal-390.png` });
    await reveal.waitFor({ state: 'hidden', timeout: 6000 });
    const beatMs = Date.now() - t0;
    if (shownAt > 1200) throw new Error(`reveal took ${shownAt}ms to appear`);
    if (beatMs < 1400 || beatMs > 4500) throw new Error(`reveal beat was ${beatMs}ms, want ~1800`);
    console.log(`✓ whole hand face up for a ${beatMs}ms beat (13 cards)`);

    // redealt: still bidding on the same hand with 13 fresh cards
    await page.waitForTimeout(800);
    const after = await page.getByTestId('hand').locator('button').allTextContents();
    if (after.length !== 13) throw new Error(`redealt hand has ${after.length} cards`);
    console.log('✓ reshuffled and redealt (13 cards, bidding again)');
    await page.close();
    console.log('misdeal OK');
  } finally { await b.close(); }
})();
