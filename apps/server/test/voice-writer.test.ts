import { describe, expect, it } from 'vitest';
import {
  D1QueueStore, NEURON_DAILY_STOP, WRITER_MODEL, WriterBreaker, estimateNeurons, utcDay, validateLine,
  withinBudget, writeVoiceLine, type WorkersAiLike, type WriterRequest,
} from '../src/voice/writer';
import { mergeQueue } from '../../../scripts/voice-bake/export-queue';
import { makeD1 } from './d1';

const req: WriterRequest = { persona: 'og', g: 'm', bucket: 'set1', forbiddenNames: ['Big Mike'] };
const aiSaying = (text: string, usage = { prompt_tokens: 200, completion_tokens: 20 }): WorkersAiLike => ({
  run: async (model) => { expect(model).toBe(WRITER_MODEL); return { response: text, usage }; },
});

async function store() { return new D1QueueStore(await makeD1()); }

describe('voice writer budget (8,000-neuron hard stop)', () => {
  it('withinBudget flips exactly at the stop', () => {
    expect(withinBudget(0, NEURON_DAILY_STOP)).toBe(true);
    expect(withinBudget(0, NEURON_DAILY_STOP + 0.01)).toBe(false);
    expect(withinBudget(NEURON_DAILY_STOP - 10, 10)).toBe(true);
    expect(withinBudget(NEURON_DAILY_STOP - 10, 10.01)).toBe(false);
    expect(estimateNeurons('x'.repeat(400))).toBeGreaterThan(0);
  });
  it('a seeded day at the stop gets no AI call and queues nothing', async () => {
    const s = await store();
    await s.addBudget(utcDay(1_700_000_000_000), NEURON_DAILY_STOP);
    let called = 0;
    const ai: WorkersAiLike = { run: async () => { called++; return { response: 'we will get y all next hand partner' }; } };
    const r = await writeVoiceLine({ ai, store: s, now: () => 1_700_000_000_000 }, req);
    expect(r).toBe('budget'); expect(called).toBe(0);
    expect(await s.queuedCount('og', 'm', 'set1')).toBe(0);
  });
  it('one good line is queued as text and the day budget is charged', async () => {
    const s = await store();
    const r = await writeVoiceLine({ ai: aiSaying('Set by one! Y all got too cute, partner.'), store: s, now: () => 1_700_000_000_000 }, req);
    expect(r).toBe('queued');
    expect(await s.queuedTexts('og', 'm', 'set1')).toEqual(['Set by one! Y all got too cute, partner.']);
    expect(await s.budgetDay(utcDay(1_700_000_000_000))).toBeGreaterThan(0);
  });
});

describe('voice writer validation + thin rule + breaker', () => {
  it('rejects names, Boston, markup, and restatements; accepts role talk', () => {
    expect(validateLine('Big Mike got set, ha!', req)).toBeNull();
    expect(validateLine('Boston! we took them all', req)).toBeNull();
    expect(validateLine('Set {bid} books {name}', req)).toBeNull();
    expect(validateLine('we will get y all next hand partner', { ...req, existingTexts: ['we will get y all next hand partner, believe it'] })).toBeNull();
    expect(validateLine('Set by one! Y all got cute, partner.', req)).toContain('Set by one');
  });
  it('does not spend when the bucket is not thin, and dedupes queued text', async () => {
    const s = await store();
    const full: WriterRequest = { ...req, existingTexts: ['line one partner', 'line two y all'] };
    expect(await writeVoiceLine({ ai: aiSaying('a third line partner'), store: s }, full)).toBe('not-thin');
    expect(await writeVoiceLine({ ai: aiSaying('Set by one! Y all got cute.'), store: s, now: () => 5 }, req)).toBe('queued');
    expect(await writeVoiceLine({ ai: aiSaying('Set by one! Y all got cute.'), store: s, now: () => 6, breaker: undefined }, { ...req, existingTexts: [] })).toBe('duplicate');
  });
  it('AI errors never throw, and three failures open the breaker', async () => {
    const s = await store();
    const bad: WorkersAiLike = { run: async () => { throw new Error('neurons gone'); } };
    const breaker = new WriterBreaker(() => 1000);
    for (let i = 0; i < 3; i++) expect(await writeVoiceLine({ ai: bad, store: s, breaker, now: () => 1000 }, req)).toBe('error');
    expect(await writeVoiceLine({ ai: aiSaying('Set by one! Y all got cute.'), store: s, breaker, now: () => 1000 }, req)).toBe('breaker');
  });
  it('the trigger is gated by aiTalk (default off) at the room layer', async () => {
    const { readFileSync } = await import('node:fs');
    const room = readFileSync(new URL('../src/room.ts', import.meta.url), 'utf8');
    expect(room).toContain('if (d.aiTalk && this.io.voiceMiss');
    expect(room).toContain('aiTalk: !!d.aiTalk');
    const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(wrangler).toContain('[ai]\nbinding = "AI"');
  });
});

describe('D1 -> queue.json export merge', () => {
  it('merges pending rows, dedupes on normalized identity, keeps existing order', () => {
    const existing = [{ persona: 'og', g: 'm', bucket: 'set1', text: 'Set by one!  Y all got cute.' }];
    const rows = [
      { persona: 'og', g: 'm', bucket: 'set1', text: 'set by one! y all got cute.' }, // same after normalize
      { persona: 'og', g: 'm', bucket: 'win', text: 'That is the match, partner. We did it.' },
    ];
    const merged = mergeQueue(existing, rows);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(existing[0]);
    expect(merged[1]!.bucket).toBe('win');
  });
});

describe('baked marking drains the D1 queue', () => {
  it('queued line flips pending -> baked and stops counting as queued', async () => {
    const s = await store();
    expect(await writeVoiceLine({ ai: aiSaying('Set by one! Y all got too cute, partner.'), store: s, now: () => 7 }, req)).toBe('queued');
    expect(await s.queuedCount('og', 'm', 'set1')).toBe(1);
    const changed = await s.markBaked([{ persona: 'og', g: 'm', bucket: 'set1', norm: 'set by one! y all got too cute, partner.' }]);
    expect(changed).toBe(1);
    expect(await s.queuedCount('og', 'm', 'set1')).toBe(0);
    expect(await s.markBaked([{ persona: 'og', g: 'm', bucket: 'set1', norm: 'set by one! y all got too cute, partner.' }])).toBe(0); // idempotent
  });
});
