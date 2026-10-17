/**
 * Voice (c) line writer (docs/voice-phase2-design.md). Off the game path: the table Durable Object
 * calls this in waitUntil when a persona's catalog bucket for a moment is thin. A generated line is
 * validated and stored as TEXT ONLY in D1 (`voice_queue`); nobody hears it until the nightly bake
 * voices it into the catalog. Workers AI / validation / budget failures leave the canned line alone.
 */
export const WRITER_MODEL = '@cf/meta/llama-3.2-1b-instruct';
/** Hard stop: 8,000 of the free 10,000 neurons/day (reset 00:00 UTC). */
export const NEURON_DAILY_STOP = 8_000;
/** Neurons per million tokens for the writer model (Cloudflare pricing, checked 2026-10-16). */
export const NEURON_RATES = { inputPerM: 2457, outputPerM: 18252 };
/** Output tokens reserved per call when estimating cost before spending. */
export const WRITER_MAX_OUTPUT_TOKENS = 48;
/** A bucket with fewer fresh lines than this is "thin" and worth one writer call. */
export const BUCKET_THIN = 2;

export interface WorkersAiLike {
  run(model: string, input: { messages: { role: string; content: string }[]; max_tokens?: number }): Promise<{ response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }>;
}

export interface WriterRequest {
  persona: string;
  g: 'f' | 'm';
  bucket: string;
  /** seat names that must never appear in a catalog line (lines speak roles, not names) */
  forbiddenNames?: string[];
  /** lines already in this bucket (catalog + queued), for the similarity check */
  existingTexts?: string[];
}

export interface QueueStore {
  budgetDay(day: string): Promise<number>;
  addBudget(day: string, neurons: number): Promise<void>;
  queuedCount(persona: string, g: string, bucket: string): Promise<number>;
  queuedTexts(persona: string, g: string, bucket: string): Promise<string[]>;
  enqueue(l: { persona: string; g: string; bucket: string; text: string; norm: string; at: number }): Promise<boolean>;
  /** The bake cataloged these lines: pending -> baked so the queue drains. Returns rows changed. */
  markBaked(keys: { persona: string; g: string; bucket: string; norm: string }[]): Promise<number>;
}

/** D1-backed store (the same `bid-wit-me` database as accounts/social). */
export class D1QueueStore implements QueueStore {
  constructor(private db: D1Database) {}
  async budgetDay(day: string): Promise<number> {
    const r = await this.db.prepare('SELECT neurons FROM voice_writer_budget WHERE day = ?').bind(day).first<{ neurons: number }>();
    return r?.neurons ?? 0;
  }
  async addBudget(day: string, neurons: number): Promise<void> {
    await this.db.prepare('INSERT INTO voice_writer_budget (day, neurons) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons').bind(day, neurons).run();
  }
  async queuedCount(persona: string, g: string, bucket: string): Promise<number> {
    const r = await this.db.prepare("SELECT COUNT(*) AS n FROM voice_queue WHERE persona = ? AND g = ? AND bucket = ? AND status = 'pending'").bind(persona, g, bucket).first<{ n: number }>();
    return r?.n ?? 0;
  }
  async queuedTexts(persona: string, g: string, bucket: string): Promise<string[]> {
    const r = await this.db.prepare("SELECT text FROM voice_queue WHERE persona = ? AND g = ? AND bucket = ? AND status = 'pending'").bind(persona, g, bucket).all<{ text: string }>();
    return (r.results ?? []).map((x) => x.text);
  }
  async markBaked(keys: { persona: string; g: string; bucket: string; norm: string }[]): Promise<number> {
    let changed = 0;
    for (const k of keys) {
      const r = await this.db.prepare("UPDATE voice_queue SET status = 'baked' WHERE persona = ? AND g = ? AND bucket = ? AND norm = ? AND status = 'pending'").bind(k.persona, k.g, k.bucket, k.norm).run();
      changed += (r.meta as { changes?: number } | undefined)?.changes ?? 0;
    }
    return changed;
  }
  async enqueue(l: { persona: string; g: string; bucket: string; text: string; norm: string; at: number }): Promise<boolean> {
    const r = await this.db.prepare("INSERT OR IGNORE INTO voice_queue (persona, g, bucket, text, norm, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(l.persona, l.g, l.bucket, l.text, l.norm, l.at).run();
    return !!(r.meta as { changes?: number } | undefined)?.changes;
  }
}

/* ------------------------------------------------------------------ pure policy */

/** Rough token estimate (chars/4): good enough for a budget reservation, never for billing. */
export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));
export function estimateNeurons(prompt: string, maxOutputTokens = WRITER_MAX_OUTPUT_TOKENS): number {
  return (estimateTokens(prompt) * NEURON_RATES.inputPerM + maxOutputTokens * NEURON_RATES.outputPerM) / 1_000_000;
}
export function actualNeurons(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, prompt: string): number {
  if (!usage) return estimateNeurons(prompt);
  return ((usage.prompt_tokens ?? estimateTokens(prompt)) * NEURON_RATES.inputPerM + (usage.completion_tokens ?? 0) * NEURON_RATES.outputPerM) / 1_000_000;
}
/** The hard stop, exactly: a call may start only while its reservation fits under the stop. */
export function withinBudget(spentToday: number, reservation: number, stop = NEURON_DAILY_STOP): boolean {
  return spentToday + reservation <= stop;
}
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);
export const normalizeLine = (t: string): string => t.normalize('NFC').replace(/\s+/g, ' ').trim();

