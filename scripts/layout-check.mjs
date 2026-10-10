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
  ['desktop-1280x800', 1280, 800], ['desktop-1440x900', 1440, 900], ['desktop-1920x1080', 1920, 1080],
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
    add('chat', document.querySelector('.chat.open'));
    const L = window.__bwmLayout ?? { trick: [], hand: [] };
    const ov = (a, b, pad = 0) => a.x + pad < b.x + b.w && b.x + pad < a.x + a.w && a.y + pad < b.y + b.h && b.y + pad < a.y + a.h;
    const probs = [];
    for (const b of boxes) if (b.r.x < -1 || b.r.y < -1 || b.r.x + b.r.w > W + 1 || b.r.y + b.r.h > H + 1) probs.push(`${b.name} off screen ${JSON.stringify(b.r)}`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if ((a.name === 'controls' && b.name.startsWith('av')) || (a.name.startsWith('av') && b.name.startsWith('av')) || (b.name === 'controls' && (a.name.startsWith('av') || a.name === 'chat-btn')) || (a.name === 'controls' && b.name === 'chat-btn')) continue;
      if (ov(a.r, b.r, 1)) probs.push(`${a.name} overlaps ${b.name}`);
    }
    // top bar: ☰, ?, 📋, HQ and the sound button are one set: same top, height and width, aligned with the scorebug
    { const bugEl = document.querySelector('.scorebug > .bug');
      const btns = [...document.querySelectorAll('.scorebug .bug-btn:not(.dock-slot), .dock-btn')].filter(vis).map((e) => ({ n: e.getAttribute('aria-label')?.split(/[ :]/)[0] ?? e.className, r: e.getBoundingClientRect() }));
      if (bugEl && btns.length) { const ref = bugEl.getBoundingClientRect();
        for (const b of btns) {
          if (Math.abs(b.r.top - ref.top) > 1.5 || Math.abs(b.r.height - ref.height) > 1.5) probs.push(`top-bar ${b.n} not aligned with the scorebug (top ${b.r.top.toFixed(1)}/${ref.top.toFixed(1)}, h ${b.r.height.toFixed(1)}/${ref.height.toFixed(1)})`);
          if (Math.abs(b.r.width - btns[0].r.width) > 1.5) probs.push(`top-bar ${b.n} width ${b.r.width.toFixed(1)} ≠ ${btns[0].r.width.toFixed(1)}`);
        } } }
    L.trick.forEach((t, i) => {
      for (const b of boxes) if (ov(b.r, t, 2)) probs.push(`${b.name} covers trick card ${i}`);
      L.trick.forEach((u, j) => { if (j > i && ov(t, u, 3)) probs.push(`trick cards ${i}/${j} overlap`); });
    });
    const hand = L.hand.length ? union(L.hand) : null;
    if (hand) {
      if (hand.y + hand.h > H + 1 || hand.x < -1 || hand.x + hand.w > W + 1) probs.push(`hand off screen ${JSON.stringify(hand)} in ${W}x${H}`);
      for (const b of boxes) for (const c of L.hand) if (ov(b.r, c, 2)) { probs.push(`${b.name} covers the hand`); break; }
      // the (bigger, desktop) hand must never reach into the trick area
      L.trick.forEach((t, i) => { if (L.hand.some((c) => ov(c, t, 2))) probs.push(`hand covers trick card ${i}`); });
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
    const own = m.closest('.modal-backdrop, .tt-backdrop'); // the modal's own backdrop shows through its slanted corners
    const pad = 16;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + pad + (r.width - 2 * pad) * i / 12)), y = Math.min(innerHeight - 1, Math.max(0, r.top + pad + (r.height - 2 * pad) * j / 12));
      const el = document.elementFromPoint(x, y);
      if (!el || m.contains(el) || el === own || el.closest('.sound-dock')) continue;
      probs.add(`${(el.closest('.plate, .vbubble, .chat, .last-trick, .ctl-cluster, .chat-ticker, .scorebug, .coach') ?? el).className || el.tagName} paints over the modal`);
    }
    return [...probs];
  });
}

