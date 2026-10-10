/**
 * Table layout check + screenshots across phone portrait/landscape, iPad and desktop sizes.
 * One offline game (vs bots) and one online game (2 browsers, fake camera → video bubbles), each resized through
 * every size mid-trick. For every size it checks that the HTML overlays (scorebug, trump chip, name plates, last-trick,
 * chat / cam / mic controls, "X takes it" banner) don't overlap each other, stay on screen, and never cover the trick
 * cards or the hand (3D rects come from window.__bwmLayout), that trick cards don't overlap and the hand is fully visible.
 * Usage: node scripts/layout-check.mjs [web=http://localhost:4173] [server=http://127.0.0.1:8787] [out=screenshots/layout]
 * ONLY=offline|online, STRICT=0 to report without failing.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://127.0.0.1:8787';
const out = process.argv[4] ?? 'screenshots/layout';
const strict = process.env.STRICT !== '0';
mkdirSync(out, { recursive: true });
export const SIZES = [
  ['phone-land-667x375', 667, 375], ['phone-land-844x390', 844, 390], ['phone-land-932x430', 932, 430],
  ['ipad-1024x768', 1024, 768], ['ipad-1180x820', 1180, 820],
  ['phone-320x640', 320, 640], ['phone-375x667', 375, 667], ['phone-390x844', 390, 844], ['phone-414x896', 414, 896], ['phone-430x932', 430, 932], ['phone-440x956', 440, 956],
  ['desktop-1280x800', 1280, 800],
];
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const problems = [];
const errors = [];
async function newPage(label, w = 844, h = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|net::ERR/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  await page.addInitScript(() => { try { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); } catch { /* */ } });
  return page;
}

/** Measure overlays + 3D rects in the page and return a list of problems. */
async function measure(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.width > 1 && r.height > 1; };
    const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const union = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)); return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 }; };
    const boxes = [];
    const add = (name, el, extra = []) => { if (el && vis(el)) boxes.push({ name, r: union([R(el), ...extra.filter(vis).map(R)]) }); };
    const bug = document.querySelector('.scorebug');
    if (bug) { const kids = [...bug.children].filter(vis).map(R); if (kids.length) boxes.push({ name: 'scorebug', r: union(kids) }); }
    add('trumps', document.querySelector('.trump-strip'));
    document.querySelectorAll('.badge-layer .plate').forEach((p) => add(`plate:${p.querySelector('.plate-name')?.textContent?.trim().split(/\s/)[0]}`, p, [...p.querySelectorAll('.vbubble, .plate-turn, .turn-clock')]));
    const me = document.querySelector('.me-plate'); if (me) add('me-plate', me, [...me.querySelectorAll('.vbubble, .plate-turn, .turn-clock')]);
    add('last-trick', document.querySelector('.last-trick'));
    add('chat-btn', document.querySelector('.chat-toggle'));
    document.querySelectorAll('.av-btn').forEach((b, i) => add(`av${i}`, b));
    add('controls', document.querySelector('.ctl-cluster'));
    add('sound-dock', document.querySelector('.dock-btn'));
    add('banner', document.querySelector('.center-note'));
    const L = window.__bwmLayout ?? { trick: [], hand: [] };
    const ov = (a, b, pad = 0) => a.x + pad < b.x + b.w && b.x + pad < a.x + a.w && a.y + pad < b.y + b.h && b.y + pad < a.y + a.h;
    const probs = [];
    for (const b of boxes) if (b.r.x < -1 || b.r.y < -1 || b.r.x + b.r.w > W + 1 || b.r.y + b.r.h > H + 1) probs.push(`${b.name} off screen ${JSON.stringify(b.r)}`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if ((a.name === 'controls' && b.name.startsWith('av')) || (b.name === 'controls' && (a.name.startsWith('av') || a.name === 'chat-btn')) || (a.name === 'controls' && b.name === 'chat-btn')) continue;
      if (ov(a.r, b.r, 1)) probs.push(`${a.name} overlaps ${b.name}`);
    }
    L.trick.forEach((t, i) => {
      for (const b of boxes) if (ov(b.r, t, 2)) probs.push(`${b.name} covers trick card ${i}`);
      L.trick.forEach((u, j) => { if (j > i && ov(t, u, 3)) probs.push(`trick cards ${i}/${j} overlap`); });
    });
    const hand = L.hand.length ? union(L.hand) : null;
    if (hand) {
      if (hand.y + hand.h > H + 1 || hand.x < -1 || hand.x + hand.w > W + 1) probs.push(`hand off screen ${JSON.stringify(hand)} in ${W}x${H}`);
      for (const b of boxes) for (const c of L.hand) if (ov(b.r, c, 2)) { probs.push(`${b.name} covers the hand`); break; }
    }
    // scorebug numbers must fit in portrait (worst case: a negative 4-character score and two-digit bags)
    const setText = (el, t) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const n = w.nextNode(); if (n) n.nodeValue = t; };
    const scores = [...document.querySelectorAll('.bug-score')], bagsEl = [...document.querySelectorAll('.bug-bags')];
    const saved = [...scores, ...bagsEl].map((el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); return w.nextNode()?.nodeValue; });
    scores.forEach((el, i) => setText(el, i % 2 ? '186' : '-155'));
    bagsEl.forEach((el) => setText(el, '12'));
    document.querySelectorAll('.bug-team').forEach((t, i) => {
      if (!vis(t)) return;
      const tr = t.getBoundingClientRect();
      for (const el of t.querySelectorAll('.bug-score, .bug-bags')) {
        const r = el.getBoundingClientRect();
        if (r.right > tr.right + 1 || r.left < tr.left - 1 || r.right > W + 1) probs.push(`scorebug team ${i} ${el.className} clipped (${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(tr.left)}-${Math.round(tr.right)})`);
      }
    });
    [...scores, ...bagsEl].forEach((el, i) => { if (saved[i] != null) setText(el, saved[i]); });
    if (bug) for (const k of bug.children) { if (!vis(k)) continue; const r = k.getBoundingClientRect(); if (r.right > W + 1) probs.push(`scorebug item ${k.className} off the right edge`); }
    return { probs, boxes: boxes.map((b) => b.name) };
  });
}

