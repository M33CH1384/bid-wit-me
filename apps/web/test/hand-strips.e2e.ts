/**
 * A raised card, and a lifted suit, used to cover the neighbour once the hand
 * grew past four cards. Every DOM card keeps a visible hit strip at 390px,
 * before and after a reload. The first tap raises and does not play.
 */
import { makeRules, newGame, type Card, type GameState } from '@spades/rules';
import { writeFileSync } from 'node:fs';
import { chromium, webkit, type Browser, type Page } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { phoneHandFan, stripFloorPx } from '../src/three/layout';
import { visibleStripPx, type HandHitCard } from '../src/three/handHit';
import { rectHitsCards } from '../src/archSpot';

const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

function saveFor(count: number): string {
  const rules = makeRules('joker');
  const dealt = newGame(rules, `strips-${count}`, { dealer: 3 });
  const all = dealt.hands.flat();
  if (all.length < count + 3) throw new Error(`deck ${all.length} cannot hold a hand of ${count}`);
  const mine = all.slice(0, count);
  const rest = all.slice(count);
  const hands: Card[][] = [mine, [], [], []];
  rest.forEach((c, i) => hands[(i % 3) + 1]!.push(c));
  // 13 cards: a heart is already led, so that suit lifts and the rest stay down.
  let trick: GameState['trick'] = { leader: 0, winner: null, plays: [] };
  if (count === 13) {
    const suit = mine.find((c) => mine.filter((x) => x.slice(-1) === c.slice(-1)).length >= 2 && mine.some((x) => x.slice(-1) !== c.slice(-1)));
    const leadSuit = suit?.slice(-1);
    const lead = leadSuit ? rest.find((c) => c.endsWith(leadSuit)) : undefined;
    if (lead) {
      const seat = hands.findIndex((h, i) => i > 0 && h.includes(lead));
      if (seat > 0) {
        hands[seat] = hands[seat]!.filter((c) => c !== lead);
        trick = { leader: seat, winner: null, plays: [{ seat, card: lead }] };
      }
    }
  }
  const st: GameState = {
    ...dealt,
    phase: 'playing',
    bids: [3, 3, 3, 3],
    hands,
    tricks: [],
    tricksWon: [0, 0, 0, 0],
    turn: 0,
    trick,
    spadesBroken: true,
    revealed: [true, true, true, true],
  };
  return JSON.stringify({
    v: 1,
    savedAt: Date.now(),
    seed: st.seed,
    settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: 'novice' },
    state: st,
    chat: [],
    names: ['You', 'Big Mike', 'Omar', 'Sven'],
    teamNames: ['YOU + OMAR', 'BIG WHISPERERS'],
  });
}

async function chromiumBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
}

async function strips(page: Page): Promise<{ id: string; px: number }[]> {
  const hits = await page.evaluate(() => (window as unknown as { __bwmHandHits?: HandHitCard[] }).__bwmHandHits ?? []);
  return hits.map((h) => ({ id: h.id, px: visibleStripPx(hits, h.id) }));
}

async function ready(page: Page, count: number): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 45000 });
  await page.waitForFunction((n) => {
    const screen = document.querySelector('.table-screen');
    const hits = (window as unknown as { __bwmHandHits?: { id: string }[] }).__bwmHandHits;
    const dom = document.querySelectorAll('[data-testid^="card-"]').length;
    return !!screen && !screen.hasAttribute('inert') && !!hits && hits.length === n && dom === n;
  }, count, { timeout: 45000 });
}

async function expectStrips(page: Page, count: number, label: string): Promise<void> {
  const floor = stripFloorPx(count, 390, phoneHandFan().edgeFrac ?? 0.018);
  const rows = await strips(page);
  if (rows.length !== count) throw new Error(`${label}: ${rows.length} hit cards, expected ${count}`);
  const dom = await page.locator('[data-testid^="card-"]').count();
  if (dom !== count) throw new Error(`${label}: ${dom} DOM cards, expected ${count}`);
  const short = rows.filter((r) => r.px < floor - 1.5);
  if (short.length) {
    throw new Error(`${label}: ${short.map((r) => `${r.id}:${r.px.toFixed(1)}`).join(' ')} under ${floor.toFixed(1)}px`);
  }
  console.log(label, 'strips', rows.map((r) => r.px.toFixed(0)).join(','));
}

