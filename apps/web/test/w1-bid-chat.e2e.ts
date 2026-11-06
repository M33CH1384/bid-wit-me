/**
 * W1 rendered-geometry rig (responsive audit 2026-11-05, Findings A + B).
 * Chromium emulation ONLY — no real-device claims.
 *
 * Drives a seeded bidding save (human bids last, partner already bid)
 * plus chat-open states across the owner's viewport matrix, and records
 * RENDERED geometry (getBoundingClientRect + elementFromPoint grids) as
 * JSON to $W1_OUT/<label>.json, with screenshots for the mandated cells.
 * Run it against a base tree (label=before) and the fixed tree
 * (label=after) with the same seeds; pass/fail is judged from the JSON,
 * never from CSS arithmetic.
 *
 * Env: BWM_URL (dev server), W1_OUT (output dir), W1_LABEL (before|after),
 * W1_CELLS (comma list of cell ids to run; default all). Results merge
 * into the label JSON after EVERY cell, so a crashed run loses at most
 * the cell in flight. One cell per process is the robust way to drive it
 * on a contended box.
 *
 * Rig notes (2026-11-05): a fresh load is covered by the Nov 4 boot
 * splash (data-testid="boot-splash") — it must be tapped before Resume;
 * the house chrome-hit-area rig predates it. The splash logo asset is
 * skip-worktree-absent in audit trees (404 img, button still works).
 */
import { makeRules, newGame, isTrump, type GameState } from '@spades/rules';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.W1_OUT ?? '/tmp/w1-rig';
const LABEL = process.env.W1_LABEL ?? 'after';
mkdirSync(OUT, { recursive: true });

function bidSave(): string {
  const rules = makeRules('joker', { firstHandBidsItself: false });
  for (let i = 0; i < 500; i++) {
    const dealt = newGame(rules, `w1-rig-${i}`, { dealer: 0 });
    if (dealt.phase === 'bidding' && dealt.hands[0]!.some((c) => isTrump(c, rules))) {
      const st: GameState = { ...dealt, turn: 0, bids: [null, 4, 5, 3] };
      return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, mode: 'joker', speed: 'turbo', quality: 'low', venue: 'classic', view: 'sitting' }, state: st, chat: [{ from: 'Queenie', text: 'gl everyone, long line to fill the panel width nicely', at: Date.now() }, { from: 'system', text: 'Hand 1 — bidding', at: Date.now() }], names: ['You', 'Leilani', 'Queenie', 'Elena'], teamNames: null });
    }
  }
  throw new Error('no suitable deal');
}
const SAVE = bidSave();

type Cell = Record<string, unknown>;

function persist(cells: Cell[]) {
  const path = `${OUT}/${LABEL}.json`;
  let prev: Cell[] = [];
  try { if (existsSync(path)) prev = JSON.parse(readFileSync(path, 'utf8')); } catch { prev = []; }
  const byName = new Map(prev.map((c) => [String(c.name), c]));
  for (const c of cells) byName.set(String(c.name), c);
  const merged = [...byName.values()];
  for (let i = 0; i < 5; i++) {
    try { writeFileSync(path, JSON.stringify(merged, null, 2)); return; } catch { /* fs flap — retry */ }
  }
  console.log(`WARN: could not persist ${path}`);
}

