import { describe, expect, it } from 'vitest';
import { apply, clipId, normalizeText, plan, rejectReason, remainingQueue, type QueueLine } from '../../../scripts/voice-bake/plan';

const ok: QueueLine = { persona: 'mama', g: 'f', bucket: 'set2', text: 'Down two, baby. Sit with that. 😂' };

describe('voice bake planner', () => {
  it('normalizes text and hashes voice | speed | text', () => {
    expect(normalizeText('  WHEELS!  🏎️ we   out ')).toBe('WHEELS! we out');
    expect(clipId('af_heart', 0.92, 'a  b')).toBe(clipId('af_heart', 0.92, 'a b'));
    expect(clipId('af_heart', 0.92, 'a b')).not.toBe(clipId('af_heart', 1, 'a b'));
    expect(clipId('af_heart', 0.92, 'x')).toMatch(/^[0-9a-f]{16}$/);
  });
  it('rejects unknown personas, bad buckets, templates, links and bad lengths', () => {
    expect(rejectReason(ok)).toBeNull();
    expect(rejectReason({ ...ok, persona: 'nobody' })).toMatch(/persona/);
    expect(rejectReason({ ...ok, g: 'x' })).toMatch(/gender/);
    expect(rejectReason({ ...ok, bucket: 'set9' })).toMatch(/bucket/);
    expect(rejectReason({ ...ok, bucket: 'wheelsBid:10:11' })).toBeNull();
    expect(rejectReason({ ...ok, text: 'hey {them}' })).toMatch(/template/);
    expect(rejectReason({ ...ok, text: 'see https://x.y' })).toMatch(/link/);
    expect(rejectReason({ ...ok, text: 'no' })).toMatch(/length/);
  });
  it('plans each new line once, uses the persona voice, skips what the catalog has, honours the cap', () => {
    const p = plan([ok, ok, { ...ok, text: 'Another one' }], []);
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0]).toMatchObject({ voice: 'af_heart', speed: 0.92, lang: 'en-us', text: 'Down two, baby. Sit with that.' });
    const again = plan([ok], [{ id: p.lines[0]!.id, persona: 'mama', g: 'f', bucket: 'set2', text: 'x' }]);
    expect(again.lines).toHaveLength(0);
    expect(plan([ok, { ...ok, text: 'Another one' }], [], 1).lines).toHaveLength(1);
  });
  it('apply adds only lines whose clip exists; the queue keeps the rest', () => {
    const q = [ok, { ...ok, text: 'Another one' }, { ...ok, persona: 'nobody' }];
    const p = plan(q, []);
    const baked = new Set([p.lines[0]!.id]);
    const r = apply([], p, (id) => baked.has(id));
    expect(r.added).toEqual([p.lines[0]!.id]);
    expect(r.missing).toEqual([p.lines[1]!.id]);
    expect(r.catalog[0]).toEqual({ id: p.lines[0]!.id, persona: 'mama', g: 'f', bucket: 'set2', text: 'Down two, baby. Sit with that.' });
    expect(remainingQueue(q, r.catalog)).toEqual([{ ...ok, text: 'Another one' }]);
  });
});
