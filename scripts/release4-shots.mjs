/**
 * Release-4 screenshots not covered by the other capture scripts: the online lobby's host options (partner mic mute,
 * nuke intensity, bot trash talk), the feedback sheet (opened, never sent), and bot trash talk in the table chat.
 * Usage: node scripts/release4-shots.mjs [outDir=screenshots/release-4] [web=http://localhost:4173] [server]
 * (server only when the build has no VITE_SERVER_URL baked in, e.g. a local preview against wrangler dev)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'screenshots/release-4';
const base = process.argv[3] ?? 'http://localhost:4173';
const server = process.argv[4] ?? '';
const want = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const errors = [];
const page = async (w, h, phone = false) => {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, permissions: ['camera', 'microphone'] })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); });
  await p.reload();
  return p;
};
const hl = (p, sel) => p.evaluate((sel) => { document.querySelectorAll(sel).forEach((el) => (el.closest('label, .sf-row, .lobby-opt, div') ?? el).classList.add('shot-highlight')); }, sel);

if (want('lobby')) {
  const q = server ? `?server=${encodeURIComponent(server)}` : '';
  const host = await page(1440, 900);
  await host.goto(`${base}/online${q}`);
  await host.getByLabel('Your name').fill('Demetrius');
  await host.getByTestId('create-table').click();
  await host.getByTestId('lobby').waitFor({ timeout: 20000 });
  await host.addStyleTag({ content: '.shot-highlight { outline: 2px solid #f5c542; outline-offset: 3px; border-radius: 6px; }' });
  for (const id of ['mic-mute-toggle', 'nuke-intensity', 'bot-talk-toggle']) if (!(await host.getByTestId(id).count())) errors.push(`lobby: ${id} missing`);
  for (const id of ['mic-mute-toggle', 'nuke-intensity', 'bot-talk-toggle']) await hl(host, `[data-testid="${id}"]`);
  await host.getByTestId('nuke-intensity').scrollIntoViewIfNeeded();
  await host.waitForTimeout(800);
  const vals = await host.evaluate(() => ({ mic: document.querySelector('[data-testid="mic-mute-toggle"]')?.getAttribute('aria-checked'), nuke: document.querySelector('[data-testid="nuke-intensity"]')?.value, talk: document.querySelector('[data-testid="bot-talk-toggle"]')?.getAttribute('aria-checked') }));
  console.log('lobby defaults', JSON.stringify(vals));
  await host.screenshot({ path: `${out}/lobby-host-options-1440x900.png` });
  await host.context().close();
}

if (want('feedback')) {
  const p = await page(390, 844, true);
  await p.getByRole('button', { name: 'Play vs Bots' }).first().click().catch(() => {});
  await p.locator('.icon-btn.gear').first().click();
  await p.getByTestId('more-options').waitFor();
  await p.getByTestId('open-feedback').click();
  await p.getByTestId('feedback').waitFor();
  await p.locator('[data-testid="feedback"] textarea').first().fill('Love the new nuke! The car could rev a little longer.').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/feedback-sheet-390x844.png` });
  await p.context().close();
}

if (want('talk')) {
  const p = await page(1440, 900);
  await p.evaluate(() => localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low', firstHandBidsItself: false })));
  await p.goto(`${base}/?autostart=1&seed=release4-talk`);
  const botLines = () => p.evaluate(() => [...document.querySelectorAll('.chat .chat-line:not(.system)')].filter((l) => !/^You\b/.test(l.textContent ?? '')).length);
  const legal = p.locator('[data-testid^="card-"][data-legal="true"]');
  for (let i = 0; i < 1500 && (await botLines()) < 14; i++) {
    const next = p.locator('[data-testid="talk-ready"]:not([disabled])'); if (await next.count()) { await next.click().catch(() => {}); continue; }
    const see = p.getByRole('button', { name: 'See my cards' }); if (await see.count()) { await see.click().catch(() => {}); continue; }
    const bid = p.locator('.bid-grid button'); if (await bid.count()) { await bid.nth(Math.min(3, (await bid.count()) - 1)).click({ timeout: 2000 }).catch(() => {}); continue; }
    if (await legal.count()) { const c = legal.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); }
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(600);
  const lines = await p.evaluate(() => [...document.querySelectorAll('.chat .chat-line:not(.system)')].map((l) => l.textContent));
  console.log('chat lines:', JSON.stringify(lines));
  await p.screenshot({ path: `${out}/bot-trash-talk-chat-1440x900.png` });
  const chat = await p.locator('.chat.open').boundingBox();
  if (chat) await p.screenshot({ path: `${out}/bot-trash-talk-chat-crop.png`, clip: { x: Math.max(0, chat.x - 10), y: Math.max(0, chat.y - 10), width: chat.width + 20, height: chat.height + 20 } });
  await p.context().close();
}
// Mid-animation stills of the wheels car and the lead-taking-spade callout. Software GL makes each screenshot take
// seconds, so the effect's wall-clock teardown timers are held and the CSS animations / smoke canvas frozen first.
const hold = (p) => p.evaluate(() => {
  const w = window; w.__origST = w.__origST ?? w.setTimeout; w.__held = [];
  w.setTimeout = (fn, ms, ...a) => (ms >= 500 ? (w.__held.push(fn), -1) : w.__origST(fn, ms, ...a));
});
const freeze = (p, ms) => p.evaluate((ms) => {
  document.getAnimations().forEach((a) => { a.pause(); if (ms != null) a.currentTime = ms; });
  window.__origRAF = window.__origRAF ?? window.requestAnimationFrame; window.requestAnimationFrame = () => 0;
}, ms);
const release = (p) => p.evaluate(() => { const w = window; w.setTimeout = w.__origST; w.requestAnimationFrame = w.__origRAF; document.getAnimations().forEach((a) => a.play()); w.__held.forEach((f) => w.setTimeout(f, 0)); });
if (want('wheels') || want('callout')) {
  for (const [w, h, tag, dpr] of [[1440, 900, 'desktop', 1], [390, 844, 'phone', 2]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: dpr > 1, hasTouch: dpr > 1 })).newPage();
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base);
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low' })); });
    await p.goto(`${base}/?autostart=1&seed=release4-wheels`);
    await p.waitForTimeout(6000);
    await p.evaluate(() => window.__bwmSound?.setMuted?.(true));
    if (want('wheels')) {
      await hold(p);
      await p.evaluate(() => window.__bwmFx.emit('wheelsCar', { text: 'You + Dre bid 10 · took 11' }));
      await p.waitForTimeout(1350);
      await freeze(p, 1450); // car mid peel-out (launch at 0.95 s), banner up, smoke from the rear wheels
      await p.screenshot({ path: `${out}/wheels-peel-out-${tag}.png` });
      if (!(await p.getByTestId('wheels-fx').count())) errors.push(`${tag}: wheels car not on screen`);
      await release(p);
      await p.waitForTimeout(3500);
    }
    if (want('callout')) {
      for (const [lvl, text] of [[2, 'SAY LESS!'], [3, 'IKYFL']]) {
        await hold(p);
        await p.evaluate(([level, text]) => window.__bwmFx.emit('overcut', { level, text }), [lvl, text]);
        await p.waitForTimeout(150);
        await freeze(p, 260);
        await p.screenshot({ path: `${out}/spade-callout-lvl${lvl}-${tag}.png` });
        const t = await p.locator('.hype-pop').allInnerTexts();
        console.log(`${tag} callout lvl${lvl}:`, JSON.stringify(t));
        if (t.some((x) => /overcut/i.test(x))) errors.push(`${tag}: callout says OVERCUT`);
        await release(p);
        await p.waitForTimeout(2200);
      }
    }
    await p.context().close();
  }
}

await b.close();
console.log(errors.length ? `errors: ${errors.join(' | ')}` : `RELEASE-4 SHOTS OK → ${out}`);
