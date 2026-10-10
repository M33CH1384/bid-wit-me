/**
 * Nuke v2 capture: 4-frame strip (flash, fireball, mushroom cloud, ash) + a ~4 s 1280x720 recording, frame-exact via
 * fx.warp (software GL is too slow for real-time capture). Output: screenshots/release-3/nuke-v2-*.png, nuke-v2-strip.png,
 * nuke-v2.mp4 / nuke-v2.webm. Usage: node scripts/nuke-shots.mjs [web=http://localhost:4173] [fps=30]
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const fps = Number(process.argv[3] ?? 30);
const out = process.env.SHOTS_OUT ?? 'screenshots/release-3';
mkdirSync(out, { recursive: true });
const tmp = '/tmp/nuke-frames';
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
// NUKE_SIZE=390x844 (phone portrait) etc.: stills at another aspect ratio, saved as nuke-v2-<size>-*.png (fps 0 = no video)
const [vw, vh] = (process.env.NUKE_SIZE ?? '1280x720').split('x').map(Number);
const tag = process.env.NUKE_SIZE ? `-${process.env.NUKE_SIZE}` : '';
const p = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true })); localStorage.setItem('spades.settings.v2', JSON.stringify({ mode: 'joker', speed: 'fast', quality: 'high' })); });
await p.goto(`${base}/?autostart=1&seed=nuke-shot`);
// get a few cards on the table: play whatever is legal when it's our turn
for (let i = 0; i < 40; i++) {
  const n = await p.evaluate(() => window.__bwmLayout?.trick?.length ?? 0);
  if (n >= 2) break;
  await p.evaluate(() => {
    const L = window.__bwmLayout; if (!L) return;
    const hand = L.hand ?? [];
    const top = Math.min(...hand.map((h) => h.y));
    const lifted = hand.filter((h) => h.y <= top + 2);
    const pick = lifted[Math.floor(lifted.length / 2)];
    if (pick) document.elementFromPoint(pick.x + pick.w / 2, pick.y + 20)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  if (i % 3 === 0) { const h = await p.evaluate(() => window.__bwmLayout?.hand ?? []); const c = h[Math.floor(h.length / 2)]; if (c) { await p.mouse.click(c.x + c.w / 2, c.y + 30); await p.waitForTimeout(300); await p.mouse.click(c.x + c.w / 2, c.y + 30); } }
  await p.waitForTimeout(700);
}
await p.evaluate(() => { window.__bwmSound?.setMuted?.(true); });
const shot = async (path, t) => {
  await p.evaluate((t) => { window.__bwmFx.warp = t; document.getAnimations().forEach((a) => { a.pause(); a.currentTime = (a.animationName === 'nuke-blow' ? Math.max(0, t - 0.3) : t) * 1000; }); }, t);
  await p.waitForFunction((t) => window.__bwmNukeT === t, t, { timeout: 15000 }).catch(() => console.log('frame wait timed out at', t));
  await p.waitForTimeout(250);
  await p.screenshot({ path });
};
await p.evaluate(() => { window.__bwmFx.warp = 0; window.__bwmFx.emit('nuke', { silent: true }); });
await p.waitForTimeout(500); // blast impulse + effect mounted
const strip = [['flash', 0.36], ['fireball', 0.75], ['mushroom', 1.9], ['ash', 3.0]];
for (const [name, t] of strip) await shot(`${out}/nuke-v2${tag}-${name}.png`, t);
const total = Math.round(4.0 * fps);
for (let f = 0; f < total; f++) await shot(`${tmp}/f${String(f).padStart(4, '0')}.png`, f / fps);
await p.evaluate(() => { window.__bwmFx.warp = null; document.getAnimations().forEach((a) => a.play()); });
await b.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${out}/nuke-v2${tag}-flash.png`, '-i', `${out}/nuke-v2${tag}-fireball.png`, '-i', `${out}/nuke-v2${tag}-mushroom.png`, '-i', `${out}/nuke-v2${tag}-ash.png`,
  '-filter_complex', '[0]scale=640:-1[a];[1]scale=640:-1[b];[2]scale=640:-1[c];[3]scale=640:-1[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', `${out}/nuke-v2${tag}-strip.png`]);
if (total) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${tmp}/f%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${out}/nuke-v2.mp4`]);
if (total) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${tmp}/f%04d.png`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', `${out}/nuke-v2.webm`]);
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'NUKE SHOTS OK');
