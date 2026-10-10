/**
 * 'Run it!' capture: the button + first-time spotlight tip, the slam, the tornado (pull / swirl / fling) frame-exact
 * via fx.warp, the badge unlock, and a short recording. Uses scripts/runit-state.ts to build a guaranteed spot.
 * Usage: node scripts/runit-shots.mjs [web=http://localhost:4173] [fps=20]   (SHOTS_OUT, RUN_SIZE=WxH, RUN_REDUCE=1)
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const fps = Number(process.argv[3] ?? 20);
const out = process.env.SHOTS_OUT ?? 'screenshots/release-4';
mkdirSync(out, { recursive: true });
const [vw, vh] = (process.env.RUN_SIZE ?? '1280x720').split('x').map(Number);
const tag = process.env.RUN_SIZE ? `-${process.env.RUN_SIZE}` : '';
const save = execFileSync('npx', ['tsx', 'scripts/runit-state.ts', 'joker', process.env.RUN_CARDS ?? '3'], { encoding: 'utf8' });
const tmp = '/tmp/runit-frames';
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
const p = await (await b.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 600, hasTouch: vw < 600 })).newPage();
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(base);
await p.evaluate(({ save, reduce }) => {
  localStorage.clear();
  localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }));
  localStorage.setItem('bwm.game', save);
  if (reduce) localStorage.setItem('bwm.fx', JSON.stringify({ reduce: true, nuke: 'full' }));
}, { save, reduce: !!process.env.RUN_REDUCE });
await p.reload();
await p.evaluate(() => { window.__bwmSound?.setMuted?.(true); window.__bwmHoldRun = true; });
const btn = p.getByTestId('run-it');
await btn.waitFor({ timeout: 60000 });
await p.waitForTimeout(2500);
const tipShown = await p.getByTestId('run-it-tip').isVisible();
await p.screenshot({ path: `${out}/runit${tag}-button-tip.png` });
// dismiss the tip, then confirm the button is still there and tap it
if (tipShown) await p.getByRole('button', { name: 'Dismiss tip' }).click();
await p.evaluate(() => { window.__bwmFx.warp = -1; }); // hold the funnel until the slam has landed
await btn.click();
await p.waitForTimeout(2500); // the slam lands (real time)
await p.screenshot({ path: `${out}/runit${tag}-slam.png` });
const shot = async (path, t) => {
  await p.evaluate((t) => { window.__bwmFx.warp = t; document.getAnimations().forEach((a) => { a.pause(); a.currentTime = Math.max(0, t + 0.6) * 1000; }); }, t);
  await p.waitForTimeout(700);
  await p.screenshot({ path });
};
const strip = [['pull', 0.35], ['swirl', 0.9], ['funnel', 1.2], ['fling', 1.55]];
for (const [name, t] of strip) await shot(`${out}/runit${tag}-${name}.png`, t);
const total = tag ? 0 : Math.round(2.2 * fps);
for (let f = 0; f < total; f++) await shot(`${tmp}/f${String(f).padStart(4, '0')}.png`, -0.2 + f / fps);
await p.evaluate(() => { window.__bwmFx.warp = null; document.getAnimations().forEach((a) => a.play()); window.__bwmHoldRun = false; window.__bwmEndRun?.(); });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/runit${tag}-after.png` });
const state = await p.evaluate(() => ({
  badges: JSON.parse(localStorage.getItem('bwm.badges.v1') ?? 'null'),
  tip: JSON.parse(localStorage.getItem('bwm.runItTip.v1') ?? 'null'),
  hand: document.querySelectorAll('[data-testid="hand"] button').length,
  chat: [...document.querySelectorAll('.chat-line')].map((e) => e.textContent).filter((t) => /ran the board/.test(t ?? '')),
  layout: window.__bwmLayout ? { trick: window.__bwmLayout.trick.length, hand: window.__bwmLayout.hand.length } : null,
}));
console.log(JSON.stringify({ tipShown, ...state }));
await b.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...strip.flatMap(([n]) => ['-i', `${out}/runit${tag}-${n}.png`]),
  '-filter_complex', '[0]scale=640:-1[a];[1]scale=640:-1[b];[2]scale=640:-1[c];[3]scale=640:-1[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', `${out}/runit${tag}-strip.png`]);
if (total) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${tmp}/f%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${out}/runit-tornado.mp4`]);
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'RUNIT SHOTS OK');
