/**
 * Dev helper: screenshot the offline table at a given size & moment.
 * Usage: node scripts/dev-shot.mjs <w> <h> <out.png> [phase=bid|play|books] [settingsJSON] [tipsOn=0]
 */
import { chromium } from 'playwright-core';
const [w, h, out, phase = 'bid', extra = '{}', tipsOn = '0'] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:4173';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const p = await (await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
p.on('pageerror', (e) => console.error('pageerror', String(e)));
await p.goto(base);
await p.evaluate(([ex, t]) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: t === '1', asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'normal', blindNil: 'off', quality: 'low', firstHandBidsItself: false, ...JSON.parse(ex) })); }, [extra, tipsOn]);
await p.goto(`${base}/?autostart=1&seed=${process.env.SEED ?? 'dev-shot'}`);
const legal = p.locator('[data-testid^="card-"][data-legal="true"]');
if (phase === 'bid') { await p.locator('.bid-grid button').first().waitFor({ timeout: 60000 }); await p.waitForTimeout(1200); }
else if (phase === 'play' || phase === 'books') {
  for (let i = 0; i < 600; i++) {
    if (await legal.count()) break;
    const bid = p.locator('.bid-grid button'); if (await bid.count()) { await bid.nth(2).click().catch(() => {}); continue; }
    const ok = p.getByTestId('coach-ok'); if (await ok.count()) { await ok.click().catch(() => {}); continue; }
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(1500);
} else { await p.waitForTimeout(+phase); }
if (process.env.EVAL) await p.evaluate(process.env.EVAL);
if (process.env.WAIT) await p.waitForTimeout(+process.env.WAIT);
await p.screenshot({ path: out });
await b.close();
