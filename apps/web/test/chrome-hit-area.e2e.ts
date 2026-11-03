/**
 * Chrome hit-area with real hit-testing: Chromium iPhone (hasTouch), the
 * owner's landscape sizes, his measured safe-area insets (L/R 47, B 21) via
 * CDP Emulation.setSafeAreaInsetsOverride.
 *
 * Owner, 2026-11-03: at a landscape table "I can't hit the menu button at
 * the top left and the audio setting button is hard to hit as well." The
 * slant clip-path on both buttons clipped their hit area (the top-left and
 * bottom-right corner triangles were dead) and the chips were under 44px
 * (menu 36×38, speaker 40×40). The fix keeps the paint pixel-identical on a
 * ::before layer and gives each button an un-clipped hit box of at least
 * 44×44 (see chrome-hit-area.test.ts for the CSS pins).
 *
 * This spec drives a saved table (the rig evidence for the owner's exact
 * bidding state lives with the fix's capture runs) and asserts, in both
 * themes: elementFromPoint owns EVERY point of a 7×7 grid over each
 * button's 44×44 hit box, and a real touchscreen tap on the box's corner
 * opens the game menu / the Sound & music settings sheet.
 */
import { makeRules, newGame, type GameState } from '@spades/rules';
import { chromium, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const dealt = newGame(makeRules('joker'), 'chrome-hit-13', { dealer: 3 });
const st: GameState = { ...dealt, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
const save = JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, mode: 'joker', speed: 'turbo', blindNil: 'off', quality: 'high', venue: 'grandma', view: 'sitting' }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });

type Rect = { x: number; y: number; w: number; h: number };

async function open(b: Browser, w: number, h: number, theme: string): Promise<Page> {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(({ raw, theme }) => {
    localStorage.setItem('bwm.game', raw);
    localStorage.setItem('bwm.theme.v1', JSON.stringify({ theme }));
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
  }, { raw: save, theme });
  await page.goto(URL);
  // the owner's measured landscape safe-area insets
  const session = await ctx.newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 47, bottom: 21, left: 47 } }).catch(() => {});
  // clear the guest entry flow if it mounts (two sheets), then resume the save
  const deadline = Date.now() + 150000;
  let open = false;
  while (Date.now() < deadline) {
    for (const id of ['entry-guest', 'first-prefs-skip']) {
      const btn = page.getByTestId(id);
      if (await btn.count()) { await btn.tap().catch(() => {}); await page.waitForTimeout(600); }
    }
    if (await page.locator('.bwm-loading').count()) { await page.waitForTimeout(1500); continue; }
    if (await page.locator('.scorebug [data-testid="menu"]').count()) { open = true; break; }
    const resume = page.getByTestId('resume');
    if (await resume.count()) await resume.tap().catch(() => {});
    await page.waitForTimeout(2000);
  }
  if (!open) throw new Error('table chrome never appeared');
  await page.waitForFunction(() => !document.querySelector('.bwm-loading'), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return page;
}

/** 7×7 grid over the mandated 44×44 rect; every point must be owned by el. */
async function gridOwned(page: Page, testid: string): Promise<{ rect: Rect; hits: number }> {
  return page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) throw new Error(`missing ${tid}`);
    const r = el.getBoundingClientRect();
    const rect = { x: r.x, y: r.y, w: r.width, h: r.height };
    // the hit box itself must be at least 44×44
    if (rect.w < 44 || rect.h < 44) throw new Error(`${tid} hit box ${rect.w}×${rect.h} < 44`);
    let hits = 0;
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 7; gx++) {
      const x = rect.x + ((gx + 0.5) / 7) * rect.w;
      const y = rect.y + ((gy + 0.5) / 7) * rect.h;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) hits++;
    }
    return { rect, hits };
  }, testid);
}

async function cornerTap(page: Page, rect: Rect, dx: number, dy: number) {
  await page.touchscreen.tap(rect.x + dx, rect.y + dy);
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch(process.env.BWM_CHROME ? { executablePath: process.env.BWM_CHROME } : {});
  try {
    for (const theme of ['neon', 'classic']) {
      for (const [w, h] of [[932, 430], [844, 390]] as const) {
        const page = await open(browser, w, h, theme);
        try {
          for (const tid of ['menu', 'sound-button']) {
            const { rect, hits } = await gridOwned(page, tid);
            console.log(`${theme} ${w}×${h} ${tid}: box ${rect.w}×${rect.h} @${rect.x},${rect.y} grid ${hits}/49`);
            if (hits !== 49) throw new Error(`${tid}: only ${hits}/49 grid points owned`);
          }
          // real corner taps: menu TL corner opens the game menu
          const menu = await gridOwned(page, 'menu');
          await cornerTap(page, menu.rect, 1.5, 1.5);
          if (!(await page.locator('[data-testid="game-menu"]').count())) throw new Error('menu corner tap did not open the game menu');
          await page.touchscreen.tap(menu.rect.x + menu.rect.w / 2, menu.rect.y + menu.rect.h / 2);
          await page.waitForTimeout(400);
          // speaker TR corner opens the Settings sheet on Sound & music
          const sound = await gridOwned(page, 'sound-button');
          await cornerTap(page, sound.rect, sound.rect.w - 1.5, 1.5);
          if (!(await page.locator('[data-testid="more-options"]').count())) throw new Error('speaker corner tap did not open Sound & music');
        } finally {
          await page.context().close();
        }
      }
    }
    console.log('chrome-hit-area e2e: all cells pass');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
