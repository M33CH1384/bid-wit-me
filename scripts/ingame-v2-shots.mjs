/** In-game v2 screenshots (offline table, phone 390) → screenshots/ingame-v2/. Usage: node scripts/ingame-v2-shots.mjs [base] */
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = 'screenshots/ingame-v2';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
  await p.goto(base);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', blindNil: 'off', quality: 'low', firstHandBidsItself: false, targetScore: 250 })); });
  await p.goto(`${base}/?autostart=1&seed=ingame-v2`);
  const legal = p.locator('[data-testid^="card-"][data-legal="true"]');
  let mine = false, other = false, trick = 0;
  for (let i = 0; i < 1500; i++) {
    if (await p.getByTestId('table-talk').count() || await p.getByRole('button', { name: /^score pad$/i }).count()) break;
    const bid = p.locator('.bid-grid button'); if (await bid.count()) { await bid.nth(2).click().catch(() => {}); continue; }
    const ok = p.getByTestId('coach-ok'); if (await ok.count()) { await ok.click().catch(() => {}); continue; }
    if (await legal.count()) {
      if (!mine && trick >= 2) { await p.waitForTimeout(900); await p.screenshot({ path: `${out}/phone-390-my-turn.png` }); mine = true; }
      const c = legal.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); trick++;
      await p.waitForTimeout(700);
      if (!other && trick >= 3 && !(await legal.count())) { await p.screenshot({ path: `${out}/phone-390-off-turn.png` }); other = true; }
      continue;
    }
    if (i % 200 === 199) await p.screenshot({ path: '/tmp/ig-probe.png' });
    await p.waitForTimeout(120);
  }
  await p.getByTestId('last-trick').click().catch(() => {});
  await p.waitForTimeout(1200);
  await p.getByRole('button', { name: /^score pad$/i }).first().click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/phone-390-score-pad.png` });
  console.log('ok', mine, other);
} finally { await b.close(); }