const BUCKET_OK = /^(set1|set2|set3|win|wheelsBid:\d{1,2}:\d{1,2}|wheelsUnder:\d{1,2}:\d{1,2})$/;
/** A generated line is bakeable text or nothing. Mirrors the bake planner's reject rules. */
export function validateLine(raw: string, req: WriterRequest): string | null {
  const t = normalizeLine(raw ?? '').replace(/^["“]|["”]$/g, '');
  if (!BUCKET_OK.test(req.bucket)) return null;
  if (t.length < 3 || t.length > 140) return null;
  if (/[{}<>]/.test(t) || /https?:|www\./i.test(t)) return null;
  if (/\bboston\b/i.test(t)) return null; // new copy says Wheels
  const low = t.toLowerCase();
  for (const n of req.forbiddenNames ?? []) if (n && low.includes(n.toLowerCase())) return null; // roles, never names
  for (const old of req.existingTexts ?? []) if (tokenOverlap(low, old.toLowerCase()) > 0.6) return null; // no restatements
  return t;
}
export function tokenOverlap(a: string, b: string): number {
  const A = new Set(a.split(/[^a-z0-9]+/).filter(Boolean)), B = new Set(b.split(/[^a-z0-9]+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
}

const BUCKET_FACT: Record<string, string> = {
  set1: 'your team just got SET by 1 book (you missed your bid by 1)',
  set2: 'your team just got SET by 2 books',
  set3: 'your team just got SET by 3 or more books',
  win: 'your team just WON the match',
};
export function writerPrompt(req: WriterRequest): string {
  const fact = BUCKET_FACT[req.bucket] ?? (req.bucket.startsWith('wheelsBid')
    ? `your team took ${req.bucket.split(':')[2]} books on a bid of ${req.bucket.split(':')[1]} — Wheels! celebrate it with those numbers`
    : `your team took ${req.bucket.split(':')[2]} books after bidding only ${req.bucket.split(':')[1]} — Wheels! roast the low bid with those numbers`);
  return [
    `Write ONE short trash-talk line (max 120 characters) for a Spades card game character.`,
    `Persona: ${req.persona}. Situation: ${fact}.`,
    `Say "y'all" or "partner", never a person's name. Use the word Wheels (never Boston) for 10+ books.`,
    `One line only, no quotes, no emoji.`,
  ].join('\n');
}

/** Three writer failures open a 5-minute breaker (design doc); the table stays on canned lines. */
export class WriterBreaker {
  private failures = 0; private openUntil = 0;
  constructor(private readonly now: () => number = Date.now) {}
  get open(): boolean { return this.now() < this.openUntil; }
  ok(): void { this.failures = 0; }
  fail(): void { if (++this.failures >= 3) { this.openUntil = this.now() + 5 * 60_000; this.failures = 0; } }
}

export type WriteResult = 'queued' | 'not-thin' | 'budget' | 'breaker' | 'invalid' | 'error' | 'duplicate';

/** One writer pass. Never throws: any failure just leaves the canned fallback in place. */
export async function writeVoiceLine(deps: { ai: WorkersAiLike; store: QueueStore; breaker?: WriterBreaker; now?: () => number }, req: WriterRequest): Promise<WriteResult> {
  const now = deps.now ?? Date.now;
  const breaker = deps.breaker;
  if (breaker?.open) return 'breaker';
  try {
    const existing = [...(req.existingTexts ?? []), ...(await deps.store.queuedTexts(req.persona, req.g, req.bucket))];
    if (existing.length >= BUCKET_THIN) return 'not-thin';
    const prompt = writerPrompt(req);
    const day = utcDay(now());
    const spent = await deps.store.budgetDay(day);
    const reserve = estimateNeurons(prompt);
    if (!withinBudget(spent, reserve)) return 'budget';
    const out = await deps.ai.run(WRITER_MODEL, { messages: [{ role: 'user', content: prompt }], max_tokens: WRITER_MAX_OUTPUT_TOKENS });
    await deps.store.addBudget(day, actualNeurons(out.usage, prompt));
    const rawNorm = normalizeLine(out.response ?? '').toLowerCase();
    if (existing.some((x) => normalizeLine(x).toLowerCase() === rawNorm)) return 'duplicate';
    const text = validateLine(out.response ?? '', { ...req, existingTexts: existing });
    if (!text) { breaker?.fail(); return 'invalid'; }
    const added = await deps.store.enqueue({ persona: req.persona, g: req.g, bucket: req.bucket, text, norm: normalizeLine(text).toLowerCase(), at: now() });
    breaker?.ok();
    return added ? 'queued' : 'duplicate';
  } catch {
    breaker?.fail();
    return 'error';
  }
}
