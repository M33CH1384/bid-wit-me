import { describe, expect, it } from 'vitest';
import { mergeSystem } from '../src/online/useOnline';

describe('chat: collapsing system lines', () => {
  it('folds runs of timeouts into one line with counts', () => {
    let t = 'Niaaa ran out of time';
    t = mergeSystem(t, 'nyla ran out of time')!;
    t = mergeSystem(t, 'Niaaa ran out of time')!;
    expect(t).toBe('⏱ Out of time: Niaaa ×2 · nyla');
  });
  it('identical lines become ×N; different lines do not merge', () => {
    expect(mergeSystem('Meech joined', 'Meech joined')).toBe('Meech joined ×2');
    expect(mergeSystem('Meech joined ×2', 'Meech joined')).toBe('Meech joined ×3');
    expect(mergeSystem('Meech joined', 'Game 2 started')).toBeNull();
  });
});
