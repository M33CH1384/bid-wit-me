/**
 * Beta label, version line, tip jar and the "Send feedback" sheet:
 *  - BETA tag on the splash and in the scorebug; version line in More options
 *  - the feedback sheet fits on screen (390x664, 1024x640, 1440x900) and scrolls inside
 *  - in game: menu → Send feedback → "Snap this screen" adds a screenshot → send → thank-you; the server stored it
 *  - offline → a clear error
 * Usage: node scripts/feedback-check.mjs [web=http://localhost:4173] [server=http://127.0.0.1:8787] [token=local-dev-token]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://127.0.0.1:8787';
const token = process.argv[4] ?? 'local-dev-token';
const out = process.env.SHOTS_OUT ?? 'screenshots/release-3';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const problems = [];
const fail = (m) => { problems.push(m); console.log('✗ ' + m); };
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => fail(`page error: ${e}`));
await page.goto(`${web}/?server=${encodeURIComponent(server)}`);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });
await page.reload();
if (!(await page.title()).includes('Beta')) fail('page title has no "Beta"');
if (!(await page.getByTestId('beta-tag').isVisible())) fail('no BETA tag on the splash');
await page.getByRole('button', { name: 'Play vs Bots' }).first().click().catch(() => {});
await page.locator('.icon-btn.gear').first().click();
await page.getByTestId('more-options').waitFor();
const ver = await page.getByTestId('version').innerText();
if (!/^v0\.3\.0 beta · [0-9a-f]{6,} · \d{4}-\d\d-\d\d$/.test(ver)) fail(`version line "${ver}"`);
if (!(await page.getByTestId('tip-btn').count()) || !(await page.getByTestId('tip-btn').innerText()).includes('Tip the devs (Cash App)')) fail('tip button missing in More options');
await page.getByTestId('open-feedback').click();
await page.getByTestId('feedback').waitFor();
await page.locator('.fb-ctx-toggle').click();
for (const [w, h] of [[390, 664], [1024, 640], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="feedback"]').getBoundingClientRect();
    const body = document.querySelector('[data-testid="feedback"] .sheet-body');
    body.scrollTop = body.scrollHeight;
    const send = document.querySelector('[data-testid="fb-send"]').getBoundingClientRect();
    return { top: s.top, bottom: s.bottom, left: s.left, right: s.right, H: innerHeight, W: innerWidth, sendBottom: send.bottom, scrolls: body.scrollHeight > body.clientHeight };
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/11-feedback-sheet-${w}x${h}.png` });
  const bad = [];
  if (m.top < 0 || m.bottom > m.H + 0.5 || m.left < 0 || m.right > m.W + 0.5) bad.push(`sheet off-screen (${m.top.toFixed(0)}..${m.bottom.toFixed(0)} of ${m.H})`);
  if (m.sendBottom > m.H + 0.5) bad.push('Send button unreachable');
  console.log(`${bad.length ? '✗' : '✓'} feedback sheet ${w}x${h}${m.scrolls ? ' (scrolls inside)' : ''}${bad.length ? ': ' + bad.join('; ') : ''}`);
  bad.forEach((x) => problems.push(`feedback sheet ${w}x${h}: ${x}`));
}
await page.setViewportSize({ width: 1440, height: 900 });
// in game: menu → Send feedback → snap → send
await page.goto(`${web}/?server=${encodeURIComponent(server)}`);
await page.evaluate(() => { localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low' })); });
await page.goto(`${web}/?autostart=1&seed=feedback-1&server=${encodeURIComponent(server)}`);
await page.locator('.scorebug').waitFor();
await page.waitForTimeout(3500);
if (!(await page.locator('.beta-tag.in-bug').isVisible())) fail('no BETA tag in the scorebug');
await page.getByTestId('menu').click();
await page.getByTestId('open-feedback').click();
await page.getByTestId('feedback').waitFor();
await page.getByTestId('fb-snap').click();
await page.locator('.fb-thumb img').first().waitFor({ timeout: 20000 });
const snapInfo = await page.evaluate(async () => {
  const img = document.querySelector('.fb-thumb img');
  return { w: img.naturalWidth, h: img.naturalHeight, kb: Math.round(img.src.length * 0.75 / 1024), type: img.src.slice(5, 15) };
});
if (snapInfo.w < 600) fail(`snap too small ${JSON.stringify(snapInfo)}`); else console.log(`✓ Snap this screen: ${snapInfo.w}x${snapInfo.h} ${snapInfo.type} ${snapInfo.kb} KB`);
const msg = `feedback-check ${Date.now()}`;
await page.getByTestId('fb-message').fill(msg);
await page.locator('.fb-ctx-toggle').click();
await page.screenshot({ path: `${out}/12-feedback-ingame-snap-1440x900.png` });
// offline → clear error
await ctx.setOffline(true);
await page.getByTestId('fb-send').click();
const err = await page.getByTestId('fb-error').innerText().catch(() => '');
if (!/offline/i.test(err)) fail(`offline error missing ("${err}")`); else console.log('✓ offline → clear error');
await ctx.setOffline(false);
await page.getByTestId('fb-send').click();
await page.getByTestId('feedback-done').waitFor({ timeout: 15000 }).catch(() => fail('no thank-you after sending'));
await page.screenshot({ path: `${out}/13-feedback-thanks-1440x900.png` });
const list = await (await fetch(`${server}/api/feedback/list?token=${token}`)).json();
const row = list.find((r) => r.message === msg);
if (!row) fail('server did not store the message');
else {
  const c = JSON.parse(row.context);
  if (!row.shots.length) fail('screenshot not stored');
  if (!c.game?.mode || !c.version) fail(`context incomplete ${row.context.slice(0, 200)}`);
  const shot = await fetch(`${server}/api/feedback/shot/${row.shots[0]}?token=${token}`);
  console.log(`✓ stored #${row.id}: ${row.shots.length} shot (${shot.headers.get('content-type')}, ${(await shot.arrayBuffer()).byteLength} B), context ${c.version} · ${c.game.mode} hand ${c.game.hand}`);
}
// a separate snap image for the report
await page.goto(`${server}/api/feedback/admin?token=${token}`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/14-feedback-admin-1440x900.png` });
await b.close();
console.log(problems.length ? `${problems.length} problem(s)` : 'FEEDBACK OK');
process.exit(problems.length ? 1 : 0);
