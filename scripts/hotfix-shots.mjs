/**
 * Release 6 hotfix captures (phone 390x844, local Worker with TEST_HOOKS):
 *  setup-music-390 (Table music in Create table), lobby-host-music-390 (host controls in the lobby),
 *  lobby-guest-390 (a player's lobby: "Host is playing" card + their own Host music volume),
 *  sound-sheet-390(-bottom) (the phone sound sheet), victory-bots-390 (winners without video: name cards + team headline).
 * Checks: sheet edge to edge, sliders ≥ 44 px tall, music set before the game persists into it, victory fits without scrolling.
 * Usage: node scripts/hotfix-shots.mjs [web=http://localhost:4173] [server=http://localhost:8787]
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://localhost:8787';
const out = 'screenshots/release-6-hotfix';
const save = JSON.parse(execFileSync('npx', ['tsx', 'scripts/runit-state.ts', 'joker', '3'], { encoding: 'utf8' }));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [], fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const page = async (label) => {
  const p = await (await b.newContext(opts)).newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });
  await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
  return p;
};
const LINK = 'https://open.spotify.com/track/0wgtBgfhFqmqIqWaqrj3Xq';
// ---- host: Create table with a shared link as the table music
const host = await page('host');
await host.getByTestId('play-online').click();
await host.getByTestId('mode-joker').click();
await host.getByLabel('Your name').fill('Demetrius');
await host.getByTestId('setup-music-select').selectOption('link');
await host.getByLabel('Spotify or Apple Music link').fill(LINK);
await host.getByLabel('Song title').fill('Before I Let Go — Maze');
await host.getByTestId('setup-music').scrollIntoViewIfNeeded();
await host.screenshot({ path: `${out}/setup-music-390.png` });
await host.getByTestId('create-table').click();
await host.getByTestId('lobby').waitFor({ timeout: 20000 });
const code = (await host.getByTestId('room-code').locator('b').innerText()).trim();
await host.getByTestId('lobby-music').scrollIntoViewIfNeeded();
await host.getByTestId('music-card').waitFor({ timeout: 10000 }).catch(() => ok(false, 'host lobby: the setup link never became the table music'));
await host.waitForTimeout(600);
await host.getByTestId('lobby-music').screenshot({ path: `${out}/lobby-host-music-390-panel.png` });
await host.screenshot({ path: `${out}/lobby-host-music-390.png` });
ok(await host.locator('[data-testid="lobby-music"] .hm-tabs').count() === 1, 'host lobby: no Beats / link / Stream controls');
// the host names the team: the victory headline is the team name, the players' names go under it
await host.locator('#lobby-team-name-in').fill('Shot Callers');
await host.locator('#lobby-team-name-in').press('Enter');
await host.waitForTimeout(500);
// ---- a guest in the lobby
const guest = await page('guest');
await guest.goto(`${web}/t/${code}?server=${encodeURIComponent(server)}`);
await guest.getByLabel('Your name').fill('Zuri');
await guest.getByRole('button', { name: `Join table ${code}` }).click();
await guest.getByTestId('lobby').waitFor({ timeout: 20000 });
await guest.getByTestId('lobby-music').scrollIntoViewIfNeeded();
await guest.getByTestId('music-card').waitFor({ timeout: 10000 }).catch(() => ok(false, 'guest lobby: no "Host is playing" card'));
ok(await guest.locator('[data-testid="lobby-music"] [data-testid="host-music-volume"]').count() === 1, 'guest lobby: no Host music volume');
ok(await guest.locator('[data-testid="lobby-music"] .hm-tabs').count() === 0, 'guest lobby: guest sees host controls');
await guest.screenshot({ path: `${out}/lobby-guest-390.png` });
await guest.context().close();
// ---- start: the music carries into the game; the sound sheet
await host.getByTestId('start').click();
await host.locator('.table-screen').waitFor({ timeout: 20000 });
await host.waitForTimeout(2500);
await host.getByTestId('sound-button').click();
const sheet = host.getByTestId('sound-sheet');
await sheet.waitFor();
await host.waitForTimeout(500);
const m = await host.evaluate(() => {
  const s = document.querySelector('[data-testid="sound-sheet"]').getBoundingClientRect();
  const sliders = [...document.querySelectorAll('[data-testid="sound-sheet"] .vol-slider')].map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, label: e.getAttribute('aria-label') }; });
  return { left: s.left, right: s.right, w: innerWidth, bottom: s.bottom, h: innerHeight, sliders, card: !!document.querySelector('[data-testid="sound-sheet"] [data-testid="music-card"]') };
});
ok(m.left <= 0.5 && Math.abs(m.right - m.w) <= 0.5, `sound sheet not edge to edge (${m.left}-${m.right} of ${m.w})`);
ok(m.bottom <= m.h + 0.5, 'sound sheet runs past the viewport');
ok(m.sliders.length >= 4 && m.sliders.every((x) => x.h >= 44 && x.w >= 300), `sliders too small: ${JSON.stringify(m.sliders)}`);
ok(m.sliders.some((x) => x.label === 'Host music'), 'no Host music slider in the sheet');
ok(m.card, 'the setup link did not persist into the game');
await host.screenshot({ path: `${out}/sound-sheet-390.png` });
await sheet.evaluate((e) => { e.scrollTop = e.scrollHeight; });
await host.waitForTimeout(400);
await host.screenshot({ path: `${out}/sound-sheet-390-bottom.png` });
await host.locator('.sheet-x').click();
// ---- victory with bot / camera-off winners (Run it! position: Demetrius + Sven win)
const r = await fetch(`${server}/api/tables/${code}/test-state`, { method: 'POST', body: JSON.stringify(save.state) });
if (!r.ok) throw new Error(`test-state ${r.status}: start the local Worker with --var TEST_HOOKS:1`);
await host.getByTestId('run-it').waitFor({ timeout: 60000 });
await host.waitForTimeout(800);
await host.getByTestId('run-it').tap({ force: true });
await host.getByTestId('victory-spot').waitFor({ timeout: 60000 }).catch(async (e) => { await host.screenshot({ path: '/tmp/hs-fail.png' }); throw e; });
await host.waitForTimeout(2500);
const v = await host.evaluate(() => {
  const sc = document.querySelector('.victory-screen');
  const btn = document.querySelector('[data-testid="rematch"]').getBoundingClientRect();
  return { scroll: sc.scrollHeight - sc.clientHeight, btnBottom: btn.bottom, h: innerHeight, title: document.querySelector('[data-testid="vs-title"]')?.textContent, sub: document.querySelector('[data-testid="vs-sub"]')?.textContent, names: [...document.querySelectorAll('.vs-name')].map((e) => e.textContent), cards: document.querySelectorAll('.vs-tile.win.card').length };
});
ok((v.names ?? []).includes('Demetrius (you)'), `your own winner card should show your name: ${JSON.stringify(v.names)}`);
ok(/shot callers win/i.test(v.title ?? ''), `victory headline is not the team name: ${v.title}`);
ok(!!v.sub && v.sub.includes('&'), `no player names under the team name: ${v.sub}`);
ok(v.scroll <= 1 && v.btnBottom <= v.h, `victory scrolls (${v.scroll}px, buttons at ${v.btnBottom}/${v.h})`);
ok(v.cards === 2 && v.names.every((n) => n.length > 1), `winner name cards: ${JSON.stringify(v)}`);
await host.screenshot({ path: `${out}/victory-bots-390.png` });
console.log(JSON.stringify({ sheet: m, victory: v }));
await b.close();
if (errors.length) console.log(`page errors:\n${errors.join('\n')}`);
if (fails.length) { console.log(`✗ ${fails.join('\n✗ ')}`); process.exit(1); }
console.log('HOTFIX SHOTS OK');
