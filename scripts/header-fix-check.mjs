/**
 * Header stability check (phone 390): plays several tricks on and off turn in Chromium and WebKit, asserting the score
 * text is always rendered and the speaker button never moves or resizes. Records a video per browser.
 * Usage: node scripts/header-fix-check.mjs [base=http://localhost:4173]
 */
import { chromium, webkit } from 'playwright-core';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = 'screenshots/header-fix'; mkdirSync(out, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let failed = false;
for (const [name, type, opts] of [['chromium', chromium, { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] }], ['webkit', webkit, {}]]) {
  const b = await type.launch(opts);
  const vdir = `${out}/tmp-${name}`;
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: name === 'chromium', hasTouch: true, userAgent: UA, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const p = await ctx.newPage();
  await p.goto(base);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', blindNil: 'off', quality: 'low', firstHandBidsItself: false })); });
  await p.goto(`${base}/?autostart=1&seed=header-fix`);
  const legal = p.locator('[data-testid^="card-"][data-legal="true"]');
  const probe = () => p.evaluate(() => {
    const d = document.querySelector('.sound-dock .dock-btn')?.getBoundingClientRect();
    const bug = document.querySelector('.scorebug .bug')?.getBoundingClientRect();
    const scores = [...document.querySelectorAll('.bug-score')].map((e) => (e.textContent ?? '').trim());
    return { dock: d && [Math.round(d.x), Math.round(d.y), Math.round(d.width), Math.round(d.height)].join(','), bugW: bug ? Math.round(bug.width) : 0, scores };
  });
  const seen = new Set(); let bad = 0, samples = 0, plays = 0, offTurn = 0;
  for (let i = 0; i < 2500 && plays < 6; i++) {
    const bid = p.locator('.bid-grid button'); if (await bid.count()) { await bid.nth(2).click().catch(() => {}); continue; }
    const r = await probe(); samples++;
    if (r.dock) seen.add(r.dock);
    if (r.bugW < 150 || r.scores.length < 2 || r.scores.some((x) => x === '')) bad++;
    if (await legal.count()) { const c = legal.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); plays++; if (plays === 3) await p.screenshot({ path: `${out}/${name}-after-play.png` }); }
    else { offTurn++; if (offTurn === 20) await p.screenshot({ path: `${out}/${name}-off-turn.png` }); }
    await p.waitForTimeout(100);
  }
  await p.screenshot({ path: `${out}/${name}-final.png` });
  console.log(name, { samples, offTurn, plays, bad, dockPositions: [...seen] });
  if (bad || seen.size > 1) failed = true;
  await ctx.close(); await b.close();
  const f = readdirSync(vdir).find((x) => x.endsWith('.webm'));
  if (f) renameSync(`${vdir}/${f}`, `${out}/${name}.webm`);
}
process.exit(failed ? 1 : 0);
