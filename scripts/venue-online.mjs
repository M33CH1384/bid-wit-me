/**
 * Release 7: the host picks the venue in the online lobby; a guest sees the pick there, and both tables load it.
 * Then Random: rolled at the start, the same venue on every screen. Needs the local Worker (8787) + preview (4173).
 * Usage: node scripts/venue-online.mjs [web] [server]   (screenshots → screenshots/release-7/venues/online-*.png)
 */
import { chromium } from 'playwright-core';
const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://127.0.0.1:8787';
const out = 'screenshots/release-7/venues';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
const page = async (label) => {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ quality: 'low' })); });
  await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
  return p;
};
const ok = (c, m) => { if (!c) { console.error('✗', m); process.exitCode = 1; } };
const host = await page('host');
await host.getByTestId('play-online').click();
await host.getByTestId('mode-joker').click();
await host.getByLabel('Your name').fill('Demetrius');
await host.getByTestId('create-table').click();
await host.getByTestId('lobby').waitFor({ timeout: 20000 });
const code = (await host.getByTestId('room-code').locator('b').innerText()).trim();
await host.getByTestId('lobby-venue').selectOption('vegas');
const guest = await page('guest');
await guest.goto(`${web}/t/${code}?server=${encodeURIComponent(server)}`);
await guest.getByLabel('Your name').fill('Zuri');
await guest.getByRole('button', { name: `Join table ${code}` }).click();
await guest.getByTestId('lobby').waitFor({ timeout: 20000 });
await guest.getByTestId('venue-guest').scrollIntoViewIfNeeded();
await guest.waitForFunction(() => /Vegas/.test(document.querySelector('[data-testid="venue-guest"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => ok(false, 'guest lobby does not show the host venue pick'));
await guest.screenshot({ path: `${out}/online-lobby-venue-guest-390.png` });
ok((await guest.getByTestId('lobby-venue').count()) === 0, 'guest can change the venue');
await host.getByTestId('lobby-venue').scrollIntoViewIfNeeded();
await host.screenshot({ path: `${out}/online-lobby-venue-host-390.png` });
await host.getByTestId('start').click();
const venueOf = (p) => p.waitForFunction(() => window.__bwmVenue?.id, null, { timeout: 60000 }).then((h) => h.jsonValue());
const [hv, gv] = await Promise.all([venueOf(host), venueOf(guest)]);
ok(hv === 'vegas' && gv === 'vegas', `tables loaded ${hv} / ${gv}, want vegas`);
await guest.waitForTimeout(2500);
await guest.screenshot({ path: `${out}/online-table-vegas-guest-390.png` });
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
console.log(process.exitCode ? 'VENUE ONLINE FAILED' : `VENUE ONLINE OK (host picked Vegas; host + guest tables: ${hv} / ${gv})`);
await b.close();
