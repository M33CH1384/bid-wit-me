/**
 * Phone-width WebKit check of the turn countdown ring.
 * Usage: node scripts/turn-ring-webkit.mjs [baseUrl]
 * Writes gold and red screenshots under screenshots/turn-ring/.
 */
import { webkit } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = 'screenshots/turn-ring';
mkdirSync(out, { recursive: true });

let vite = null;
if (!process.argv[2]) {
  vite = spawn('pnpm', ['--filter', '@spades/web', 'dev', '--port', '5173', '--strictPort', '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const started = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not start')), 30_000);
    const on = (buf) => {
      const text = buf.toString();
      if (text.includes('Local:') || text.includes('5173')) { clearTimeout(timer); resolve(); }
    };
    vite.stdout.on('data', on);
    vite.stderr.on('data', on);
    vite.on('exit', (code) => reject(new Error(`vite exited ${code}`)));
  });
  void started;
}

const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

async function shot(at) {
  await page.goto(`${base}/?preview=turn-ring&at=${at}`, { waitUntil: 'networkidle' });
  const ring = page.getByTestId('turn-ring');
  await ring.waitFor({ timeout: 10_000 });
  const box = await ring.boundingBox();
  if (!box || box.width < 40) throw new Error(`${at} ring is missing or tiny: ${JSON.stringify(box)}`);
  const data = await ring.evaluate((el) => ({
    color: el.getAttribute('data-color'),
    hot: el.getAttribute('data-hot'),
    fraction: Number(el.getAttribute('data-fraction')),
    count: document.querySelectorAll('[data-testid="turn-ring"]').length,
    width: window.innerWidth,
  }));
  if (data.width !== 390) throw new Error(`viewport is ${data.width}, expected 390`);
  if (data.count !== 1) throw new Error(`${at} expected one acting ring, saw ${data.count}`);
  await page.screenshot({ path: `${out}/${at}.png` });
  return data;
}

try {
  const gold = await shot('gold');
  if (gold.color !== '#f5c542' || gold.hot !== '0' || gold.fraction < 0.6) throw new Error(`gold ring unexpected: ${JSON.stringify(gold)}`);
  const red = await shot('red');
  if (red.hot !== '1' || red.color === '#f5c542' || red.fraction < 0.2 || red.fraction > 0.3) throw new Error(`red ring unexpected: ${JSON.stringify(red)}`);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('gold', gold);
  console.log('red', red);
  console.log(`✓ WebKit 390px ring screenshots in ${out}/`);
} finally {
  await browser.close();
  if (vite?.pid) {
    try { process.kill(-vite.pid, 'SIGTERM'); } catch { vite.kill('SIGTERM'); }
  }
}