/**
 * With a modal open, nothing on the table may paint over it: sample a grid of points inside the modal box and make
 * sure the topmost element at each is the modal itself (the global sound button is the one allowed exception).
 */
async function modalCheck(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.tt, .modal-backdrop .modal');
    if (!m) return ['no modal open'];
    const r = m.getBoundingClientRect(), probs = new Set();
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + 1 + (r.width - 2) * i / 12)), y = Math.min(innerHeight - 1, Math.max(0, r.top + 1 + (r.height - 2) * j / 12));
      const el = document.elementFromPoint(x, y);
      if (!el || m.contains(el) || el.closest('.sound-dock')) continue;
      probs.add(`${(el.closest('.plate, .vbubble, .chat, .last-trick, .ctl-cluster, .chat-ticker, .scorebug, .coach') ?? el).className || el.tagName} paints over the modal`);
    }
    return [...probs];
  });
}

/** Table Talk (between hands) at every size: no horizontal overflow, team totals fully visible, Ready reachable. */
async function talkCheck(page, tag) {
  for (const [label, w, h] of SIZES.filter(([, w, h]) => !only || only.includes(`${w}x${h}`))) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const W = innerWidth, H = innerHeight, probs = [];
      const tt = document.querySelector('.tt');
      if (!tt) return ['table talk not shown'];
      if (document.documentElement.scrollWidth > W + 1) probs.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
      const body = tt.querySelector('.tt-body');
      if (body && body.scrollWidth > body.clientWidth + 1) probs.push('recap scrolls sideways');
      for (const el of tt.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) { probs.push(`${el.className || el.tagName} past the edge`); break; } }
      document.querySelectorAll('[data-testid^="recap-total-"], [data-testid^="recap-books-"]').forEach((el) => { const r = el.getBoundingClientRect(), t = el.closest('.tt-team').getBoundingClientRect(); if (r.right > t.right + 1 || r.left < t.left - 1) probs.push(`${el.dataset.testid} clipped`); });
      const ready = document.querySelector('[data-testid="talk-ready"]')?.getBoundingClientRect();
      if (!ready || ready.bottom > H + 1 || ready.right > W + 1) probs.push('Ready / Continue not on screen');
      return probs;
    });
    m.push(...(await modalCheck(page)));
    await page.screenshot({ path: `${out}/${tag}-talk-${label}.png` });
    console.log(`${m.length ? '✗' : '✓'} ${tag} table talk ${label}${m.length ? ': ' + m.join('; ') : ''}`);
    m.forEach((x) => problems.push(`${tag} talk ${label}: ${x}`));
  }
}

