import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPronunciation } from '@spades/bots';

// The pronunciation dictionary lives in ONE place (packages/bots/src/pronounce.ts) and both
// speech paths consume it: the recorded bake (via spokenTake) and this app's Web Speech
// fallback in talkPrefs.ts. These pins keep the paths from drifting apart again — the
// fallback used to hand-code an mm-hm fix the recorded clips never got (owner, 2026-10-21).
const talkPrefs = readFileSync(join(process.cwd(), 'apps/web/src/talkPrefs.ts'), 'utf8');

describe('pronunciation: one dictionary, both speech paths', () => {
  it('the fallback imports the shared dictionary from @spades/bots', () => {
    expect(talkPrefs).toContain('applyPronunciation');
    expect(talkPrefs).toMatch(/import \{[^}]*applyPronunciation[^}]*\} from '@spades\/bots'/);
    expect(talkPrefs).toContain('applyPronunciation(clean)');
    expect(talkPrefs).toContain('applyPronunciation(text)');
  });
  it('the old hand-coded mm-hm fix is gone', () => {
    expect(talkPrefs).not.toContain('mm-hmm');
    expect(talkPrefs).not.toMatch(/replace\(\/\\bmm-hm/);
  });
  it('the dictionary the fallback applies is the verified one', () => {
    expect(applyPronunciation('mm-hm')).toBe('hmm hmm'); // a hum, never spelled out
    expect(applyPronunciation('chile')).toBe('chyle'); // slang "child" ≈ tʃaɪl, not chee-lay
    expect(applyPronunciation('them')).toBe('them'); // lookalikes untouched
  });
});
