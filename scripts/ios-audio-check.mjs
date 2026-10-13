/**
 * iPhone-sized WebKit check: a suspended context marks the header speaker, and tapping it
 * resumes or rebuilds (and primes music) with no extra button.
 * Usage: node scripts/ios-audio-check.mjs [base=http://127.0.0.1:5173]
 *
 * Headless WPE WebKit aborts inside HTMLAudioElement playback of a real buffer, so music
 * stays off. The speaker tap still rebuilds an interrupted context. Priming lives in
 * wake('gesture') → syncMusic(), covered by the engine source test.
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
const speaker = page.locator('[data-testid="sound-button"]');
await speaker.waitFor();

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
await page.waitForFunction(() => document.querySelector('[data-testid="sound-button"]')?.getAttribute('data-needs-tap') === 'true');
const box = await speaker.boundingBox();
const layout = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="sound-button"]');
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    label: btn?.getAttribute('aria-label') ?? '',
    needsTap: btn?.getAttribute('data-needs-tap') ?? '',
    className: btn?.className ?? '',
    chip: !!document.querySelector('[data-testid="restore-sound"]'),
    chipText: document.body.innerText.includes('Tap to restore sound'),
    buttons: document.querySelectorAll('button').length,
  };
});
await page.screenshot({ path: '/tmp/ios-audio/speaker-suspended-390.png' });

// Rebuild on the speaker tap while no media element is bound. Closing a context that owns
// a media-element source aborts this headless WebKit; a phone does not.
await page.evaluate(() => {
  const s = window.__bwmSound;
  window.__beforeCtx = s.audioContext();
  s.testState = 'interrupted';
});
await speaker.click();
const afterTap = await page.evaluate(() => {
  const s = window.__bwmSound;
  const btn = document.querySelector('[data-testid="sound-button"]');
  return {
    rebuilt: window.__beforeCtx !== s.audioContext(),
    chip: !!document.querySelector('[data-testid="restore-sound"]'),
    needs: s.getSnapshot().needsRestore,
    label: btn?.getAttribute('aria-label') ?? '',
  };
});
await page.evaluate(() => {
  window.__bwmSound.testState = 'running';
  window.dispatchEvent(new Event('pageshow'));
});
await page.waitForFunction(() => document.querySelector('[data-testid="sound-button"]')?.getAttribute('data-needs-tap') === 'false');
const cleared = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="sound-button"]');
  return { needsTap: btn?.getAttribute('data-needs-tap') ?? '', className: btn?.className ?? '', chip: !!document.querySelector('[data-testid="restore-sound"]') };
});

const report = { unlocked, recreated, box, layout, afterTap, cleared, errors };
console.log(JSON.stringify(report, null, 2));
const fit = box && box.x >= 0 && box.x + box.width <= 390 + 1 && box.y >= 0 && box.y + box.height <= 844;
const ok = unlocked.hasCtx
  && recreated.same === false
  && layout.needsTap === 'true'
  && layout.className.includes('needs-tap')
  && layout.label.includes('tap to restore')
  && layout.chip === false
  && layout.chipText === false
  && layout.scrollWidth <= 390 + 1
  && fit
  && afterTap.rebuilt === true
  && afterTap.chip === false
  && cleared.needsTap === 'false'
  && !cleared.className.includes('needs-tap')
  && cleared.chip === false
  && errors.length === 0;
await browser.close();
if (!ok) process.exit(1);
