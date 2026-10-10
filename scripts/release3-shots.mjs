/**
 * Release-3 screenshots: bid coach + Table Talk recap (phone portrait), the Big-over-Little nuke mid-explosion,
 * the desktop table at 1440x900 (chat on the right, bigger hand), the desktop online lobby and its Partner mic mute switch.
 * Usage: node scripts/release3-shots.mjs [outDir=screenshots/release-3] [web=http://localhost:4173] [server=http://127.0.0.1:8787]
 * The nuke shot fires the effect through the fx bus (window.__bwmFx.emit('nuke')) mid-trick; the game-state trigger
 * (Big Joker + Little Joker in one trick) is covered by apps/web/test/landCue.test.ts.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'screenshots/release-3';
const base = process.argv[3] ?? 'http://localhost:4173';
const server = process.argv[4] ?? 'http://127.0.0.1:8787';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (k) => !only || only.includes(k);
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const phone = async (w, h) => (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA })).newPage();
const desk = async (w, h) => { const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] }); return c.newPage(); };
const legal = (p) => p.locator('[data-testid^="card-"][data-legal="true"]');
const trickCount = (p) => p.getByTestId('hand').getAttribute('data-trick-count').then(Number).catch(() => 0);
const setup = (p, settings, tips) => p.evaluate(([s, t]) => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: t, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify(s)); }, [settings, tips]);
async function playStep(p) {
  const see = p.getByRole('button', { name: 'See my cards' });
  if (await see.count()) { await see.click({ timeout: 2000 }).catch(() => {}); return; }
  const bid = p.locator('.bid-grid button');
  if (await bid.count()) { await bid.nth(Math.min(3, (await bid.count()) - 1)).click({ timeout: 2000 }).catch(() => {}); return; }
  const l = legal(p);
  if (await l.count()) { const c = l.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); }
}

// 1) bid coach, phone portrait (tips on, so the coach opens in the bid panel)
if (want('coach')) {
  const p = await phone(390, 844);
  await p.goto(base); await setup(p, { mode: 'joker', speed: 'normal', blindNil: 'never', quality: 'low', firstHandBidsItself: false }, true);
  await p.goto(`${base}/?autostart=1&seed=release3-coach`);
  for (let i = 0; i < 600; i++) {
    if (await p.getByTestId('bid-coach').count()) break;
    const see = p.getByRole('button', { name: 'See my cards' }); if (await see.count()) await see.click({ timeout: 2000 }).catch(() => {});
    await p.getByTestId('coach-ok').click({ timeout: 300 }).catch(() => {});
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/1-bid-coach-390x844.png` });
  await p.context().close();
}

// 2) Table Talk recap, phone portrait (end of a bid hand)
if (want('talk')) {
  const p = await phone(390, 844);
  await p.goto(base); await setup(p, { mode: 'joker', speed: 'fast', blindNil: 'never', quality: 'low', firstHandBidsItself: false }, false);
  await p.goto(`${base}/?autostart=1&seed=release3-talk`);
  for (let i = 0; i < 4000 && !(await p.getByTestId('table-talk').count()); i++) { await playStep(p); await p.waitForTimeout(40); }
  await p.getByTestId('talk-recap').waitFor({ timeout: 10000 }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/2-table-talk-recap-390x844.png` });
  await p.context().close();
}

// 3) nuke mid-explosion (desktop) + 4) desktop table 1440x900, chat on the right, bigger hand
if (want('desk') || want('nuke')) {
  const p = await desk(1440, 900);
  await p.goto(base); await setup(p, { mode: 'joker', speed: 'normal', blindNil: 'never', quality: 'low', firstHandBidsItself: false }, false);
  await p.goto(`${base}/?autostart=1&seed=release3-desk`);
  for (let i = 0; i < 3000; i++) {
    if ((await legal(p).count()) && (await trickCount(p)) >= 2 && (await p.locator('[data-testid="last-trick"]').count())) break;
    await playStep(p); await p.waitForTimeout(40);
  }
  if (!(await p.locator('.chat.open').count())) await p.locator('.chat-toggle').click().catch(() => {});
  await p.waitForTimeout(2500);
  if (want('desk')) await p.screenshot({ path: `${out}/4-desktop-table-1440x900.png` });
  if (want('nuke')) {
    // a card on the felt first, so the blast sits over a live trick
    const c = legal(p).last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {});
    await p.waitForTimeout(700);
    await p.evaluate(() => window.__bwmFx.emit('nuke', { silent: true }));
    await p.waitForTimeout(140); await p.screenshot({ path: `${out}/3a-nuke-flash-1440x900.png` });
    await p.waitForTimeout(700); await p.screenshot({ path: `${out}/3b-nuke-mushroom-1440x900.png` });
    await p.waitForTimeout(900); await p.screenshot({ path: `${out}/3c-nuke-smoke-1440x900.png` });
  }
  await p.context().close();
}

// 5) desktop lobby (host + one guest seated, cameras on)
if (want('lobby')) {
  const q = `?server=${encodeURIComponent(server)}`;
  const host = await desk(1440, 900);
  const guest = await phone(390, 844);
  for (const pg of [host, guest]) { await pg.goto(base); await pg.evaluate(() => localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }))); }
  await host.goto(`${base}/online${q}`);
  await host.getByLabel('Your name').fill('Demetrius');
  await host.getByTestId('create-table').click();
  await host.getByTestId('lobby').waitFor({ timeout: 20000 });
  const code = (await host.getByTestId('room-code').locator('b').innerText()).trim();
  await guest.goto(`${base}/t/${code}${q}`);
  await guest.getByLabel('Your name').fill('Keisha');
  await guest.getByRole('button', { name: `Join table ${code}` }).click();
  await guest.getByTestId('lobby').waitFor({ timeout: 20000 });
  await guest.getByTestId('lobby-seat-2').getByRole('button', { name: 'Sit here' }).click();
  await host.getByTestId('lobby-seat-2').getByText('Keisha').waitFor();
  await host.getByRole('button', { name: 'Turn camera on' }).click().catch(() => {});
  await guest.locator('.lobby-chat input, [data-testid="lobby-chat-tab"]').first().waitFor().catch(() => {});
  await host.locator('.lobby-chat input').fill('who ready to get set? 😤').catch(() => {});
  await host.locator('.lobby-chat input').press('Enter').catch(() => {});
  await host.waitForTimeout(2500);
  await host.screenshot({ path: `${out}/5-desktop-lobby-1440x900.png` });
  // the host's Partner mic mute switch (off by default) in the settings panel
  const mm = host.getByTestId('mic-mute-toggle');
  await mm.scrollIntoViewIfNeeded();
  await mm.evaluate((el) => el.closest('label')?.classList.add('shot-highlight'));
  await host.addStyleTag({ content: '.shot-highlight { outline: 2px solid #f5c542; outline-offset: 3px; border-radius: 6px; }' });
  await host.waitForTimeout(400);
  await host.screenshot({ path: `${out}/6-lobby-mic-mute-toggle.png` });
  await host.context().close(); await guest.context().close();
}
await b.close();
console.log('shots in', out);
