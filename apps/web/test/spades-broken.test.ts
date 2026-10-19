import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const src = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
describe('SPADES BROKEN chip gating', () => {
  it('every broken indicator is gated on the viewer Tips setting', () => {
    const hits = [...src.matchAll(/st\.spadesBroken && ([^}]+)/g)].map((m) => m[0]);
    expect(hits.length).toBe(2); // bug-meta, bug-trumps (landscape) — the old persistent trump strip was removed 2026-10-19
    for (const h of hits) expect(h).toContain('tips.on');
  });
  it('the visible chip says SPADES BROKEN', () => {
    expect(src).toContain('data-testid="spades-broken"');
    expect(src).toContain('>SPADES BROKEN</span>');
    expect(src).not.toContain('>BROKEN<');
  });
});
