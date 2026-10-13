/**
 * iPhone-sized WebKit check for the sound-restore chip.
 * Usage: node scripts/ios-audio-check.mjs [base=http://127.0.0.1:5173]
 *
 * Headless WPE WebKit aborts the process inside HTMLAudioElement.play() of a real
 * buffer (mp3 or wav). The chip does not depend on that, so music stays off here.
 * A real iPhone still primes the music elements inside the gesture.
 */
import { webkit } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
mkdirSync('/tmp/ios-audio', { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, userAgent: UA });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('crash', () => errors.push('PAGE CRASH'));
await page.addInitScript(() => {
  localStorage.setItem('bwm.sound.v1', JSON.stringify({ on: true, volume: 0.7, ambient: false, music: false, musicVolume: 0.5, venueSound: false }));
  localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }));
});
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="sound-button"]').waitFor();

const unlocked = await page.evaluate(() => {
  const s = window.__bwmSound;
  window.dispatchEvent(new Event('touchstart'));
  window.dispatchEvent(new Event('pointerdown'));
  const ctx = s.audioContext();
  return { state: s.testState ?? ctx?.state ?? 'none', hasCtx: !!ctx };
});

const recreated = await page.evaluate(() => {
  const s = window.__bwmSound;
  const before = s.audioContext();
  s.testState = 'interrupted';
  window.dispatchEvent(new Event('pageshow'));
  const after = s.audioContext();
  return { same: before === after, state: after?.state ?? 'none', needs: s.getSnapshot().needsRestore };
});

await page.evaluate(() => {
  const s = window.__bwmSound;
  s.testState = 'suspended';
  document.dispatchEvent(new Event('visibilitychange'));
});
const chip = page.locator('[data-testid="restore-sound"]');
await chip.waitFor({ timeout: 5000 });
const box = await chip.boundingBox();
const layout = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  text: document.querySelector('[data-testid="restore-sound"]')?.textContent ?? '',
}));
await page.screenshot({ path: '/tmp/ios-audio/restore-390.png' });

await page.evaluate(() => { window.__bwmSound.testState = null; });
await chip.click();
await page.waitForTimeout(300);
const tapped = await page.evaluate(() => {
  const s = window.__bwmSound;
  return { state: s.audioContext()?.state ?? 'none', needs: s.getSnapshot().needsRestore };
});
// This WebKit build cannot start an audio device, so resume() stays suspended and the chip
// correctly stays up. A running context (what a real tap achieves on iPhone) hides it.
await page.evaluate(() => {
  window.__bwmSound.testState = 'running';
  window.dispatchEvent(new Event('pageshow'));
});
await chip.waitFor({ state: 'hidden', timeout: 3000 });
const afterTap = await page.evaluate(() => {
  const s = window.__bwmSound;
  return { chip: !!document.querySelector('[data-testid="restore-sound"]'), needs: s.getSnapshot().needsRestore, device: s.audioContext()?.state ?? 'none' };
});
afterTap.tapped = tapped;
await page.screenshot({ path: '/tmp/ios-audio/after-tap-390.png' });

const report = { unlocked, recreated, box, layout, afterTap, errors };
console.log(JSON.stringify(report, null, 2));
const fit = box && box.x >= 0 && box.x + box.width <= 390 + 1 && box.y >= 0 && box.y + box.height <= 844;
const ok = unlocked.hasCtx
  && recreated.same === false
  && layout.text.includes('Tap to restore sound')
  && layout.scrollWidth <= 390 + 1
  && fit
  && afterTap.chip === false
  && afterTap.needs === false
  && (afterTap.tapped.state === 'running' || afterTap.tapped.needs === true)
  && errors.length === 0;
await browser.close();
if (!ok) process.exit(1);
