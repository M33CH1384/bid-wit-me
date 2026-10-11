/**
 * Online Cutthroat: you win solo → headline "YOU WIN" (not "YOU WINS"), and your winner card shows your name
 * ("Demetrius (you)"). Run it! from a near-target position ends the game. Needs the local Worker with TEST_HOOKS (8787)
 * and the preview (4173). Usage: node scripts/victory-cutthroat.mjs [web] [server]
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
const web = process.argv[2] ?? 'http://localhost:4173';
const server = process.argv[3] ?? 'http://127.0.0.1:8787';
const out = 'screenshots/release-7';
const save = JSON.parse(execFileSync('npx', ['tsx', 'scripts/runit-state.ts', 'cutthroat4', '3'], { encoding: 'utf8' }));
const st = save.state;
st.scores = st.scores.map((s, i) => (i === 0 ? st.rules.targetScore - 5 : Math.min(s, 50)));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ quality: 'low' })); });
await p.goto(`${web}/?server=${encodeURIComponent(server)}`);
await p.getByTestId('play-online').click();
await p.getByTestId('mode-cutthroat4').click();
await p.getByLabel('Your name').fill('Demetrius');
await p.getByTestId('create-table').click();
await p.getByTestId('lobby').waitFor({ timeout: 20000 });
const code = (await p.getByTestId('room-code').locator('b').innerText()).trim();
await p.getByTestId('start').click();
await p.locator('.table-screen').waitFor({ timeout: 20000 });
await p.waitForTimeout(1500);
const r = await fetch(`${server}/api/tables/${code}/test-state`, { method: 'POST', body: JSON.stringify(st) });
if (!r.ok) throw new Error(`test-state ${r.status}`);
await p.getByTestId('run-it').waitFor({ timeout: 60000 });
await p.waitForTimeout(800);
await p.getByTestId('run-it').tap({ force: true });
await p.getByTestId('victory-spot').waitFor({ timeout: 90000 });
await p.waitForTimeout(2000);
const v = await p.evaluate(() => ({
  title: document.querySelector('[data-testid="vs-title"]')?.textContent, shown: getComputedStyle(document.querySelector('[data-testid="vs-title"]')).textTransform,
  sub: document.querySelector('[data-testid="vs-sub"]')?.textContent ?? null, names: [...document.querySelectorAll('.vs-name')].map((e) => e.textContent),
}));
await p.screenshot({ path: `${out}/victory-cutthroat-you-win-390.png` });
const fails = [];
if (!/^you win$/i.test(v.title ?? '')) fails.push(`headline: ${v.title}`);
if (!v.names.includes('Demetrius (you)')) fails.push(`winner card: ${JSON.stringify(v.names)}`);
console.log(JSON.stringify(v));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
console.log(fails.length ? `FAIL: ${fails.join('; ')}` : 'CUTTHROAT VICTORY OK');
await b.close();
process.exit(fails.length || errors.length ? 1 : 0);
