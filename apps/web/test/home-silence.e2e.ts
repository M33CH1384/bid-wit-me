/**
 * A game never keeps running behind Home (WebKit 390).
 * 1) Save & quit: the save stays (paused, silent) — no game sound, the saved state does not advance.
 * 2) Leave (quit): no save, no game sound, no timers firing game work.
 * 3) Fresh open with a saved game: Home is silent and the save does not advance.
 * 4) A mid-game refresh still lands back at the table (#150).
 * Also: a late game sound fired on Home (a stray timer) is refused by the table gate.
 */
import { webkit, type Page } from 'playwright-core';

const URL = process.env.BWM_URL ?? 'http://127.0.0.1:5173';
type Snd = { played: Record<string, number> };
const played = (p: Page) => p.evaluate(() => ({ ...((window as unknown as { __bwmSound?: Snd }).__bwmSound?.played ?? {}) }));
const saved = (p: Page) => p.evaluate(() => localStorage.getItem('bwm.game'));
const diff = (a: Record<string, number>, b: Record<string, number>) => Object.entries(b).filter(([k, v]) => v !== (a[k] ?? 0)).map(([k, v]) => `${k}+${v - (a[k] ?? 0)}`);

async function startGame(p: Page) {
  await p.goto(`${URL}/?autostart=1&seed=home-silence`);
  await p.waitForFunction(() => document.querySelector('.table-screen') !== null, undefined, { timeout: 45000 });
  await p.mouse.click(195, 400); // a gesture so audio unlocks, like a real player
  await p.waitForTimeout(5000);
}
async function openLeave(p: Page) {
  await p.getByRole('button', { name: /menu/i }).first().click();
  await p.getByTestId('menu-leave').click();
}

(async () => {
  const b = await webkit.launch({ headless: true });
  const fails: string[] = [];
  try {
    {
      const p = await b.newPage({ viewport: { width: 390, height: 844 } });
      await startGame(p);
      await p.reload();
      const back = await p.waitForSelector('.table-screen', { timeout: 45000 }).then(() => true, () => false);
      console.log(`refresh mid-game: back at the table=${back}`);
      if (!back) fails.push('mid-game refresh did not restore the game');
      await p.close();
    }
    for (const mode of ['save', 'quit'] as const) {
      const p = await b.newPage({ viewport: { width: 390, height: 844 } });
      await startGame(p);
      const atTable = await played(p);
      const n = Object.values(atTable).reduce((a, b) => a + b, 0);
      console.log(`${mode}: ${n} game sounds at the table`);
      if (!n) fails.push(`${mode}: no sound at the table, so the Home check proves nothing`);
      await openLeave(p);
      if (await p.getByTestId('confirm-leave').isVisible().catch(() => false)) {
        if (mode === 'save') await p.getByTestId('save-quit').click();
        else await p.getByRole('button', { name: 'Leave', exact: true }).click();
      } else if (mode === 'save') { fails.push('no Save & quit offered'); }
      await p.waitForFunction(() => !document.querySelector('.table-screen'), undefined, { timeout: 10000 });
      await p.waitForTimeout(400);
      const s0 = await played(p), g0 = await saved(p);
      await p.waitForTimeout(6000);
      const s1 = await played(p), g1 = await saved(p);
      const d = diff(s0, s1);
      console.log(`${mode}: home sounds ${d.join(' ') || 'none'}; save ${g0 ? 'kept' : 'none'}${g0 && g0 !== g1 ? ' (ADVANCED)' : ''}`);
      if (d.length) fails.push(`${mode}: sound played on Home: ${d.join(' ')}`);
      if (mode === 'save' && !g0) fails.push('save & quit lost the save');
      if (mode === 'save' && g0 !== g1) fails.push('saved game advanced behind Home');
      if (mode === 'quit' && (g0 || g1)) fails.push('quit left a saved game');
      const gate = await p.evaluate(() => {
        const s = (window as unknown as { __bwmSound: { atTable: boolean; play(n: string): void; played: Record<string, number> } }).__bwmSound;
        const before = s.played.deal ?? 0; s.play('deal'); s.play('sweep');
        return { atTable: s.atTable, leaked: (s.played.deal ?? 0) - before, marker: sessionStorage.getItem('bwm.inGame') };
      });
      console.log(`${mode}: gate atTable=${gate.atTable} late sound leaked=${gate.leaked} marker=${gate.marker}`);
      if (gate.atTable || gate.leaked) fails.push(`${mode}: a late game sound played on Home`);
      if (mode === 'quit' && gate.marker) fails.push('quit left the in-game marker');
      if (mode === 'save') {
        // 3) fresh open with that save: Home, silent, not advancing
        await p.reload();
        await p.waitForTimeout(800);
        await p.mouse.click(10, 10);
        const t0 = await played(p), h0 = await saved(p);
        await p.waitForTimeout(5000);
        const t1 = await played(p), h1 = await saved(p);
        const onHome = !(await p.locator('.table-screen').count());
        const dd = diff(t0, t1);
        console.log(`fresh open: on home=${onHome}, sounds ${dd.join(' ') || 'none'}, save ${h0 === h1 ? 'unchanged' : 'ADVANCED'}`);
        if (onHome && dd.length) fails.push(`fresh open: sound on Home ${dd.join(' ')}`);
        if (onHome && h0 !== h1) fails.push('fresh open: save advanced');
      }
      await p.close();
    }
  } finally { await b.close(); }
  if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
