/** The Pj's street environment (blockAfterDark) at High/Low quality.
 *  Env: BWM_URL BWM_SHOTS BWM_TAG BWM_VIEW BWM_Q BWM_THEME BWM_W BWM_H BWM_DSF
 *  High asserts the 3D environment dressed (probe env3d) AND the Forge sedan actually
 *  loaded (probe __pjsSedan) — the sandbox gate caught an imperative-loader variant
 *  that flagged loaded but never rendered the car; this shot is the regression net.
 *  Low asserts the fallback: env3d false (photo backdrop + floor, no street room). */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { chromium } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5199';
const SHOTS = process.env.BWM_SHOTS ?? '/tmp/bwm-shots';
const TAG = process.env.BWM_TAG ?? 'after';
const VIEW = (process.env.BWM_VIEW ?? 'sitting') as 'sitting' | 'standing';
const Q = process.env.BWM_Q ?? 'high';
const THEME = process.env.BWM_THEME ?? 'classic';
const W = Number(process.env.BWM_W ?? 390);
const H = Number(process.env.BWM_H ?? 844);
const DSF = Number(process.env.BWM_DSF ?? 2);

function save(): string {
  const dealt = newGame(makeRules('joker'), 'pjs-shot', { dealer: 3 });
  const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: Q, botLevel: 'novice', venue: 'blockAfterDark', view: VIEW }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.BWM_CHROME || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--disable-features=LocalNetworkAccessChecks'] });
  try {
    const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
    page.setDefaultTimeout(30000);
    await page.addInitScript(({ raw, theme }) => {
      localStorage.setItem('bwm.game', raw);
      localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
      if (theme !== 'classic') localStorage.setItem('bwm.theme.v1', JSON.stringify({ theme }));
    }, { raw: save(), theme: THEME });
    await page.goto(URL);
    // force: under Neon the hero button never reads "stable" to Playwright
    // (the ink hero animates constantly) — a capture harness clicks through.
    await page.getByTestId('resume').click({ force: true, timeout: 60000 });
    await page.waitForFunction(() => ((window as unknown as { __bwmHandHits?: unknown[] }).__bwmHandHits ?? []).length >= 10, undefined, { timeout: 90000 });
    const venue = await page.waitForFunction(
      (want) => {
        const v = (window as unknown as { __bwmVenue?: { id?: string; env3d?: boolean } }).__bwmVenue;
        return v && v.id === 'blockAfterDark' && v.env3d === want ? v : null;
      },
      Q === 'high',
      { timeout: 90000 },
    ).then((h) => h.jsonValue()).catch(() => null);
    if (!venue) throw new Error(`venue did not dress as expected (quality=${Q}): ${JSON.stringify(await page.evaluate(() => (window as unknown as { __bwmVenue?: unknown }).__bwmVenue))}`);
    console.log('venue probe:', JSON.stringify(venue));
    if (Q === 'high') {
      const sedan = await page.waitForFunction(
        () => (window as unknown as { __pjsSedan?: { loaded?: boolean } }).__pjsSedan?.loaded === true,
        undefined,
        { timeout: 90000 },
      ).then(() => true).catch(() => false);
      console.log('sedan probe:', sedan ? 'loaded' : 'NOT LOADED');
      if (!sedan) throw new Error('sedan did not load (or did not flag loaded)');
    }
    await page.waitForTimeout(4000);
    const out = `${SHOTS}/pjs-${TAG}-${W}x${H}-${VIEW}-${Q}-${THEME}.png`;
    // CDP capture: page.screenshot's font-stability wait stalls under SwiftShader.
    const { writeFileSync } = await import('node:fs');
    const cdp = await page.context().newCDPSession(page);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('pjs-shot OK', out);
  } finally {
    await b.close();
  }
})();