const legal = (p) => p.locator('[data-testid^="card-"][data-legal="true"]');
async function step(p) {
  const next = p.locator('[data-testid="talk-ready"]:not([disabled])');
  if (await next.count()) { await next.click({ timeout: 2000 }).catch(() => {}); return 'next'; }
  const see = p.getByRole('button', { name: 'See my cards' });
  if (await see.count()) { await see.click({ timeout: 2000 }).catch(() => {}); return 'see'; }
  const bid = p.locator('.bid-grid button');
  if (await bid.count()) { await bid.nth(Math.min(2, (await bid.count()) - 1)).click({ timeout: 2000 }).catch(() => {}); return 'bid'; }
  const l = legal(p);
  if (await l.count()) { const c = l.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); return 'play'; }
  return null;
}
const trickCount = (p) => p.getByTestId('hand').getAttribute('data-trick-count').then(Number).catch(() => 0);

const only = process.env.SIZES ? process.env.SIZES.split(',') : null; // e.g. SIZES=1280x800,390x844
async function sweepSizes(page, tag) {
  for (const [label, w, h] of SIZES.filter(([, w, h]) => !only || only.includes(`${w}x${h}`))) {
    await page.bringToFront(); // a background tab throttles rAF/ResizeObserver, so the canvas would keep its old size
    await page.setViewportSize({ width: w, height: h });
    // SwiftShader with two pages + fake video renders slowly: wait until the canvas has repainted at the new size
    await page.waitForTimeout(1300);
    // slow software GL can lag the React/R3F resize by seconds: measure once the 3D layout matches this size and has settled
    await page.waitForFunction(([w, h]) => window.__bwmLayout?.w === w && window.__bwmLayout?.h === h, [w, h], { timeout: 15000 }).catch(() => {});
    for (let k = 0, prev = ''; k < 20; k++) {
      const cur = await page.evaluate(() => JSON.stringify(window.__bwmLayout));
      if (cur === prev) break;
      prev = cur; await page.waitForTimeout(600);
    }
    const m = await measure(page);
    await page.screenshot({ path: `${out}/${tag}-${label}.png` });
    const p = m.probs;
    console.log(`${p.length ? '✗' : '✓'} ${tag} ${label}${p.length ? ': ' + p.join('; ') : ''}`);
    p.forEach((x) => problems.push(`${tag} ${label}: ${x}`));
    if (process.env.DEBUG && p.length) for (let k = 0; k < 8; k++) { console.log(JSON.stringify(await page.evaluate(() => { const c = document.querySelector('.table-canvas canvas'); const L = window.__bwmLayout; return { t: Math.round(performance.now()), win: [innerWidth, innerHeight], canvas: c && [c.width, c.height, c.clientWidth, c.clientHeight], L: L && [L.w, L.h], h0: L?.hand?.[0], nh: L?.hand?.length, vis: document.visibilityState }; }))); await page.waitForTimeout(700); }
    if (process.env.DEBUG && p.length) console.log(JSON.stringify(await page.evaluate(() => ({ L: window.__bwmLayout, cards: document.querySelectorAll('[data-testid^="card-"]').length }))).slice(0, 1500));
  }
}

/** Play until a "takes it" banner shows, then check it against the trick at the current size. */
async function bannerCheck(pages, tag, sizes) {
  for (const [label, w, h] of sizes) {
    const page = pages[0];
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1200);
    const end = Date.now() + 60000;
    let seen = false;
    while (Date.now() < end && !seen) {
      if (await page.locator('.center-note.win').count()) {
        await page.waitForTimeout(120); // banner places itself after two frames
        const m = await measure(page);
        await page.screenshot({ path: `${out}/${tag}-banner-${label}.png` });
        console.log(`${m.probs.length ? '✗' : '✓'} ${tag} banner ${label}${m.probs.length ? ': ' + m.probs.join('; ') : ''}`);
        m.probs.forEach((x) => problems.push(`${tag} banner ${label}: ${x}`));
        seen = true; break;
      }
      for (const p of pages) await step(p);
      await page.waitForTimeout(30);
    }
    // let the trick finish before the next size
    await page.waitForTimeout(1500);
  }
}

