/**
 * Recorded bot voices → the app: writes apps/web/src/voices/manifest.json (persona → raw line → clip stems) from the
 * generator's manifest (/workspace/bwm-voices/manifest.json; clips themselves live in apps/web/public/voices/<persona>/).
 * Also reports whether personas.ts changed since the clips were made (lines without a clip fall back to Web Speech).
 * Usage: node scripts/voices-manifest.mjs [path/to/manifest.json]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const src = JSON.parse(readFileSync(process.argv[2] ?? '/workspace/bwm-voices/manifest.json', 'utf8'));
const byId = new Map(src.clips.map((c) => [c.id, c]));
const stem = (id) => { const c = byId.get(id); return c ? c.files.webm.replace(/^clips\//, '').replace(/\.webm$/, '') : null; };
const lookup = {};
let n = 0, missing = 0;
for (const [persona, lines] of Object.entries(src.lookup)) {
  lookup[persona] = {};
  for (const [tpl, v] of Object.entries(lines)) {
    const s = stem(v.clip);
    if (!s || !existsSync(`apps/web/public/voices/${s}.webm`) || !existsSync(`apps/web/public/voices/${s}.m4a`)) { missing++; continue; }
    const c = v.clean ? stem(v.clean) : null;
    lookup[persona][tpl] = c ? [s, c] : [s];
    n++;
  }
}
const now = createHash('sha256').update(readFileSync('packages/bots/src/personas.ts')).digest('hex');
mkdirSync('apps/web/src/voices', { recursive: true });
writeFileSync('apps/web/src/voices/manifest.json', JSON.stringify({ model: 'Kokoro-82M (Apache-2.0)', source: src.source.sha256, lookup }));
console.log(`${n} lines with clips (${missing} missing files); personas.ts ${now === src.source.sha256 ? 'unchanged' : 'CHANGED since the clips were made: new/edited lines fall back to Web Speech'}`);
