/** Phase 8: sound settings expose spatial toggle, quality, room picker (persisted). */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save);
    await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
    await page.getByTestId('resume').click();
    await page.getByTestId('sound-button').waitFor({ timeout: 45000 });
    await page.getByTestId('sound-button').click();
    await page.getByTestId('spatial-switch').waitFor({ timeout: 20000 });
    await page.getByTestId('spatial-switch').click();
    await page.getByTestId('soundscape-select').selectOption('barbershop');
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bwm.sound.v1') ?? '{}'));
    console.log('stored:', { spatial: stored.spatial, soundscape: stored.soundscape });
    if (stored.spatial !== false) throw new Error('spatial toggle not persisted');
    if (stored.soundscape !== 'barbershop') throw new Error('soundscape not persisted');
    await page.screenshot({ path: `${process.env.BWM_SHOTS ?? '/opt/cursor/artifacts'}/sound-spatial-settings-390.png` });
    console.log('spatial8 OK');
  } finally { await b.close(); }
})();