/** Online lobby: wide = columns that fit the viewport with chat always visible; phones = chat tab one tap away. */
async function lobbyCheck(page) {
  for (const [label, w, h] of SIZES.filter(([, w, h]) => (!only || only.includes(`${w}x${h}`)) && (w >= 1280 || w < 500))) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    const probs = await page.evaluate(() => {
      const W = innerWidth, H = innerHeight, out = [];
      const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.top >= -1 && r.bottom <= H + 1 && r.left >= -1 && r.right <= W + 1; };
      if (document.documentElement.scrollWidth > W + 1) out.push('lobby scrolls sideways');
      if (!vis(document.querySelector('[data-testid="lobby-home"]'))) out.push('Home control not visible');
      if (W >= 1024) {
        if (document.scrollingElement.scrollHeight > H + 1) out.push(`lobby page scrolls (${document.scrollingElement.scrollHeight} > ${H})`);
        if (!vis(document.querySelector('.lobby-chat input'))) out.push('chat input not visible without scrolling');
        if (!vis(document.querySelector('[data-testid="room-code"]'))) out.push('table code not visible');
      } else {
        const t = document.querySelector('[data-testid="lobby-chat-tab"]');
        if (!vis(t)) out.push('chat tab not on screen');
        else { const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (!t.contains(e)) out.push(`chat tab covered by ${e?.className || e?.tagName}`); }
      }
      return out;
    });
    if (w < 1024) {
      await page.getByTestId('lobby-chat-tab').dispatchEvent('click');
      await page.waitForTimeout(300);
      const ok = await page.evaluate(() => { const r = document.querySelector('.lobby-chat input')?.getBoundingClientRect(); return !!r && r.width > 0 && r.bottom <= innerHeight + 1; });
      if (!ok) probs.push('chat drawer input not on screen after one tap');
      await page.screenshot({ path: `${out}/lobby-chat-${label}.png` });
      await page.getByTestId('lobby-chat-tab').dispatchEvent('click');
    }
    await page.screenshot({ path: `${out}/lobby-${label}.png` });
    console.log(`${probs.length ? '✗' : '✓'} lobby ${label}${probs.length ? ': ' + probs.join('; ') : ''}`);
    probs.forEach((x) => problems.push(`lobby ${label}: ${x}`));
  }
  await page.setViewportSize({ width: 844, height: 390 });
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

