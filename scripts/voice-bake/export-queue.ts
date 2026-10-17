/**
 * Voice (c): D1 -> voice/queue.json export for the nightly bake (plan.ts reads the file).
 * Merges 'pending' rows from the D1 `voice_queue` table into the repo queue, deduped by
 * (persona, g, bucket, normalized text). Needs CLOUDFLARE_API_TOKEN (Workers AI is not needed
 * here; D1 read is) + CLOUDFLARE_ACCOUNT_ID; without them it is a no-op with a warning, so a
 * fork/local run keeps working off the committed queue file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeText, type QueueLine } from './plan';

export interface D1Row { persona: string; g: string; bucket: string; text: string }
const key = (l: QueueLine) => `${l.persona}|${l.g}|${l.bucket}|${normalizeText(l.text).toLowerCase()}`;
/** Pure merge: exported rows not already queued (same identity), existing queue order kept. */
export function mergeQueue(existing: QueueLine[], rows: D1Row[]): QueueLine[] {
  const seen = new Set(existing.map(key));
  const out = [...existing];
  for (const r of rows) {
    const l: QueueLine = { persona: r.persona, g: r.g, bucket: r.bucket, text: r.text };
    if (seen.has(key(l))) continue;
    seen.add(key(l));
    out.push(l);
  }
  return out;
}

const ROOT = join(import.meta.dirname, '../..');
export const D1_DATABASE_ID = '31453fef-bbaa-444a-bd16-7c5c8cd62230'; // bid-wit-me (wrangler.toml)

export async function fetchQueueRows(accountId: string, token: string, dbId = D1_DATABASE_ID, fetchFn: typeof fetch = fetch): Promise<D1Row[]> {
  const r = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql: "SELECT persona, g, bucket, text FROM voice_queue WHERE status = 'pending' ORDER BY id LIMIT 1000" }),
  });
  const j = (await r.json()) as { success?: boolean; result?: { results?: D1Row[] }[]; errors?: { message?: string }[] };
  if (!r.ok || !j.success) throw new Error(`D1 export failed (${r.status}): ${j.errors?.[0]?.message ?? 'unknown'}`);
  return j.result?.[0]?.results ?? [];
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) { console.log('::warning::CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set: skipping D1 queue export (committed voice/queue.json stands)'); process.exit(0); }
  const path = join(ROOT, 'voice/queue.json');
  const cur = JSON.parse(readFileSync(path, 'utf8')) as { version: number; lines: QueueLine[] };
  const rows = await fetchQueueRows(account, token);
  const merged = mergeQueue(cur.lines, rows);
  writeFileSync(path, JSON.stringify({ version: 1, lines: merged }, null, 2) + '\n');
  console.log(`export: ${rows.length} pending in D1, queue ${cur.lines.length} -> ${merged.length}`);
}
