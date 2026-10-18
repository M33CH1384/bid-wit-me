/**
 * Bid summary, browser-level (WebKit 390x844): on the human's bid turn the bid panel
 * shows every bid so far in order, partner largest/gold and readable, without covering
 * the hand or colliding with the YOU plate / view chips. Saves the PR screenshot when
 * BWM_SHOTS is set (docs/bid-summary-390.png in the PR workflow).
 */
import { isTrump, makeRules, newGame, type GameState } from '@spades/rules';
import { webkit } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';

function save(): string {
  const rules = makeRules('joker', { firstHandBidsItself: false });
  for (let i = 0; i < 500; i++) {
    const dealt = newGame(rules, `bid-summary-e2e-${i}`, { dealer: 0 });
    // dealer 0: team bid order [1,3,2,0] — human bids last, partner (seat 2) already bid 5.
    // A spade in hand keeps the Call-misdeal button out of this screenshot.
    if (dealt.phase === 'bidding' && dealt.hands[0]!.some((c) => isTrump(c, rules))) {
      const st: GameState = { ...dealt, turn: 0, bids: [null, 4, 5, 3] };
      return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'turbo', quality: 'low', botLevel: 'novice', venue: 'classic' }, state: st, chat: [], names: ['You', 'Leilani', 'Queenie', 'Elena'], teamNames: null });
    }
  }
  throw new Error('no suitable deal found');
}

(async () => {
  const b = await webkit.launch({ headless: true });
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(30000);
    await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, save());
    await page.goto(URL);
    await page.getByTestId('resume').click();
    const summary = page.getByTestId('bid-summary');
    await summary.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => ((window as unknown as { __bwmHandHits?: unknown[] }).__bwmHandHits ?? []).length >= 10, undefined, { timeout: 30000 });
    await page.waitForTimeout(700);

    const chips = await page.evaluate(() => [...document.querySelectorAll('.bid-summary > .bs-seat')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute('data-testid'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: e.textContent }; }));
    console.log('summary chips:', JSON.stringify(chips)); console.log('summary count:', await page.getByTestId('bid-summary').count(), await page.evaluate(() => [...document.querySelectorAll('[data-testid="bid-summary"]')].map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} parent=${e.parentElement?.className}`; }))); console.log('summary style:', await summary.evaluate((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), wrap: cs.flexWrap, display: cs.display }; }));
    if (chips.length !== 4) throw new Error(`summary shows ${chips.length} seats, want 4`);
    const s0 = await summary.boundingBox();
    for (const c of chips) if (!s0 || c.x < s0.x - 1 || c.x + c.w > s0.x + s0.width + 1) throw new Error(`chip ${c.id} clipped outside summary`);
    const partner = page.getByTestId('bid-summary-2');
    const partnerText = await partner.textContent();
    if (!partnerText?.includes('PARTNER') || !partnerText.includes('Queenie') || !partnerText.includes('5')) throw new Error(`partner chip unreadable: ${partnerText}`);
    const fontSize = await partner.locator('b').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (fontSize < 20) throw new Error(`partner bid font ${fontSize}px, want >=20px`);
    console.log(`✓ partner bid readable in summary: "${partnerText}" at ${fontSize}px`);

    // geometry: summary sits inside the bid panel, above the hand, clear of the YOU plate
    const sBox = await summary.boundingBox();
    const plate = await page.getByTestId('seat-0').boundingBox();
    const handTop = await page.evaluate(() => Math.min(...((window as unknown as { __bwmHandHits: { poly: { y: number }[] }[] }).__bwmHandHits).flatMap((c) => c.poly.map((p) => p.y))));
    if (!sBox || !plate) throw new Error('missing boxes');
    if (sBox.y + sBox.height > handTop + 4) throw new Error(`summary bottom ${sBox.y + sBox.height} covers hand top ${handTop}`);
    const overlapsPlate = sBox.x < plate.x + plate.width && sBox.x + sBox.width > plate.x && sBox.y < plate.y + plate.height && sBox.y + sBox.height > plate.y;
    if (overlapsPlate) throw new Error('summary overlaps YOU plate');
    console.log(`✓ summary above hand (bottom ${Math.round(sBox.y + sBox.height)} <= hand top ${Math.round(handTop)}), no YOU-plate overlap`);

    await page.screenshot({ path: `${SHOTS}/bid-summary-390.png` });
    console.log('bid-summary OK');
  } finally { await b.close(); }
})();
