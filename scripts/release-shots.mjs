/**
 * Release screenshots (iPhone sizes): start wizard, a first-hand tip, the sound popover (portrait 390x844)
 * and the offline table in phone landscape (844x390). Needs `pnpm preview` on :4173.
 * Usage: node scripts/release-shots.mjs [outDir=screenshots/release-2] [baseUrl=http://localhost:4173]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'screenshots/release-2';
const base = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const mk = async (w, h) => (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
const legal = (p) => p.locator('[data-testid^="card-"][data-legal="true"]');

// portrait: splash → mode → essentials → sound popover
let p = await mk(390, 844);
await p.goto(base); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); }); await p.goto(base);
await p.getByTestId('play-bots').waitFor(); await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/portrait-1-splash.png` });
await p.getByTestId('play-bots').click(); await p.getByTestId('mode-joker').waitFor(); await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/portrait-2-mode.png` });
await p.getByTestId('mode-joker').click(); await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/portrait-3-essentials.png` });
await p.getByTestId('sound-button').click(); await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/portrait-5-sound-popover.png` });
await p.close();

// portrait: a first-hand tip on the table
p = await mk(390, 844);
await p.goto(base); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: true, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'normal', quality: 'low', tips: true })); });
await p.goto(base); await p.getByTestId('play-bots').click(); await p.getByTestId('mode-joker').click();
const sw = p.getByRole('switch', { name: 'Show me how to play (tips during first hand)' });
if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
await p.getByTestId('start-bots').click();
const coach = p.getByTestId('coach'); await coach.waitFor({ timeout: 30000 }); await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/portrait-4a-tip-${await coach.getAttribute('data-tip')}.png` });
for (let i = 0; i < 300; i++) { // advance to the bidding tip
  if (await coach.count()) { const id = await coach.getAttribute('data-tip'); if (id === 'bid') { await p.waitForTimeout(800); await p.screenshot({ path: `${out}/portrait-4b-tip-bid.png` }); break; } await p.getByTestId('coach-ok').click({ timeout: 2000 }).catch(() => {}); continue; }
  await p.waitForTimeout(100);
}
await p.close();

// phone landscape: offline table mid-trick
p = await mk(844, 390);
await p.goto(base); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'normal', blindNil: 'never', quality: 'low' })); });
await p.goto(`${base}/?autostart=1&seed=release-shots`);
await p.locator('.bid-grid button').first().waitFor({ timeout: 60000 }); await p.waitForTimeout(900);
await p.screenshot({ path: `${out}/landscape-844x390-1-bidding.png` });
await p.locator('.bid-grid button').nth(3).click();
await legal(p).first().waitFor({ timeout: 60000 }); await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/landscape-844x390-2-my-turn.png` });
const c = legal(p).last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {});
await p.waitForTimeout(1400);
await p.screenshot({ path: `${out}/landscape-844x390-3-trick.png` });
await p.close();
await b.close();
console.log('shots in', out);