const ONLY = (process.env.W1_CELLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function openTable(b: Browser, w: number, h: number, theme: string, coachOn: boolean): Promise<Page> {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(({ raw, theme, coachOn }) => {
    localStorage.setItem('bwm.game', raw);
    localStorage.setItem('bwm.theme.v1', JSON.stringify({ theme }));
    localStorage.setItem('bwm.tips', JSON.stringify({ on: coachOn, asked: true, counts: {} }));
  }, { raw: SAVE, theme, coachOn });
  await page.goto(URL);
  const deadline = Date.now() + 240000;
  let ready = false;
  while (Date.now() < deadline) {
    // the boot splash (Nov 4) covers a fresh load whole-surface: begin first
    const splash = page.getByTestId('boot-splash');
    if (await splash.count()) { await splash.tap({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1800); continue; }
    for (const id of ['entry-guest', 'first-prefs-skip']) {
      const btn = page.getByTestId(id);
      if (await btn.count()) { await btn.tap().catch(() => {}); await page.waitForTimeout(500); }
    }
    if (await page.locator('.bid-grid button').count()) { ready = true; break; }
    if (await page.locator('.bwm-loading').count()) { await page.waitForTimeout(1200); continue; }
    const resume = page.getByTestId('resume');
    if (await resume.count()) await resume.tap().catch(() => {});
    await page.waitForTimeout(1500);
  }
  if (!ready) {
    const diag = await page.evaluate(() => ({ url: location.href, splash: !!document.querySelector('[data-testid="boot-splash"]'), resume: !!document.querySelector('[data-testid="resume"]'), loading: !!document.querySelector('.bwm-loading'), text: document.body.innerText.slice(0, 200).replace(/\n/g, ' | ') })).catch((e) => ({ err: String(e).slice(0, 120) }));
    await page.screenshot({ path: `/tmp/w1-diag-${w}x${h}-${theme}.png`, timeout: 20000 }).catch(() => {});
    throw new Error(`bid grid never appeared at ${w}x${h} ${theme} coach=${coachOn} diag=${JSON.stringify(diag)}`);
  }
  await page.waitForTimeout(1600);
  return page;
}

async function measureBid(page: Page): Promise<Cell> {
  return page.evaluate(() => {
    const panel = document.querySelector('.bid-panel')!;
    const pr = panel.getBoundingClientRect();
    const buttons = [...document.querySelectorAll<HTMLElement>('.bid-grid button')].map((el) => {
      const r = el.getBoundingClientRect();
      let hits = 0;
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 7; gx++) {
        const hit = document.elementFromPoint(r.x + ((gx + 0.5) / 7) * r.width, r.y + ((gy + 0.5) / 7) * r.height);
        if (hit && (hit === el || el.contains(hit))) hits++;
      }
      return { text: el.textContent, w: +r.width.toFixed(1), h: +r.height.toFixed(1), hits, cls: el.className, pressed: el.getAttribute('aria-pressed') };
    });
    const confirm = document.querySelector<HTMLElement>('[data-testid="bid-confirm"]');
    const cr = confirm?.getBoundingClientRect();
    return {
      panel: { x: +pr.x.toFixed(1), y: +pr.y.toFixed(1), w: +pr.width.toFixed(1), h: +pr.height.toFixed(1), scrollH: panel.scrollHeight, clientH: panel.clientHeight, tight: panel.classList.contains('tight'), withCoach: panel.classList.contains('with-coach'), maxHeight: (panel as HTMLElement).style.maxHeight },
      buttons,
      confirmRow: confirm ? { w: +cr!.width.toFixed(1), h: +cr!.height.toFixed(1), text: confirm.textContent, disabled: (confirm as HTMLButtonElement).disabled } : null,
    };
  });
}

async function measureChat(page: Page): Promise<Cell> {
  const toggle = page.locator('[data-testid="ctl-rail"] .chat-toggle');
  if (await toggle.count()) { await toggle.first().tap().catch(() => {}); await page.waitForTimeout(700); }
  return page.evaluate(() => {
    const chat = document.querySelector('.chat.open');
    if (!chat) return { open: false };
    const r = chat.getBoundingClientRect();
    const cs = getComputedStyle(chat);
    const probes: Record<string, unknown> = {};
    for (const [key, sel] of Object.entries({ liveDot: '.chat .live-dot', input: '.chat-input input', send: '.chat-input button', firstEmote: '.emotes button' })) {
      const el = document.querySelector(sel);
      if (!el) { probes[key] = null; continue; }
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      probes[key] = { x: +b.x.toFixed(1), w: +b.width.toFixed(1), owned: !!hit && (hit === el || el.contains(hit) || chat.contains(hit)) };
    }
    return {
      open: true, left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      computedRight: cs.right, computedWidth: cs.width,
      chatRightVar: getComputedStyle(document.querySelector('.table-screen')!).getPropertyValue('--chat-right').trim(),
      ...probes,
      scrollW: (chat as HTMLElement).scrollWidth, clientW: (chat as HTMLElement).clientWidth,
    };
  });
}

async function closeChat(page: Page) {
  const toggle = page.locator('[data-testid="ctl-rail"] .chat-toggle');
  if (await toggle.count()) { await toggle.first().tap().catch(() => {}); await page.waitForTimeout(400); }
}

async function launchWithRetry(): Promise<Browser> {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try { return await chromium.launch(process.env.BWM_CHROME ? { executablePath: process.env.BWM_CHROME } : {}); }
    catch (e) { last = e; console.log(`launch attempt ${i + 1} failed, retrying`); await new Promise((r) => setTimeout(r, 4000)); }
  }
  throw last;
}

