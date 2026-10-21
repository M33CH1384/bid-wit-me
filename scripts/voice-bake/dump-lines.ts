/**
 * Dump the full recorded-voice worklist for the sprite bake (scripts/voice-bake/bake-sprites.py):
 * every clip every persona-gender sprite must contain, with the spoken take, voice and speed —
 * and, against the CURRENT manifests in apps/web/public/voices/v2, whether each clip is already
 * there ('have'), must be re-baked because the pronunciation dictionary changed its reading
 * ('rebake'), or is new ('new'). Usage: npx tsx scripts/voice-bake/dump-lines.ts [out.json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUSTLER_NEWBIE_SPEED, PERSONAS, PERSONA_VOICES, type PersonaId, speakableLines, spokenBidTake, spokenTake } from '@spades/bots';

const ROOT = join(import.meta.dirname, '../..');
const PUB = join(ROOT, 'apps/web/public/voices/v2');
/** dictionary sources whose espeak reading actually changes (nil→nill is IPA-identical: no re-bake) */
const REBAKE_RE = /\bmm-hm\b|\bchile\b|\btryna\b|\bqed\b|\bmm\b|'em\b|\bem\b/i;

export interface WorkClip { key: string; raw: string; kind: string; text: string; voice: string; lang: string; speed: number; state: 'have' | 'rebake' | 'new' }
export interface WorkSprite { key: string; persona: PersonaId; gender: 'f' | 'm'; voice: string; speed: number; clips: WorkClip[] }

const out: WorkSprite[] = [];
const counts = { have: 0, rebake: 0, new: 0 };
for (const id of Object.keys(PERSONAS) as PersonaId[]) {
  for (const g of ['f', 'm'] as const) {
    const key = `${id}-${g}`;
    const v = PERSONA_VOICES[id][g];
    const manifest = existsSync(join(PUB, `${key}.json`))
      ? (JSON.parse(readFileSync(join(PUB, `${key}.json`), 'utf8')) as { clips: Record<string, [number, number]> }).clips
      : {};
    const clips: WorkClip[] = [];
    const seen = new Set<string>();
    for (const l of speakableLines(id, g)) {
      if (l.raw === '…') continue; // the Silent Assassin's silence is text-only
      const speed = id === 'hustler' && (l.kind === 'newbie' || l.kind === 'reveal') ? HUSTLER_NEWBIE_SPEED : v.speed;
      const takes: { key: string; text: string }[] = [];
      const generic = spokenTake(l.raw, id);
      if (generic !== undefined) takes.push({ key: l.raw, text: generic });
      else for (let b = 1; b <= 13; b++) takes.push({ key: `${l.raw}#${b}`, text: spokenBidTake(l.raw, b) });
      for (const t of takes) {
        if (seen.has(t.key)) continue;
        seen.add(t.key);
        const state = !(t.key in manifest) ? 'new' : REBAKE_RE.test(l.raw) ? 'rebake' : 'have';
        counts[state]++;
        clips.push({ key: t.key, raw: l.raw, kind: l.kind, text: t.text, voice: v.voice, lang: v.lang, speed, state });
      }
    }
    out.push({ key, persona: id, gender: g, voice: v.voice, speed: v.speed, clips });
  }
}
const dst = process.argv[2] ?? join(ROOT, 'voice', 'worklist.json');
writeFileSync(dst, JSON.stringify({ sprites: out }, null, 1));
console.log(`${dst}: ${out.length} sprites · have ${counts.have} · rebake ${counts.rebake} · new ${counts.new} · total ${counts.have + counts.rebake + counts.new}`);
