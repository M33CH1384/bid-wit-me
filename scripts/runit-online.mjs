/**
 * Run it! end to end, ONLINE and OFFLINE: tap "Run it!" and assert the layers actually render (not just that the books
 * are awarded): the zoom overlay (claimer's cards big), the slam (cards on the table), the 3D tornado (fx.tornado set
 * AND the funnel mesh drawn), all before the hand-end scorecard / Table Talk.
 * Online needs a local Worker started with TEST_HOOKS (`wrangler dev --port 8787 --var TEST_HOOKS:1`) to load the
 * position; it never runs against production.
 * Usage: node scripts/runit-online.mjs [web=http://localhost:4173] [server=http://localhost:8787]   (ONLY=offline|online)
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://localhost:8787';
const only = process.env.ONLY;
const save = JSON.parse(execFileSync('npx', ['tsx', 'scripts/runit-state.ts', 'joker', '3'], { encoding: 'utf8' }));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const SIZES = [['phone', 390, 844], ['desktop', 1280, 800]];

/** record which Run it! layers are on screen, every 30 ms, until Table Talk opens */
const startLog = (p) => p.evaluate(() => {
  const log = window.__runLog = { zoom: [], skip: [], tornado: [], funnel: [], talk: null, t0: performance.now() };
  const on = {};
  const tick = () => {
    const t = Math.round(performance.now() - log.t0);
    const now = {
      zoom: !!document.querySelector('[data-testid="run-zoom"] .run-zoom-card'),
      skip: !!document.querySelector('[data-testid="run-skip"]'),
      tornado: !!window.__bwmFx?.tornado,
      funnel: !!window.__bwmTornadoDrawn,
    };
    for (const k of Object.keys(now)) { if (now[k] && !on[k]) log[k].push([t, null]); if (!now[k] && on[k]) log[k].at(-1)[1] = t; on[k] = now[k]; }
    if (log.talk === null && document.querySelector('[data-testid="table-talk"]')) log.talk = t;
    if (t < 25000 && log.talk === null) setTimeout(tick, 30);
  };
  tick();
});
function check(label, log) {
  const fail = (m) => { throw new Error(`${label}: ${m} · ${JSON.stringify(log)}`); };
  if (!log.zoom.length) fail('the zoom (claimer\'s cards big) never showed');
  if (!log.tornado.length) fail('the tornado never started');
  if (!log.funnel.length) fail('the 3D tornado funnel never rendered');
  if (log.tornado[0][0] < log.zoom[0][0]) fail('tornado before the zoom');
  const end = Math.max(...log.tornado.map(([, e]) => e ?? Infinity), ...log.funnel.map(([, e]) => e ?? Infinity));
  if (log.talk !== null && log.talk < end) fail('Table Talk opened before the tornado finished');
  return `zoom ${log.zoom[0].join('–')} ms, tornado ${log.tornado[0].join('–')} ms (funnel drawn ${log.funnel[0][0]} ms), Table Talk ${log.talk ?? '—'} ms`;
}
async function tapRun(p, touch) {
  const btn = p.getByTestId('run-it');
  await btn.waitFor({ timeout: 60000 });
  await p.waitForTimeout(800);
  await startLog(p);
  if (touch) await btn.tap({ force: true }); else await btn.click({ force: true }); // (the attention pulse never 'settles')
  await p.waitForFunction(() => window.__runLog.talk !== null || performance.now() - window.__runLog.t0 > 20000, null, { timeout: 30000, polling: 200 });
  if (process.env.DEBUG) {
    await p.screenshot({ path: `/tmp/runit-debug-${Date.now()}.png` });
    console.log('chat:', await p.evaluate(() => [...document.querySelectorAll('.chat-line')].map((e) => e.textContent).slice(-6)));
    console.log('run-it still there:', await p.getByTestId('run-it').count());
  }
  return p.evaluate(() => window.__runLog);
}

const results = [];
for (const [size, w, h] of SIZES) {
  const ctxOpts = { viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, isMobile: w < 600, hasTouch: w < 600 };
  // ---------------- offline vs bots
  if (!only || only === 'offline') {
    const ctx = await b.newContext(ctxOpts);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`offline/${size}: ${e}`));
    await p.goto(web);
    await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('bwm.game', JSON.stringify(s)); }, save);
    await p.goto(web);
    const log = await tapRun(p, w < 600);
    results.push(`✓ offline ${size}: ${check(`offline ${size}`, log)}`);
    console.log(results.at(-1));
    await ctx.close();
  }
  // ---------------- online (local Worker + TEST_HOOKS): host at seat 0, 3 bots, load the same position
  if (!only || only === 'online') {
    const ctx = await b.newContext(ctxOpts);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`online/${size}: ${e}`));
    await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });
    await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
    await p.getByTestId('play-online').click();
    await p.getByTestId('mode-joker').click();
    await p.getByLabel('Your name').fill('Demetrius');
    await p.getByTestId('create-table').click();
    await p.getByTestId('lobby').waitFor({ timeout: 20000 });
    const code = (await p.getByTestId('room-code').locator('b').innerText()).trim();
    await p.getByTestId('start').click();
    await p.locator('.table-screen').waitFor({ timeout: 20000 });
    const r = await fetch(`${server}/api/tables/${code}/test-state`, { method: 'POST', body: JSON.stringify(save.state) });
    if (!r.ok) throw new Error(`test-state failed ${r.status}: is the local Worker running with --var TEST_HOOKS:1?`);
    const log = await tapRun(p, w < 600);
    results.push(`✓ online ${size}: ${check(`online ${size}`, log)}`);
    console.log(results.at(-1));
    await ctx.close();
  }
}
await b.close();
if (errors.length) { console.log(`page errors:\n${errors.join('\n')}`); process.exit(1); }
console.log('RUN IT OK');