if (!process.env.ONLY || process.env.ONLY === 'offline') {
  const page = await newPage('offline');
  await page.goto(`${web}/`);
  await page.evaluate(() => { localStorage.removeItem('bwm.game'); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'normal', quality: 'low' })); });
  await page.goto(`${web}/?autostart=1&seed=layout-1`);
  for (let i = 0; i < 2000; i++) {
    if ((await legal(page).count()) && (await trickCount(page)) >= 2 && (await page.locator('[data-testid="last-trick"]').count())) break;
    await step(page);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(800);
  await sweepSizes(page, 'offline');
  await bannerCheck([page], 'offline', [SIZES[1], SIZES[0], SIZES[3], SIZES[7]]);
  // modal stacking: the leave-confirm modal over the full table (plates, chat, last trick) at every size
  await page.getByTestId('menu').click();
  for (const [label, w, h] of SIZES.filter(([, w, h]) => !only || only.includes(`${w}x${h}`))) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(900);
    const m = await modalCheck(page);
    await page.screenshot({ path: `${out}/offline-modal-${label}.png` });
    console.log(`${m.length ? '✗' : '✓'} offline modal ${label}${m.length ? ': ' + m.join('; ') : ''}`);
    m.forEach((x) => problems.push(`offline modal ${label}: ${x}`));
  }
  await page.getByRole('button', { name: 'Stay' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (let i = 0; i < 3000 && !(await page.getByTestId('table-talk').count()); i++) {
    const bid = page.locator('.bid-grid button'); if (await bid.count()) { await bid.nth(Math.min(2, (await bid.count()) - 1)).click({ timeout: 2000 }).catch(() => {}); continue; }
    const l = legal(page); if (await l.count()) { const c = l.last(); await c.dispatchEvent('click'); await c.dispatchEvent('click').catch(() => {}); }
    await page.waitForTimeout(40);
  }
  await talkCheck(page, 'offline');
  await page.context().close();
}

if (!process.env.ONLY || process.env.ONLY === 'online') {
  const q = `?server=${encodeURIComponent(server)}`;
  const host = await newPage('host');
  const guest = await newPage('guest', 390, 844);
  await host.goto(`${web}/online${q}`);
  await host.getByLabel('Your name').fill('Demetrius');
  await host.getByTestId('create-table').click();
  await host.getByTestId('lobby').waitFor({ timeout: 20000 });
  const code = (await host.getByTestId('room-code').locator('b').innerText()).trim();
  await guest.goto(`${web}/t/${code}${q}`);
  await guest.getByLabel('Your name').fill('Keisha');
  await guest.getByRole('button', { name: `Join table ${code}` }).click();
  await guest.getByTestId('lobby').waitFor({ timeout: 20000 });
  await guest.getByTestId('lobby-seat-2').getByRole('button', { name: 'Sit here' }).click();
  await host.getByTestId('lobby-seat-2').getByText('Keisha').waitFor();
  for (const p of [host, guest]) {
    for (let i = 0; i < 4; i++) { await p.getByRole('button', { name: 'Turn camera on' }).click().catch(() => {}); try { await p.getByRole('button', { name: 'Turn camera off' }).waitFor({ timeout: 4000 }); break; } catch { /* retry */ } }
  }
  await host.getByRole('button', { name: 'Turn microphone on' }).click().catch(() => {});
  await host.getByTestId('start').click();
  await host.locator('.table-screen').waitFor({ timeout: 20000 });
  await host.waitForFunction(() => document.querySelector('.badge-layer [data-testid^="video-"][data-live="true"] video')?.videoWidth > 0, null, { timeout: 30000 }).catch(() => console.log('(remote video not live yet)'));
  for (let i = 0; i < 3000; i++) {
    if ((await legal(host).count()) && (await trickCount(host)) >= 2 && (await host.locator('[data-testid="last-trick"]').count())) break;
    for (const p of [host, guest]) await step(p);
    await host.waitForTimeout(40);
  }
  await host.waitForTimeout(800);
  await sweepSizes(host, 'online');
  if (!only) await bannerCheck([host, guest], 'online', [SIZES[1], SIZES[2]]);
}

await browser.close();
if (errors.length) console.log('Browser errors:\n' + errors.join('\n'));
console.log(problems.length ? `${problems.length} layout problem(s)` : 'LAYOUT OK');
if (strict && (problems.length || errors.length)) process.exit(1);
