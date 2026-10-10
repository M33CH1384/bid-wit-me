/**
 * Phone screenshots of the new-player tips: "Your hand" (with a term definition open) and "Can't follow? Cut!" with
 * its highlights (LED ring on the table, TRUMP / THROW tags in the hand), plus Card basics from the "?" help.
 * Usage: node scripts/tip-shots.mjs [outDir=screenshots/release-3] [web=http://localhost:4173]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'screenshots/release-3';
const base = process.argv[3] ?? 'http://localhost:4173';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const legal = (p) => p.locator('[data-testid^="card-"][data-legal="true"]');
const got = { hand: false, cut: false, basics: false };
for (let attempt = 0; attempt < 6 && !(got.hand && got.cut && got.basics); attempt++) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
  await p.goto(base);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: true, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', blindNil: 'never', quality: 'low', firstHandBidsItself: true, tips: true })); });
  await p.goto(`${base}/?autostart=1&seed=tipshots-${attempt}`);
  const coach = p.getByTestId('coach');
  for (let i = 0; i < 3000 && !(got.hand && got.cut); i++) {
    const talk = p.locator('[data-testid="talk-ready"]:not([disabled])');
    if (await talk.count()) { await talk.click().catch(() => {}); continue; }
    if (await coach.count()) {
      const id = await coach.getAttribute('data-tip');
      if (id === 'hand' && !got.hand) {
        await p.waitForTimeout(900);
        await p.screenshot({ path: `${out}/7-tip-your-hand-390x844.png` });
        await coach.locator('button.term').first().click().catch(() => {});
        await p.waitForTimeout(500);
        await p.screenshot({ path: `${out}/7b-tip-your-hand-term-open-390x844.png` });
        got.hand = true;
      }
      if (id === 'cut' && !got.cut) {
        await p.waitForTimeout(1200);
        await p.screenshot({ path: `${out}/8-tip-cut-highlights-390x844.png` });
        got.cut = true;
      }
      if (!got.basics && got.hand) {
        await p.getByTestId('coach-ok').click({ timeout: 2000 }).catch(() => {});
        await p.getByTestId('help').click(); await p.getByTestId('card-basics').waitFor({ timeout: 4000 }).catch(() => {});
        await p.waitForTimeout(600);
        await p.screenshot({ path: `${out}/9-help-card-basics-390x844.png` });
        await p.getByTestId('help').click(); got.basics = true; continue;
      }
      await p.getByTestId('coach-ok').click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    const bid = p.locator('.bid-grid button');
    if (await bid.count()) { await bid.nth(2).click().catch(() => {}); continue; }
    const l = legal(p);
    if (await l.count()) { const c = l.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); continue; }
    await p.waitForTimeout(60);
  }
  await p.context().close();
}
await b.close();
console.log('tip shots', JSON.stringify(got));
