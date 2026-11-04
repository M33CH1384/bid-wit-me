import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withDeaconOpponent } from '@spades/bots';

// Wiring pins for the Deacon seat guarantee (owner-approved, 2026-11-03):
// Table's offline name deal consults the "Fresh table talk — Deacon"
// preference and only then applies the seating adjustment; with the
// preference off the dealt names pass through untouched (same seeds → same
// names as before the feature). The adjustment itself is behaviour-tested
// in packages/bots/test/deacon-seat.test.ts.
describe('deacon seat guarantee wiring', () => {
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
  const at = table.indexOf('function offlineNames');
  const body = table.slice(at, at + 1400);

  it('the helper is exported from @spades/bots', () => {
    expect(typeof withDeaconOpponent).toBe('function');
  });

  it('offlineNames deals first, then consults the preference', () => {
    expect(body).toContain('pickBotNames');
    expect(body.indexOf('pickBotNames')).toBeLessThan(body.indexOf('talkStore.get().genDialogue'));
    expect(body).toContain('withDeaconOpponent');
  });

  it('the off path returns the dealt names untouched', () => {
    expect(body).toContain('if (!talkStore.get().genDialogue) return picked;');
  });

  it('the bot-names initializer still prefers story names, then saved names', () => {
    const init = table.indexOf('const [botNames]');
    const seg = table.slice(init, init + 260);
    expect(seg.indexOf('story?.names')).toBeGreaterThanOrEqual(0);
    expect(seg.indexOf('story?.names')).toBeLessThan(seg.indexOf('resume?.names'));
    expect(seg.indexOf('resume?.names')).toBeLessThan(seg.indexOf('offlineNames('));
    expect(seg).toContain('initialRules.partnerships');
  });
});
