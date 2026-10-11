import { describe, expect, it } from 'vitest';
import { winHeadline } from '../src/headline';

describe('victory headline grammar', () => {
  it('Cutthroat: "You win", "<Name> wins"', () => {
    expect(winHeadline(['You'], false)).toBe('You win');
    expect(winHeadline(['you'], false).toUpperCase()).toBe('YOU WIN');
    expect(winHeadline(['Terrell'], false)).toBe('Terrell wins');
    expect(winHeadline(['Aaliyah'], false).toUpperCase()).toBe('AALIYAH WINS');
  });
  it('teams read plural: "<Team> win"', () => {
    expect(winHeadline(['Shot Callers'], true).toUpperCase()).toBe('SHOT CALLERS WIN');
    expect(winHeadline(['You & Andre'], true)).toBe('You & Andre win');
    expect(winHeadline(['Deuce Squad'], true)).toBe('Deuce Squad win');
  });
  it('ties: several winners always "win"', () => {
    expect(winHeadline(['You', 'Ravi'], false)).toBe('You & Ravi win');
    expect(winHeadline(['Ravi', 'Zuri'], false)).toBe('Ravi & Zuri win');
    expect(winHeadline(['Us', 'Them'], true)).toBe('Us & Them win');
  });
  it('never "You wins"', () => {
    for (const p of [true, false]) expect(winHeadline(['You'], p)).not.toMatch(/wins/i);
  });
});
