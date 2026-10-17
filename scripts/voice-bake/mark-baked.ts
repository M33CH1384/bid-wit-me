/**
 * Voice (c): after the bake, mark cataloged lines 'baked' in D1 so the writer queue drains.
 * Reads voice/queue.json + the just-updated catalog.json, finds lines whose clip is cataloged
 * (plan.ts bakedLines), and flips their D1 rows pending -> baked. No secrets = warning + no-op:
 * even then nothing re-bakes, because plan() skips ids the catalog already has.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakedLines, normalizeText, type QueueLine } from './plan';
import type { CatalogLine } from '../../packages/bots/src/catalog';
import { D1_DATABASE_ID } from './export-queue';

export interface BakedKey { persona: string; g: string; bucket: string; norm: string }
export const bakedKeys = (queue: QueueLine[], catalog: readonly CatalogLine[]): BakedKey[] =>
  bakedLines(queue, catalog).map((l) => ({ persona: l.persona, g: l.g, bucket: l.bucket, norm: normalizeText(l.text).toLowerCase() }));

export async function markBakedInD1(accountId: string, token: string, keys: BakedKey[], dbId = D1_DATABASE_ID, fetchFn: typeof fetch = fetch): Promise<number> {
  if (!keys.length) return 0;
  const where = keys.map(() => '(persona = ? AND g = ? AND bucket = ? AND norm = ?)').join(' OR ');
  const params = keys.flatMap((k) => [k.persona, k.g, k.bucket, k.norm]);
  const r = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql: `UPDATE voice_queue SET status = 'baked' WHERE status = 'pending' AND (${where})`, params }),
  });
  const j = (await r.json()) as { success?: boolean; errors?: { message?: string }[] };
  if (!r.ok || !j.success) throw new Error(`D1 mark-baked failed (${r.status}): ${j.errors?.[0]?.message ?? 'unknown'}`);
  return keys.length;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const ROOT = join(import.meta.dirname, '../..');
  const queue = (JSON.parse(readFileSync(join(ROOT, 'voice/queue.json'), 'utf8')) as { lines: QueueLine[] }).lines;
  const catalog = (JSON.parse(readFileSync(join(ROOT, 'packages/bots/src/catalog.json'), 'utf8')) as { lines: CatalogLine[] }).lines;
  const keys = bakedKeys(queue, catalog);
  if (!token || !account) { console.log(`::warning::no Cloudflare secrets: ${keys.length} baked line(s) stay 'pending' in D1 (harmless: plan skips cataloged ids, export dedupes)`); process.exit(0); }
  console.log(`mark-baked: ${await markBakedInD1(account, token, keys)} line(s) flipped to baked in D1`);
}