async function syncChat(page, w) {
  const open = await page.locator('.chat.open').count();
  if ((w >= 1200) !== !!open) { await page.locator('.chat-toggle').click().catch(() => {}); await page.waitForTimeout(300); }
}
const only = process.env.SIZES ? process.env.SIZES.split(',') : null; // e.g. SIZES=1280x800,390x844
async function sweepSizes(page, tag) {
  for (const [label, w, h] of SIZES.filter(([, w, h]) => !only || only.includes(`${w}x${h}`))) {
    await page.bringToFront(); // a background tab throttles rAF/ResizeObserver, so the canvas would keep its old size
    await page.setViewportSize({ width: w, height: h });
    // SwiftShader with two pages + fake video renders slowly: wait until the canvas has repainted at the new size
    await page.waitForTimeout(1300);
    // slow software GL can lag the React/R3F resize by seconds: measure once the 3D layout matches this size and has settled
    await page.waitForFunction(([w, h]) => window.__bwmLayout?.w === w && window.__bwmLayout?.h === h, [w, h], { timeout: 15000 }).catch(() => {});
    // desktop: the live chat panel is open (right column) and must clear plates, last trick, controls, cards
    await syncChat(page, w);
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
    await syncChat(page, w);
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

/** Start screen: gear + sound share top/height/style; More options (also with House rules open) fits the viewport. */
if (!process.env.ONLY || process.env.ONLY === 'menus') {
  for (const [label, w, h, mobile] of [['iphone-safari-390x664', 390, 664, true], ['mac-1024x640', 1024, 640, false], ['desktop-1440x900', 1440, 900, false], ['phone-land-844x390', 844, 390, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, ...(mobile ? { userAgent: IOS } : {}) });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); } catch { /* */ } });
    await page.goto(`${web}/`); await page.getByTestId('more').waitFor(); await page.waitForTimeout(700);
    const m = [];
    const pair = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="more"]'), s = document.querySelector('[data-testid="sound-button"]');
      const a = g.getBoundingClientRect(), b = s.getBoundingClientRect(), ga = getComputedStyle(g), sa = getComputedStyle(s);
      return { gt: a.top, gh: a.height, gw: a.width, st: b.top, sh: b.height, sw: b.width, gap: b.left - a.right, gs: ga.boxShadow, ss: sa.boxShadow, gb: ga.backgroundColor, sb: sa.backgroundColor };
    });
    if (Math.abs(pair.gt - pair.st) > 1 || Math.abs(pair.gh - pair.sh) > 1 || Math.abs(pair.gw - pair.sw) > 1) m.push(`gear/sound not a matching pair ${JSON.stringify(pair)}`);
    if (pair.gap < 4 || pair.gap > 14) m.push(`gear/sound gap ${pair.gap}`);
    if (pair.gs !== pair.ss || pair.gb !== pair.sb) m.push('gear/sound styles differ');
    const fits = async (what) => {
      const r = await page.evaluate(() => { const e = document.querySelector('[data-testid="more-options"]').getBoundingClientRect(); return { top: e.top, bottom: e.bottom }; });
      if (r.top < -0.5 || r.bottom > h + 0.5) m.push(`More options ${what} runs off screen (${Math.round(r.top)}–${Math.round(r.bottom)} in ${h})`);
    };
    await page.getByTestId('more').click(); await page.waitForTimeout(600);
    await fits('sheet');
    await page.getByRole('button', { name: /House rules/ }).click(); await page.waitForTimeout(400);
    await fits('with House rules open');
    const scroll = await page.evaluate(() => { const b = document.querySelector('[data-testid="more-options"] .sheet-body'); const before = b.scrollTop; b.scrollTop = b.scrollHeight; const ok = b.scrollHeight <= b.clientHeight + 1 || b.scrollTop > before; const last = [...b.querySelectorAll('.sheet-h')].pop().getBoundingClientRect(); return { ok, lastBottom: last.bottom }; });
    if (!scroll.ok) m.push('House rules do not scroll inside the sheet');
    if (scroll.lastBottom > h + 0.5) m.push('Credits & licenses unreachable (below the viewport)');
    await page.screenshot({ path: `${out}/menus-more-options-${label}.png` });
    console.log(`${m.length ? '✗' : '✓'} menus ${label}${m.length ? ': ' + m.join('; ') : ''}`);
    m.forEach((x) => problems.push(`menus ${label}: ${x}`));
    await ctx.close();
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