(async () => {
  const browser = await launchWithRetry();
  const cells: Cell[] = [];
  const run = async (id: string, w: number, h: number, theme: string, coachOn: boolean, opts: { shot?: boolean; chat?: boolean; chatShot?: boolean; gate?: boolean; expandCoach?: boolean } = {}) => {
    if (ONLY.length && !ONLY.includes(id)) return;
    const name = `${theme}-${w}x${h}-coach${coachOn ? 'on' : 'off'}`;
    try {
      const page = await openTable(browser, w, h, theme, coachOn);
      const bid = await measureBid(page);
      const cell: Cell = { name, w, h, theme, coachOn, bid };
      if (opts.shot) await page.screenshot({ path: `${OUT}/${LABEL}-${name}-bid.png`, timeout: 90000 });
      if (opts.expandCoach) {
        const why = page.locator('.bc-why, .bid-coach button').first();
        if (await why.count()) { await why.tap().catch(() => {}); await page.waitForTimeout(600); cell.bidExpanded = await measureBid(page); }
        else cell.bidExpanded = 'no coach toggle found';
      }
      if (opts.chat) {
        cell.chat = await measureChat(page);
        if (opts.chatShot) await page.screenshot({ path: `${OUT}/${LABEL}-${theme}-${w}x${h}-chat.png`, timeout: 90000 });
        // S7: bid panel geometry while chat is open
        cell.bidWithChatOpen = await measureBid(page);
        await closeChat(page);
      }
      if (opts.gate) {
        // tap the "4" button (or first numeric); record whether a bid was submitted
        const before = await page.locator('.bid-grid button').count();
        const four = page.locator('.bid-grid button', { hasText: /^4$/ }).first();
        const target = (await four.count()) ? four : page.locator('.bid-grid button').nth(3);
        await target.tap().catch(() => {});
        await page.waitForTimeout(700);
        const afterTap = await page.evaluate(() => ({
          gridStillThere: !!document.querySelector('.bid-grid'),
          selectedText: document.querySelector('.bid-grid button.selected')?.textContent ?? null,
          confirmText: document.querySelector('[data-testid="bid-confirm"]')?.textContent ?? null,
          bidChip: document.querySelector('[data-testid="bid-0"]')?.textContent ?? null,
        }));
        cell.gateAfterTap = { buttonsBefore: before, ...afterTap };
        const confirm = page.getByTestId('bid-confirm');
        if (await confirm.count()) {
          await confirm.tap().catch(() => {});
          await page.waitForTimeout(900);
          cell.gateAfterConfirm = await page.evaluate(() => ({ gridStillThere: !!document.querySelector('.bid-grid'), bidChip: document.querySelector('[data-testid="bid-0"]')?.textContent ?? null }));
        }
      }
      cells.push(cell);
      persist(cells);
      console.log(`ok ${name}`);
    } catch (e) {
      cells.push({ name, w, h, theme, coachOn, error: String(e).slice(0, 300) });
      persist(cells);
      console.log(`FAIL ${name}: ${String(e).slice(0, 200)}`);
    } finally {
      // free the context (and its renderer) before the next cell
      try { for (const ctx of browser.contexts()) await ctx.close(); } catch { /* already gone */ }
    }
  };

  try {
    // bid matrix — classic full, neon spot cells
    await run('c320off', 320, 568, 'classic', false, { shot: true, chat: true, chatShot: true, gate: true });
    await run('c320on', 320, 568, 'classic', true, { shot: true });
    await run('c360', 360, 740, 'classic', false, { chat: true, chatShot: true });
    await run('c375', 375, 667, 'classic', false, { chat: true });
    await run('c390off', 390, 844, 'classic', false, { gate: true });
    await run('c390on', 390, 844, 'classic', true, { shot: true, expandCoach: true });
    await run('c430', 430, 932, 'classic', false, {});
    await run('l667', 667, 375, 'classic', false, {});
    await run('l844off', 844, 390, 'classic', false, { chat: true });
    await run('l844on', 844, 390, 'classic', true, {});
    await run('n320', 320, 568, 'neon', false, { shot: true, chat: true, chatShot: true });
    await run('n390off', 390, 844, 'neon', false, {});
    await run('n390on', 390, 844, 'neon', true, { shot: true });
    // rotation with chat open: 320 portrait -> landscape -> back
    if (!ONLY.length || ONLY.includes('rot')) {
      try {
        const page = await openTable(browser, 320, 568, 'classic', false);
        const chatP = await measureChat(page);
        await page.setViewportSize({ width: 568, height: 320 });
        await page.waitForTimeout(1200);
        const chatL = await page.evaluate(() => { const c = document.querySelector('.chat.open'); if (!c) return { open: false }; const r = c.getBoundingClientRect(); return { open: true, left: +r.left.toFixed(1), w: +r.width.toFixed(1) }; });
        await page.setViewportSize({ width: 320, height: 568 });
        await page.waitForTimeout(1200);
        const chatBack = await page.evaluate(() => { const c = document.querySelector('.chat.open'); if (!c) return { open: false }; const r = c.getBoundingClientRect(); return { open: true, left: +r.left.toFixed(1), w: +r.width.toFixed(1) }; });
        cells.push({ name: 'rotation-chat-open', chatPortrait: chatP, chatLandscape: chatL, chatBackPortrait: chatBack });
        persist(cells);
        console.log('ok rotation-chat-open');
      } catch (e) { cells.push({ name: 'rotation-chat-open', error: String(e).slice(0, 300) }); persist(cells); console.log(`FAIL rotation: ${String(e).slice(0, 160)}`); }
    }
    // recap chat guard at 320 (unaffected sheet) — reachable via hand recap only mid-game; geometry pinned in unit tests, here untested
    if (!ONLY.length || ONLY.includes('recap')) { cells.push({ name: 'recap-chat', note: 'untested in rig (needs a completed hand); CSS pin covers .recap-chat exclusion' }); persist(cells); }
  } finally {
    await browser.close();
  }
  persist(cells);
  console.log(`wrote ${OUT}/${LABEL}.json (${cells.length} cells this process)`);
})().catch((e) => { console.error(e); process.exit(1); });
