/**
 * Install the v2 voice sprites (bwm-voices out-v2/) into the app: apps/web/public/voices/v2/, and drop the v1 per-clip
 * files. Usage: node scripts/voices-install.mjs [/workspace/bwm-voices/out-v2]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
const src = process.argv[2] ?? '/workspace/bwm-voices/out-v2';
const pub = 'apps/web/public/voices';
for (const e of existsSync(pub) ? readdirSync(pub) : []) if (e !== 'v2') rmSync(join(pub, e), { recursive: true, force: true });
rmSync(join(pub, 'v2'), { recursive: true, force: true });
mkdirSync(join(pub, 'v2'), { recursive: true });
let bytes = { webm: 0, m4a: 0, json: 0 }, n = 0;
for (const f of readdirSync(src)) {
  if (!/\.(webm|m4a|json)$/.test(f)) continue;
  cpSync(join(src, f), join(pub, 'v2', f));
  const ext = f.split('.').pop(); bytes[ext] += statSync(join(src, f)).size; n++;
}
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
console.log(`${n} files → ${pub}/v2 · webm ${mb(bytes.webm)} · m4a ${mb(bytes.m4a)} · json ${mb(bytes.json)} · total ${mb(bytes.webm + bytes.m4a + bytes.json)}`);
