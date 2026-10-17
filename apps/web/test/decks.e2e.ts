/** Deck picker integration: each Desi deck renders its court art in the hand (390px screenshots per deck). */
import { makeRules, newGame, type Card, type GameState } from '@spades/rules';
import { webkit, type Browser } from 'playwright-core';
import { DEFAULT_SETTINGS } from '../src/settings';
import { DECKS } from '../src/decks';
import { pickHandCard, type HandHitCard } from '../src/three/handHit';
const SHOTS = process.env.BWM_SHOTS ?? '/opt/cursor/artifacts';
const COURTS = ['KS', 'QS', 'JS', 'KH', 'QH', 'JH', 'KD', 'QD', 'JD', 'KC', 'QC', 'JC', 'BJ'] as Card[];
type W = { __bwmHandHits: HandHitCard[]; __bwmDeck?: string };
function saveFor(deck: string): string {
  const dealt = newGame(makeRules('joker'), 'drag-13', { dealer: 3 });
  const rest = dealt.hands.flat().filter((c) => !COURTS.includes(c));
  const hands = [COURTS, rest.slice(0, 13), rest.slice(13, 26), rest.slice(26, 39)] as Card[][];
  const st: GameState = { ...dealt, hands, phase: 'playing', bids: [3, 3, 3, 3], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, winner: null, plays: [] }, spadesBroken: true, revealed: [true, true, true, true] };
  return JSON.stringify({ v: 1, savedAt: Date.now(), seed: st.seed, settings: { ...DEFAULT_SETTINGS, speed: 'slow', quality: 'low', botLevel: 'novice', deck }, state: st, chat: [], names: ['You', 'Big Mike', 'Omar', 'Sven'], teamNames: null });
}
(async () => {
  const b: Browser = await webkit.launch({ headless: true });
  try {
    for (const d of DECKS) {
      const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      page.setDefaultTimeout(30000);
      const artReqs: string[] = [];
      page.on('request', (r) => { if (r.url().includes(`/assets/decks/${d.id}/`)) artReqs.push(r.url()); });
      await page.addInitScript((raw) => { localStorage.setItem('bwm.game', raw); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); }, saveFor(d.id));
      await page.goto(process.env.BWM_URL ?? 'http://127.0.0.1:5173');
      await page.getByTestId('resume').click();
      await page.waitForFunction(() => ((window as unknown as W).__bwmHandHits ?? []).length === 13, undefined, { timeout: 45000 });
      await page.waitForTimeout(1500);
      const active = await page.evaluate(() => (window as unknown as W).__bwmDeck);
      if (active !== d.id) throw new Error(`${d.id}: active deck probe is ${active}`);
      if (!artReqs.length) throw new Error(`${d.id}: no deck art requested`);
      // VISUAL proof (not just requests): decode the actual screenshot in-page and sample the
      // visible strip of each court card. Deck art covers the whole face with a photo, while the
      // painted fallback is mostly cream — several cards must read as photo, not cream.
      const hits = await page.evaluate(() => (window as unknown as W).__bwmHandHits);
      const shotBuf = await page.screenshot({ path: `${SHOTS}/deck-${d.id}-390.png` });
      const points: Record<string, { x: number; y: number }[]> = {};
      for (const c of hits) {
        const xs = c.poly.map((pt) => pt.x), ys = c.poly.map((pt) => pt.y);
        const pts: { x: number; y: number }[] = [];
        for (let y = Math.min(...ys) + 4; y < Math.max(...ys) - 2 && pts.length < 40; y += 5)
          for (let x = Math.min(...xs) + 3; x < Math.max(...xs) - 2 && pts.length < 40; x += 5)
            if (pickHandCard(x, y, hits) === c.id) pts.push({ x, y });
        points[c.id] = pts;
      }
      const stats = await page.evaluate(async ({ b64, points: pts }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d')!; ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const out: Record<string, { n: number; photo: number }> = {};
        for (const [id, list] of Object.entries(pts)) {
          let n = 0, photo = 0;
          for (const pt of list as { x: number; y: number }[]) {
            const px = Math.round(pt.x * 2), py = Math.round(pt.y * 2); // deviceScaleFactor 2
            const i = (py * cv.width + px) * 4;
            const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
            const cream = r > 225 && g > 215 && b > 195 && Math.max(r, g, b) - Math.min(r, g, b) < 35;
            n++; if (!cream) photo++;
          }
          out[id] = { n, photo: n ? photo / n : 0 };
        }
        return out;
      }, { b64: shotBuf.toString('base64'), points });
      const photoCards = COURTS.filter((c) => (stats[c]?.photo ?? 0) > 0.45);
      console.log(`${d.id} visual: photo-face cards ${photoCards.length}/${COURTS.length}`, Object.fromEntries(COURTS.map((c) => [c, stats[c]?.photo?.toFixed(2)])));
      if (d.id !== 'classic' && photoCards.length < 4) throw new Error(`${d.id}: only ${photoCards.length} court cards visually show deck art (expected several; first-image-only redraw bug?)`);
      console.log(`${d.id} (${d.name}): ${artReqs.length} art files, screenshot saved`);
      await page.close();
    }
    console.log('decks OK');
  } finally { await b.close(); }
})();
