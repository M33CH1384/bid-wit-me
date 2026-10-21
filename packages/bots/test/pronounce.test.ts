import { describe, expect, it } from 'vitest';
import { PERSONAS, type PersonaId, applyPronunciation, speakableLines, spokenBidTake, spokenTake } from '../src/index';

describe('pronunciation dictionary (shared by the bake and the Web Speech fallback)', () => {
  it('respells the owner-reported offenders', () => {
    expect(applyPronunciation("mm-hm. mama's thinking.")).toBe("hmm hmm. mama's thinking.");
    expect(applyPronunciation("chile, you won't believe what I heard.")).toBe("chyle, you won't believe what I heard.");
    expect(applyPronunciation('QED.')).toBe('Q E D.');
    expect(applyPronunciation('lay em down, youngblood.')).toBe('lay um down, youngblood.');
    expect(applyPronunciation("mm. I'm telling the whole family.")).toBe("hmm. I'm telling the whole family.");
    expect(applyPronunciation('a nil? bold.')).toBe('a nill? bold.');
  });
  it('is word-boundary safe: lookalike words are untouched', () => {
    const s = 'them problem dilemma anthem chiles nill nils emblem';
    expect(applyPronunciation(s)).toBe(s);
  });
  it('is idempotent (applying it twice changes nothing more)', () => {
    const s = "mm-hm, chile. QED — lay em down. mm. nil.";
    expect(applyPronunciation(applyPronunciation(s))).toBe(applyPronunciation(s));
  });
  it("no speakable line's spoken form still carries a raw dictionary token", () => {
    const RAW_TOKEN = /\bmm-hm\b|\bchile\b|\btryna\b|\bqed\b|\bmm\b|'em\b|\bem\b|\bnil\b/i;
    for (const id of Object.keys(PERSONAS) as PersonaId[]) {
      for (const g of ['f', 'm'] as const) {
        for (const l of speakableLines(id, g)) {
          if (l.raw === '…') continue;
          const takes = spokenTake(l.raw, id) !== undefined
            ? [spokenTake(l.raw, id)!]
            : Array.from({ length: 13 }, (_, i) => spokenBidTake(l.raw, i + 1));
          for (const t of takes) expect(RAW_TOKEN.test(t), `${id}-${g} ${l.raw} → ${t}`).toBe(false);
        }
      }
    }
  });
});
