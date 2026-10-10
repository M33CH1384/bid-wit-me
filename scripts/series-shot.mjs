/**
 * Rematch series dropdown + team names + bot trash talk screenshots (desktop + phone).
 * Usage: npx tsx scripts/make-series.ts 5 > /tmp/series.json && node scripts/series-shot.mjs [web]
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const series = readFileSync('/tmp/series.json', 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'phone' ? 2 : 1 })).newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base);
  await p.evaluate((series) => {
    localStorage.clear();
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }));
    localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'low' }));
    localStorage.setItem('bwm.series.v1', series);
    localStorage.setItem('bwm.teamName', 'Spade Gods 🔥');
  }, series);
  await p.goto(`${base}/?autostart=1&seed=series-shot`);
  await p.getByTestId('series-chip').first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `screenshots/release-3/17a-series-scorebug-${tag}.png` });
  const chip = await p.getByTestId('series-chip').first().textContent();
  if (!/SERIES/.test(chip ?? '')) errors.push(`${tag}: chip text ${chip}`);
  await p.getByTestId('series-chip').first().click();
  await p.getByTestId('series-sheet').waitFor();
  await p.locator('[data-testid^="series-game-"] .sg-head').nth(1).click();
  await p.locator('[data-testid^="series-hands-"]').first().waitFor();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `screenshots/release-3/17b-series-dropdown-${tag}.png` });
  const r = await p.getByTestId('series-sheet').boundingBox();
  if (r && (r.y < 0 || r.y + r.height > h + 1)) errors.push(`${tag}: series sheet off screen ${JSON.stringify(r)}`);
  await p.keyboard.press('Escape');
  await p.locator('.series-sheet .modal-x').click();
  const scorebug = await p.locator('.bug-team.mine .bug-name').textContent();
  if (!/SPADE GODS/.test(scorebug ?? '')) errors.push(`${tag}: team name not in scorebug (${scorebug})`);
  console.log(`✓ ${tag}`, chip, scorebug);
  await p.close();
}
await b.close();
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'SERIES OK');
