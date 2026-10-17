/**
 * Voice Phase 3 bake planner (runs in GitHub Actions; no secrets).
 *   plan:  voice/queue.json + packages/bots/src/catalog.json → voice/bake-plan.json (lines still needing a clip)
 *   apply: voice/bake-plan.json + clips on disk → catalog.json gains every line whose clip now exists; the queue keeps
 *          only lines that were rejected or failed, so nothing is lost and nothing ships without its audio.
 * A clip id is sha256(voice | speed | normalized text), first 16 hex: the same text in the same voice is baked once.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONA_VOICES } from '../../packages/bots/src/voices';
import type { CatalogLine } from '../../packages/bots/src/catalog';
import type { PersonaId } from '../../packages/bots/src/personas';

export interface QueueLine { persona: string; g: string; bucket: string; text: string }
export interface PlanLine extends CatalogLine { voice: string; lang: 'en-us' | 'en-gb'; speed: number }
export interface Plan { lines: PlanLine[]; rejected: { line: QueueLine; reason: string }[] }

/** Most clips a single run bakes (a few hundred is one short job on a 4-vCPU runner). */
export const BAKE_MAX = 300;
const BUCKET = /^(set1|set2|set3|win|wheelsBid:\d{1,2}:\d{1,2}|wheelsUnder:\d{1,2}:\d{1,2})$/;

/** What gets spoken and hashed: NFC, no emoji, single spaces. Caps stay (energy is in the text). */
export function normalizeText(t: string): string {
  return t.normalize('NFC').replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '').replace(/\s+/g, ' ').trim();
}
export function clipId(voice: string, speed: number, text: string): string {
  return createHash('sha256').update(`${voice}|${speed}|${normalizeText(text)}`).digest('hex').slice(0, 16);
}

/** Why a queued line can't be baked, or null when it's fine. Catalog lines speak roles and numbers, never names. */
export function rejectReason(l: QueueLine): string | null {
  if (!(l.persona in PERSONA_VOICES)) return `unknown persona ${l.persona}`;
  if (l.g !== 'f' && l.g !== 'm') return `bad gender ${l.g}`;
  if (!BUCKET.test(l.bucket)) return `bad bucket ${l.bucket}`;
  const t = normalizeText(l.text ?? '');
  if (t.length < 3 || t.length > 140) return 'text length';
  if (/[{}<>]/.test(t)) return 'template or markup left in the text';
  if (/https?:|www\./i.test(t)) return 'link in the text';
  return null;
}

export function plan(queue: QueueLine[], catalog: readonly CatalogLine[], max = BAKE_MAX): Plan {
  const have = new Set(catalog.map((c) => c.id));
  const out: PlanLine[] = [];
  const rejected: Plan['rejected'] = [];
  for (const l of queue) {
    const why = rejectReason(l);
    if (why) { rejected.push({ line: l, reason: why }); continue; }
    const v = PERSONA_VOICES[l.persona as PersonaId][l.g as 'f' | 'm'];
    const text = normalizeText(l.text);
    const id = clipId(v.voice, v.speed, text);
    if (have.has(id)) continue;
    have.add(id);
    if (out.length >= max) continue; // stays queued for the next run
    out.push({ id, persona: l.persona as PersonaId, g: l.g as 'f' | 'm', bucket: l.bucket as CatalogLine['bucket'], text, voice: v.voice, lang: v.lang, speed: v.speed });
  }
  return { lines: out, rejected };
}

/** Catalog after a bake: every planned line whose clip exists (non-empty) joins, sorted by id for stable diffs. */
export function apply(catalog: readonly CatalogLine[], p: Plan, clipExists: (id: string) => boolean): { catalog: CatalogLine[]; added: string[]; missing: string[] } {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const added: string[] = [], missing: string[] = [];
  for (const l of p.lines) {
    if (!clipExists(l.id)) { missing.push(l.id); continue; }
    if (!byId.has(l.id)) added.push(l.id);
    byId.set(l.id, { id: l.id, persona: l.persona, g: l.g, bucket: l.bucket, text: l.text });
  }
  return { catalog: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), added, missing };
}

/** Queued lines whose clip is now in the catalog: these get marked 'baked' in D1 after a bake,
 * so the writer's queue drains instead of staying pending forever (and they are never re-baked:
 * plan() already skips catalog ids). */
export function bakedLines(queue: QueueLine[], catalog: readonly CatalogLine[]): QueueLine[] {
  const have = new Set(catalog.map((c) => c.id));
  return queue.filter((l) => {
    if (rejectReason(l)) return false;
    const v = PERSONA_VOICES[l.persona as PersonaId][l.g as 'f' | 'm'];
    return have.has(clipId(v.voice, v.speed, l.text));
  });
}

/** Queue after a bake: drop lines now in the catalog; keep the rest (over the cap or failed) for next time. */
export function remainingQueue(queue: QueueLine[], catalog: readonly CatalogLine[]): QueueLine[] {
  const have = new Set(catalog.map((c) => c.id));
  return queue.filter((l) => {
    if (rejectReason(l)) return false; // reported in the run summary, not retried
    const v = PERSONA_VOICES[l.persona as PersonaId][l.g as 'f' | 'm'];
    return !have.has(clipId(v.voice, v.speed, l.text));
  });
}

/* ---------- CLI ---------- */
const ROOT = join(import.meta.dirname, '../..');
export const PATHS = {
  queue: join(ROOT, 'voice/queue.json'),
  plan: join(ROOT, 'voice/bake-plan.json'),
  catalog: join(ROOT, 'packages/bots/src/catalog.json'),
  clips: join(ROOT, 'apps/web/public/voices/ai'),
};
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const cmd = process.argv[2];
  const queue = readJson<{ lines: QueueLine[] }>(PATHS.queue).lines;
  const cat = readJson<{ version: number; lines: CatalogLine[] }>(PATHS.catalog);
  if (cmd === 'plan') {
    const p = plan(queue, cat.lines);
    writeFileSync(PATHS.plan, JSON.stringify(p, null, 2) + '\n');
    console.log(`plan: ${p.lines.length} to bake, ${p.rejected.length} rejected, ${queue.length} queued, ${cat.lines.length} in catalog`);
    for (const r of p.rejected) console.log(`  rejected (${r.reason}): ${JSON.stringify(r.line)}`);
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `count=${p.lines.length}\n`, { flag: 'a' });
  } else if (cmd === 'apply') {
    const p = readJson<Plan>(PATHS.plan);
    const r = apply(cat.lines, p, (id) => { const f = join(PATHS.clips, `${id}.mp3`); return existsSync(f) && statSync(f).size > 1000; });
    writeFileSync(PATHS.catalog, JSON.stringify({ version: cat.version, lines: r.catalog }, null, 2) + '\n');
    writeFileSync(PATHS.queue, JSON.stringify({ version: 1, lines: remainingQueue(queue, r.catalog) }, null, 2) + '\n');
    console.log(`apply: ${r.added.length} added, ${r.missing.length} missing clips, catalog now ${r.catalog.length}`);
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `added=${r.added.length}\n`, { flag: 'a' });
  } else {
    console.error('usage: tsx scripts/voice-bake/plan.ts plan|apply');
    process.exit(2);
  }
}
