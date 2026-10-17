/** Phase 5: per-player voice mute buttons on opponent plates persist locally. */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { HandHitCard } from '../src/three/handHit';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
type W = { __bwmHandHits: HandHitCard[] };
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
    await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
    await page.getByTestId('resume').click();
    await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
    await page.getByTestId('menu').click();
    for (const seat of [1, 2, 3]) await page.getByTestId(`voice-mute-${seat}`).waitFor({ timeout: 15000 });
    await page.getByTestId('voice-mute-1').click();
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bwm.sound.v1') ?? '{}'));
    console.log('mutedVoices:', stored.mutedVoices);
    if (!stored.mutedVoices || Object.keys(stored.mutedVoices).length !== 1) throw new Error('mute not persisted');
    const pressed = await page.getByTestId('voice-mute-1').getAttribute('aria-pressed');
    if (pressed !== 'true') throw new Error(`aria-pressed ${pressed}`);
    await page.screenshot({ path: `${process.env.BWM_SHOTS ?? '/opt/cursor/artifacts'}/voice-mute-390.png` });
    console.log('spatial5 OK');
  } finally { await b.close(); }
})();
