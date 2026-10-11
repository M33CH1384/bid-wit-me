/**
 * Dump every line each persona can say (any intensity / condition) plus its Kokoro voices, for the voice generator in
 * /workspace/bwm-voices (scripts/generate_v2.py). Usage: npx tsx scripts/voice-lines.ts [out.json]
 */
import { writeFileSync } from 'node:fs';
import { HUSTLER_NEWBIE_SPEED, PERSONAS, PERSONA_VOICES, type PersonaId, speakableLines } from '@spades/bots';

const out = process.argv[2] ?? '/workspace/bwm-voices/lines-v2.json';
const personas = Object.fromEntries((Object.keys(PERSONAS) as PersonaId[]).map((id) => [id, {
  tag: PERSONAS[id].tag, tagF: PERSONAS[id].tagF ?? PERSONAS[id].tag, tagM: PERSONAS[id].tagM ?? PERSONAS[id].tag,
  caps: !!PERSONAS[id].caps, voices: PERSONA_VOICES[id], lines: speakableLines(id),
}]));
writeFileSync(out, JSON.stringify({ hustlerNewbieSpeed: HUSTLER_NEWBIE_SPEED, personas }, null, 1));
const n = Object.values(personas).reduce((s, p) => s + p.lines.length, 0);
console.log(`${out}: ${Object.keys(personas).length} personas, ${n} lines (x2 genders = ${n * 2} clips)`);
