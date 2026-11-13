/**
 * Match point (owner, 2026-11-12: "We need a mood for this scenario when the next hand decides
 * the match"). Pins the detector — who is one made hand from the target — the two tiers, the
 * wording (it says the hand CAN end it, never that it will), and the wiring on the recap and
 * the table.
 */
import { describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { HAND_REACH_SOLO, HAND_REACH_TEAM, matchPoint, matchPointHeadline } from '../src/decider';
import intermissionSrc from '../src/Intermission.tsx?raw';
import tableSrc from '../src/Table.tsx?raw';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/decider.css', import.meta.url), 'utf8');

const team = { ...makeRules('joker'), targetScore: 250 };
const solo = { ...makeRules('cutthroat'), targetScore: 250 };
const name = (s: number) => ['Homies', 'Bag Busters', 'C', 'D'][s]!;

describe('match point detector', () => {
  it('the owner’s recap: 233 and 221 to 250 is a decider, closest side first', () => {
    const mp = matchPoint(team, [233, 221]);
    expect(mp).toEqual({ tier: 'decider', sides: [{ side: 0, needs: 17 }, { side: 1, needs: 29 }] });
    expect(matchPoint(team, [221, 233])!.sides.map((s) => s.side)).toEqual([1, 0]);
  });

  it('one side in reach is match point for that side only', () => {
    const mp = matchPoint(team, [140, 200]);
    expect(mp).toEqual({ tier: 'matchPoint', sides: [{ side: 1, needs: 50 }] });
  });

  it('nobody within a made hand of the target: no mood', () => {
    expect(matchPoint(team, [100, 169])).toBeNull();
    expect(matchPoint(team, [0, 0])).toBeNull();
  });

  it('the reach is one ordinary made hand, inclusive', () => {
    expect(matchPoint(team, [250 - HAND_REACH_TEAM, 0])!.sides[0]!.needs).toBe(HAND_REACH_TEAM);
    expect(matchPoint(team, [250 - HAND_REACH_TEAM - 1, 0])).toBeNull();
  });

  it('a side already at the target, and a negative score, are not on match point', () => {
    expect(matchPoint(team, [250, -40])).toBeNull();
  });

  it('cutthroat seats play alone: a shorter reach, and eliminated seats are out of it', () => {
    expect(HAND_REACH_SOLO).toBeLessThan(HAND_REACH_TEAM);
    expect(matchPoint(solo, [250 - HAND_REACH_SOLO - 1, 0, 0, 0])).toBeNull();
    const mp = matchPoint(solo, [210, 215, 220, 100], [false, true, false, false]);
    expect(mp!.sides.map((s) => s.side)).toEqual([2, 0]);
    expect(mp!.tier).toBe('decider');
  });

  it('no target, no mood', () => {
    expect(matchPoint({ ...team, targetScore: 0 }, [10, 10])).toBeNull();
  });
});

describe('match point wording', () => {
  it('a decider says the hand can end it — a mood, not a promise', () => {
    expect(matchPointHeadline(matchPoint(team, [233, 221])!, name)).toBe('Next hand can end it');
  });
  it('one side on match point is named', () => {
    expect(matchPointHeadline(matchPoint(team, [140, 200])!, name)).toBe('Bag Busters can close it out');
  });
});

describe('match point wiring', () => {
  it('the recap shows the strap, never on a decided match, and renames Continue on a decider', () => {
    expect(intermissionSrc).toContain('const mp = decided ? null : matchPoint(r, st.scores, st.eliminated);');
    expect(intermissionSrc).toContain('data-testid="match-point"');
    expect(intermissionSrc).toContain("mp?.tier === 'decider' ? 'Play the deciding hand' : `Continue to hand ${rec.handNo + 1}`");
  });
  it('the table reads the scores the hand started with, only while it is bid or played', () => {
    expect(tableSrc).toContain("st.phase === 'bidding' || st.phase === 'exchange' || st.phase === 'playing' ? matchPoint(st.rules, st.handStart?.scores ?? st.scores, st.eliminated) : null");
    expect(tableSrc).toContain('data-testid="bug-matchpoint"');
  });
  it('the table layer never takes a tap', () => {
    expect(css).toMatch(/\.mp-layer \{[^}]*pointer-events: none/);
  });
});
