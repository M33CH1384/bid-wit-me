/**
 * Music overlap bug: several tracks at once. WebKit 390.
 * Across load, a gesture unlock, a refresh, a table visit and back Home, and a forced crossfade,
 * at most one deck is audible outside the crossfade itself (never more than two during it).
 */
import { webkit, type Page } from 'playwright-core';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
type Snd = { playingDeckCount(): number; musicStatus: string; decks: { el: HTMLAudioElement }[] };
const count = (p: Page) => p.evaluate(() => (window as unknown as { __bwmSound: Snd }).__bwmSound.playingDeckCount());
async function waitOne(p: Page, label: string): Promise<void> {
  await p.waitForFunction(() => (window as unknown as { __bwmSound: Snd }).__bwmSound.playingDeckCount() === 1, undefined, { timeout: 30000 }).catch(async () => {
    throw new Error(`${label}: music never settled to one deck (status ${await p.evaluate(() => (window as unknown as { __bwmSound: Snd }).__bwmSound.musicStatus)})`);
  });
}

(async () => {
  const b = await webkit.launch({ headless: true });
  const fails: string[] = [];
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto(URL);
    await p.waitForTimeout(1000);
    await p.mouse.click(195, 300); // unlock gesture
    await waitOne(p, 'home');
    console.log('home: 1 deck playing');
    await p.reload();
    await p.waitForTimeout(800);
    await p.mouse.click(195, 300);
    await waitOne(p, 'refresh');
    console.log('refresh: 1 deck playing');
    // go to a table and back (Save & quit): music is one deck throughout
    await p.goto(`${URL}/?autostart=1&seed=music-overlap`);
    await p.waitForSelector('.table-screen', { timeout: 45000 });
    await p.mouse.click(195, 300);
    await p.waitForTimeout(2500);
    const atTable = await count(p);
    await p.getByRole('button', { name: /menu/i }).first().click();
    await p.getByTestId('menu-leave').click();
    if (await p.getByTestId('confirm-leave').isVisible().catch(() => false)) await p.getByTestId('save-quit').click();
    await p.waitForFunction(() => !document.querySelector('.table-screen'), undefined, { timeout: 10000 });
    await p.waitForTimeout(1500);
    const backHome = await count(p);
    console.log(`table: ${atTable} deck(s), back home: ${backHome}`);
    if (atTable > 1) fails.push(`at the table: ${atTable} decks playing`);
    if (backHome > 1) fails.push(`back home: ${backHome} decks playing`);
    // forced crossfade: jump the active deck to its end and sample
    await waitOne(p, 'pre-crossfade');
    await p.evaluate(() => { const s = (window as unknown as { __bwmSound: Snd & { active: number } }).__bwmSound; const d = s.decks[s.active]!.el; d.currentTime = Math.max(0, d.duration - 0.2); });
    let max = 0;
    for (let i = 0; i < 40; i++) { max = Math.max(max, await count(p)); await p.waitForTimeout(100); }
    const settled = await count(p);
    console.log(`crossfade: max ${max} deck(s), settled ${settled}`);
    if (max > 2) fails.push(`crossfade: ${max} decks at once`);
    if (settled !== 1) fails.push(`after crossfade: ${settled} decks playing`);
    await p.close();
  } finally { await b.close(); }
  if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
