/**
 * Release 3 screenshots → screenshots/release-3/: bid coach, streak pop-up, nuke mid-explosion, Table Talk,
 * host music controls (online lobby, sound popover).
 * Usage: node scripts/release3-shots.mjs [web=http://localhost:4173] [server=http://127.0.0.1:8787]
 */
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://127.0.0.1:8787';
const out = 'screenshots/release-3';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const errors = [];
async function page(w, h, mobile = true) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? IOS : undefined, permissions: ['camera', 'microphone'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  return p;
}
const legal = (p) => p.locator('[data-testid^="card-"][data-legal="true"]');
async function toBid(p, tips) {
  await p.goto(web);
  await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: t, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'high', firstHandBidsItself: false })); }, tips);
  await p.goto(`${web}/?autostart=1&seed=release3-coach`);
  await p.locator('.bid-grid button').first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(1500);
}
async function toPlay(p) {
  for (let i = 0; i < 800; i++) {
    if ((await legal(p).count()) && (await p.locator('[data-testid="last-trick"]').count())) break;
    const bid = p.locator('.bid-grid button'); if (await bid.count()) { await bid.nth(2).click().catch(() => {}); continue; }
    const ok = p.getByTestId('coach-ok'); if (await ok.count()) { await ok.click().catch(() => {}); continue; }
    const l = legal(p); if (await l.count()) { await l.last().dispatchEvent('click'); await l.last().dispatchEvent('click').catch(() => {}); }
    await p.waitForTimeout(60);
  }
  await p.waitForTimeout(1200);
}

// 1. bid coach (portrait phone, tips on) + expanded "Why?" (desktop)
{
  const p = await page(390, 844);
  await toBid(p, true);
  await p.getByTestId('bid-coach').waitFor({ timeout: 10000 });
  await p.screenshot({ path: `${out}/01-bid-coach-phone.png` });
  const d = await page(1280, 800, false);
  await toBid(d, true);
  await d.getByTestId('bid-coach').getByRole('button', { name: /Why/ }).click().catch(() => {});
  await d.waitForTimeout(500);
  await d.screenshot({ path: `${out}/02-bid-coach-why-desktop.png` });
  // 2. streak pop-up + 3. nuke mid-explosion, on a live table
  await toPlay(d);
  await d.evaluate(() => window.__bwmFx.emit('streak', { level: 3, text: 'ON FIRE', sub: 'You & Keisha · 3 in a row' }));
  await d.waitForTimeout(450);
  await d.screenshot({ path: `${out}/03-streak-on-fire.png` });
  await d.waitForTimeout(2600);
  await d.evaluate(() => window.__bwmFx.emit('nuke'));
  await d.waitForTimeout(650);
  await d.screenshot({ path: `${out}/04-nuke-mid-explosion.png` });
  await d.waitForTimeout(500);
  await d.screenshot({ path: `${out}/04b-nuke-cloud.png` });
  await d.waitForTimeout(3500);
  await d.evaluate(() => window.__bwmFx.emit('shot', { text: 'Marcus & Dre SET (−60)' }));
  await d.waitForTimeout(400);
  await d.screenshot({ path: `${out}/05-shot.png` });
  await d.context().close(); await p.context().close();
}

// 4. Table Talk (offline recap) from a saved hand-over, phone + desktop
if (existsSync('/tmp/save.json')) {
  const save = readFileSync('/tmp/save.json', 'utf8');
  for (const [w, h, m, name] of [[390, 844, true, '06-table-talk-phone'], [1280, 800, false, '07-table-talk-desktop']]) {
    const p = await page(w, h, m);
    await p.goto(web);
    await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('bwm.tips', '{"on":false,"asked":true}'); localStorage.setItem('bwm.game', s); }, save);
    await p.goto(web);
    await p.getByTestId('table-talk').waitFor({ timeout: 60000 });
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${out}/${name}.png` });
    await p.context().close();
  }
}

// 5. host music controls (online lobby → sound popover), with a beat picked for the table
{
  const p = await page(430, 932);
  await p.goto(`${web}/online?server=${encodeURIComponent(server)}`);
  await p.getByLabel('Your name').fill('Demetrius');
  await p.getByTestId('create-table').click();
  await p.getByTestId('lobby').waitFor({ timeout: 20000 });
  await p.getByTestId('sound-button').click();
  await p.getByTestId('host-music').waitFor({ timeout: 5000 });
  await p.getByTestId('hm-beat-2').click();
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/08-host-music-beats.png` });
  await p.getByRole('tab', { name: 'Spotify / Apple' }).click();
  await p.getByLabel('Spotify or Apple Music link').fill('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  await p.getByLabel('Song title').fill('Never Gonna Give You Up — Rick Astley');
  await p.getByRole('button', { name: 'Share with the table' }).click();
  await p.getByTestId('music-card').first().waitFor({ timeout: 5000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/09-host-music-link.png` });
  await p.getByRole('tab', { name: 'Stream' }).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/10-host-music-stream.png` });
  await p.context().close();
}
await b.close();
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
console.log('release-3 shots done');