// Bid panel with every coach section open (Why? + How to count books) + the attached bid tip: the tip's controls,
// the coach's Hide link and every bid button stay in the viewport and clickable (the coach body scrolls inside).
if (!process.env.ONLY || process.env.ONLY === 'bidcoach') {
  const page = await newPage('bidcoach', 1024, 614);
  await page.addInitScript(() => { try { localStorage.setItem('bwm.tips', JSON.stringify({ on: true, asked: true })); } catch { /* */ } });
  await page.goto(`${web}/`);
  await page.evaluate(() => { localStorage.removeItem('bwm.game'); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low', firstHandBidsItself: false })); });
  await page.goto(`${web}/?autostart=1&seed=layout-bidcoach`);
  for (let i = 0; i < 1500 && !(await page.locator('.bid-grid button').count()); i++) {
    const ok = page.locator('[data-testid="coach"]:not(.inline) [data-testid="coach-ok"]');
    if (await ok.count()) await ok.click({ timeout: 1000 }).catch(() => {});
    const see = page.getByRole('button', { name: 'See my cards' }); if (await see.count()) await see.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(60);
  }
  const why = page.locator('.bid-panel .bc-why');
  if ((await why.getAttribute('aria-expanded').catch(() => null)) === 'false') await why.click();
  await page.locator('.bid-panel .bc-how').click();
  for (const [label, w, h] of [['desktop-1024x614', 1024, 614], ['desktop-1440x900', 1440, 900], ['phone-390x664', 390, 664], ['landscape-844x390', 844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    const res = await page.evaluate(() => {
      const bad = [];
      const check = (el, name) => {
        if (!el) { bad.push(`${name} missing`); return; }
        const r = el.getBoundingClientRect();
        if (r.width === 0) { bad.push(`${name} hidden`); return; }
        if (r.top < 0 || r.left < 0 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) { bad.push(`${name} off-screen (${r.left.toFixed(0)},${r.top.toFixed(0)} → ${r.right.toFixed(0)},${r.bottom.toFixed(0)})`); return; }
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(el === hit || el.contains(hit))) bad.push(`${name} covered by ${hit?.className || hit?.tagName}`);
      };
      const tip = document.querySelector('.bid-panel .coach.inline');
      if (tip) { check(tip.querySelector('[data-testid="coach-ok"]'), 'tip OK'); check(tip.querySelector('[data-testid="coach-skip"]'), 'tip Not now'); check(tip.querySelector('[data-testid="coach-never"]'), 'tip tips-off'); }
      check(document.querySelector('.bid-panel .bc-why'), 'coach Hide');
      document.querySelectorAll('.bid-panel .bid-grid button').forEach((b) => check(b, `bid ${b.textContent}`));
      const how = document.querySelector('.bid-panel .bc-how-list');
      const pp = document.querySelector('.me > .bid-panel'); if (bad.length) bad.push([...document.querySelectorAll('.scorebug, .trump-strip')].map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().top) + '-' + Math.round(e.getBoundingClientRect().bottom)).join(' | ')); if (bad.length) bad.push(`panel mh=${pp.style.maxHeight} h=${pp.getBoundingClientRect().height} top=${pp.getBoundingClientRect().top} st=${pp.scrollTop} sh=${pp.scrollHeight} kids=${[...pp.children].map((c) => c.className.split(' ')[0] + ':' + Math.round(c.getBoundingClientRect().height)).join(',')}`);
      return { bad, tip: !!tip, how: !!how, open: document.querySelector('.bid-panel .bc-why')?.getAttribute('aria-expanded') };
    });
    await page.screenshot({ path: `${out}/bidcoach-${label}.png` });
    const m = res.bad.concat(res.how ? [] : ['How to count books not open'], res.open === 'true' ? [] : ['Why? breakdown not open']);
    console.log(`${m.length ? '✗' : '✓'} bid coach expanded ${label}${res.tip ? ' (with tip)' : ''}${m.length ? ': ' + m.join('; ') : ''}`);
    m.forEach((x) => problems.push(`bid coach ${label}: ${x}`));
  }
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
  await lobbyCheck(host);
  // AFK kick off: the host sits idle through the size sweep and would otherwise be replaced by a bot after 3 timeouts
  await host.locator('details.settings-panel > summary').click();
  await host.getByTestId('afk-limit').selectOption('0');
  await host.getByText('AFK kick off').first().waitFor({ timeout: 5000 }).catch(() => {});
  await host.getByTestId('start').click();
  await host.locator('.table-screen').waitFor({ timeout: 20000 });
  await host.waitForFunction(() => document.querySelector('.badge-layer [data-testid^="video-"][data-live="true"] video')?.videoWidth > 0, null, { timeout: 30000 }).catch(() => console.log('(remote video not live yet)'));
  for (let i = 0; i < 3000; i++) {
    if ((await legal(host).count()) && (await trickCount(host)) >= 2 && (await host.locator('[data-testid="last-trick"]').count())) break;
    for (const p of [host, guest]) await step(p);
    await host.waitForTimeout(40);
  }
  await host.waitForTimeout(800);
  // partner mic mute is a host option, off by default (not changed here): no limiting, no MIC LIMITED badge
  {
    const lim = await host.evaluate(() => window.__bwmVideo?.state.limited ?? []);
    const badge = await host.getByTestId('mic-limited').count();
    if (lim.length || badge) problems.push(`partner mic mute is off but limited=${JSON.stringify(lim)} badge=${badge}`);
    else console.log('✓ partner mic mute off by default: no limiting, no MIC LIMITED badge');
  }
  await sweepSizes(host, 'online');
  if (!only) await bannerCheck([host, guest], 'online', [SIZES[1], SIZES[2]]);
}

await browser.close();
if (errors.length) console.log('Browser errors:\n' + errors.join('\n'));
console.log(problems.length ? `${problems.length} layout problem(s)` : 'LAYOUT OK');
if (strict && (problems.length || errors.length)) process.exit(1);
