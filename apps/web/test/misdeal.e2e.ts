/**
 * Misdeal, browser-level (WebKit 390): a spade-less human hand gets the 'Call misdeal' button;
 * calling it announces the call ("You called it · no spades") and the dealer pass with the whole
 * hand face up as the table's proof while the hands gather across to the incoming dealer
 * (~1.2s beat), then the hand is shuffled and redealt out of that seat on the normal deal
 * flight (still bidding, fresh cards, no bid placed). The save deals from seat 3, so the
 * human's call passes the deal TO the human: the announcement reads "Deal passes to you".
 * Fan ruling (owner, 2026-10-21): "I shouldn't have cards until they are dealt to me as per
 * the usual deal" — through the whole announcement beat the player's fan (the accessible
 * hand group here) still holds the THROWN-IN hand; the redealt hand appears only as the
 * deal flight deals it. This save is a resumed hand, so it also covers the redeal flight
 * replaying on a hand with no intro.
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
    const announce = (await reveal.textContent()) ?? '';
    if (!announce.includes('You called it · no spades')) throw new Error(`announcement did not name the call: ${announce.slice(0, 120)}`);
    if (!announce.includes('Deal passes to you')) throw new Error(`announcement did not name the dealer pass: ${announce.slice(0, 120)}`);
    console.log('✓ the call is announced: who + why (no spades) + who the deal passes to, thrown hand face up as proof');
    // the fan ruling: mid-beat, the player's hand is still the thrown-in hand — the redealt
    // hand must not be in the fan (here: the accessible hand group) before it is dealt
    const during = await page.getByTestId('hand').locator('button').allTextContents();
    if (JSON.stringify(during) !== JSON.stringify(before)) throw new Error(`fan changed during the gather beat: was ${before.join(' ')} — now ${during.join(' ')}`);
    console.log('✓ through the beat the fan still holds the thrown-in hand — no cards before they are dealt');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/misdeal-reveal-390.png` });
    await reveal.waitFor({ state: 'hidden', timeout: 6000 });
    const beatMs = Date.now() - t0;
    if (shownAt > 1200) throw new Error(`reveal took ${shownAt}ms to appear`);
    if (beatMs < 900 || beatMs > 3000) throw new Error(`announce+gather beat was ${beatMs}ms, want ~1200`);
    console.log(`✓ announcement + gather held for a ${beatMs}ms beat (13 cards)`);

    // redealt: the deal flight deals the same hand back out — still bidding, 13 fresh cards
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="hand"] button').length === 13, undefined, { timeout: 8000 });
    const after = await page.getByTestId('hand').locator('button').allTextContents();
    if (after.length !== 13) throw new Error(`redealt hand has ${after.length} cards`);
    console.log('✓ reshuffled and redealt (13 cards, bidding again)');
    await page.close();
    console.log('misdeal OK');
  } finally { await b.close(); }
})();