async function runCase(browser: Browser, base: string): Promise<void> {
  const edge = phoneHandFan().edgeFrac ?? 0.018;
  for (const count of [6, 8, 13, 17]) {
    const save = saveFor(count);
    writeFileSync(`/tmp/hand-strips-${count}.json`, save);
    const page = await browser.newPage(IPHONE);
    page.setDefaultTimeout(20000);
    await page.addInitScript((raw) => {
      localStorage.setItem('bwm.game', raw);
      localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
      localStorage.setItem('bwm.runItTip.v1', JSON.stringify({ shown: 9, used: true }));
    }, save);
    try {
      await page.goto(base);
      await page.getByTestId('resume').click();
      await ready(page, count);
      await expectStrips(page, count, `${count} before reload`);
      await page.reload();
      // #150: a refresh at the table goes straight back into the game
      const resume = page.getByTestId('resume');
      if (await resume.isVisible({ timeout: 1500 }).catch(() => false)) await resume.click();
      await ready(page, count);
      await expectStrips(page, count, `${count} after reload`);
      if (count === 8) {
        const hits = await page.evaluate(() => (window as unknown as { __bwmHandHits?: HandHitCard[] }).__bwmHandHits ?? []);
        const id = hits[3]!.id;
        const card = hits.find((h) => h.id === id)!;
        const xs = card.poly.map((p) => p.x);
        const ys = card.poly.map((p) => p.y);
        const y = (Math.min(...ys) + Math.max(...ys)) / 2;
        let x = (Math.min(...xs) + Math.max(...xs)) / 2;
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        for (let s = 0; s <= 40; s++) {
          const px = x0 + ((x1 - x0) * s) / 40;
          let best: { id: string; order: number } | null = null;
          for (const h of hits) {
            let inn = false;
            for (let i = 0, j = h.poly.length - 1; i < h.poly.length; j = i++) {
              const a = h.poly[i]!;
              const b = h.poly[j]!;
              if ((a.y > y) !== (b.y > y) && px < a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)) inn = !inn;
            }
            if (inn && (!best || h.order > best.order)) best = h;
          }
          if (best?.id === id) { x = px; break; }
        }
        const box = await page.locator('.table-canvas canvas').boundingBox();
        if (!box) throw new Error('canvas missing');
        await page.mouse.click(box.x + x, box.y + y);
        try {
          await page.waitForFunction((cardId) => document.querySelector(`[data-testid="card-${cardId}"]`)?.getAttribute('aria-pressed') === 'true', id);
        } catch {
          const pressed = await page.locator('[data-testid^="card-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-testid')}:${e.getAttribute('aria-pressed')}`));
          throw new Error(`first tap on ${id} pressed ${pressed.filter((p) => p.endsWith('true')).join(' ') || 'nothing'}`);
        }
        const trick = await page.getByTestId('hand').getAttribute('data-trick-count');
        if (trick !== '0') throw new Error(`first tap played ${id} (trick ${trick})`);
        if (await page.getByTestId(`card-${id}`).count() !== 1) throw new Error(`first tap removed ${id}`);
        await expectStrips(page, count, '8 with a card raised');
        await page.screenshot({ path: '/opt/cursor/artifacts/hand-strips-raised-390.png' });
      }
      if (count === 13) {
        // YOUR TURN and the plate sit in the arch under the fan, readable and off every card
        await page.waitForFunction(() => { const b = document.querySelector('.me-plate')?.getBoundingClientRect(); return !!b && b.left <= 16 && b.bottom >= window.innerHeight - 60; });
        const hits = await page.evaluate(() => (window as unknown as { __bwmHandHits?: HandHitCard[] }).__bwmHandHits ?? []);
        const r = await page.evaluate(() => { const b = document.querySelector('.me-plate')!.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, pe: getComputedStyle(document.querySelector('.me-plate')!).pointerEvents }; });
        if (r.pe !== 'none') throw new Error('plate takes pointer events');
        if (rectHitsCards(r, hits)) throw new Error(`plate covers a card ${JSON.stringify(r)}`);
        if (!(await page.locator('.me-plate .plate-turn').isVisible())) throw new Error('YOUR TURN not visible');
      }
      if (count === 13) await page.screenshot({ path: '/opt/cursor/artifacts/hand-strips-13-390.png' });
      console.log(count, 'floor', stripFloorPx(count, 390, edge).toFixed(1));
    } catch (err) {
      await page.screenshot({ path: `/opt/cursor/artifacts/hand-strips-${count}-fail.png` }).catch(() => undefined);
      throw err;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  const base = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
  let webkitError: unknown;
  if (process.env.BWM_BROWSER !== 'chromium') {
    try {
      const browser = await webkit.launch({ headless: true });
      try {
        console.log('browser webkit');
        await runCase(browser, base);
        return;
      } finally {
        await browser.close().catch(() => undefined);
      }
    } catch (err) {
      webkitError = err;
      console.log('webkit crashed, using chromium', err instanceof Error ? err.message : err);
    }
  }
  const browser = await chromiumBrowser();
  try {
    console.log('browser chromium-iphone');
    await runCase(browser, base);
  } catch (err) {
    if (webkitError) console.error('webkit had failed first:', webkitError);
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
