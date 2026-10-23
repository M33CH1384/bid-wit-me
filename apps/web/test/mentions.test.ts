import { describe, expect, it } from 'vitest';
import { applyMention, mentionQueryAt, rankMentionCandidates, splitMentionText } from '../src/social/mentions';

describe('mentionQueryAt', () => {
  it('finds an in-progress token at the caret', () => {
    expect(mentionQueryAt('hey @Bo', 7)).toEqual({ start: 4, query: 'Bo' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('(@Al', 4)).toEqual({ start: 1, query: 'Al' });
  });
  it('is null mid-word, after a word character, or inside an email-style token', () => {
    expect(mentionQueryAt('hello', 5)).toBeNull();
    expect(mentionQueryAt('a@Bo', 4)).toBeNull();
    expect(mentionQueryAt('hey @Bo x', 4)).toBeNull(); // caret sits before the token completes... (space breaks it)
    expect(mentionQueryAt('hey @Bo!', 8)).toBeNull(); // '!' is not a username char: the token ended before the caret
  });
  it('only the token at the caret counts', () => {
    expect(mentionQueryAt('@Alice and @Bo', 14)).toEqual({ start: 11, query: 'Bo' });
  });
});

describe('applyMention', () => {
  it('replaces the partial token with the canonical name plus a trailing space', () => {
    const q = mentionQueryAt('hey @Bo there', 7)!;
    expect(applyMention('hey @Bo there', q, 7, 'Bobby')).toEqual({ text: 'hey @Bobby  there', caret: 11 });
  });
});

describe('rankMentionCandidates', () => {
  const cands = [{ name: 'Bobby' }, { name: 'bonnie' }, { name: 'Alice' }, { name: 'BOB' }];
  it('prefix-matches case-insensitively, keeps source order (friends first), dedupes', () => {
    expect(rankMentionCandidates(cands, 'bo').map((c) => c.name)).toEqual(['Bobby', 'bonnie', 'BOB']);
    expect(rankMentionCandidates([...cands, { name: 'bobby' }], 'bo').map((c) => c.name)).toEqual(['Bobby', 'bonnie', 'BOB']);
    expect(rankMentionCandidates(cands, '').map((c) => c.name)).toEqual(['Bobby', 'bonnie', 'Alice', 'BOB']);
    expect(rankMentionCandidates(cands, 'z')).toEqual([]);
  });
  it('caps the list', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `Bo${i}` }));
    expect(rankMentionCandidates(many, 'bo')).toHaveLength(6);
  });
});

describe('splitMentionText', () => {
  const resolved = (keys: string[]) => (k: string) => keys.includes(k);
  it('flags only the tokens the server resolved', () => {
    expect(splitMentionText('gg @Bobby and @Nobody', resolved(['bobby']))).toEqual([
      { text: 'gg ', mention: false },
      { text: '@Bobby', mention: true },
      { text: ' and @Nobody', mention: false },
    ]);
  });
  it('handles a mention at the start, punctuation after, and no mentions', () => {
    expect(splitMentionText('@Bobby, nice', resolved(['bobby']))).toEqual([
      { text: '@Bobby', mention: true },
      { text: ', nice', mention: false },
    ]);
    expect(splitMentionText('plain text', resolved(['bobby']))).toEqual([{ text: 'plain text', mention: false }]);
    expect(splitMentionText('mail a@bobby.com', resolved(['bobby']))).toEqual([{ text: 'mail a@bobby.com', mention: false }]);
  });
});
