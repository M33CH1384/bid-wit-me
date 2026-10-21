/** The King's double or nothing — data + tape + between-legs beats.
 *  The structure lives in the stop data (doubleOrNothing), the clear
 *  reward doubles ONLY at that stop, and the tape states the terms
 *  before leg 1 and the live state while the double is pending. */
import { describe, expect, it } from 'vitest';
import {
  STORY_STOPS, buildStoryTape, kingDoubleBeats, storyClearReward, storyReward, storyStopById,
} from '../src/index';

const king = storyStopById('king')!;

describe("the King's double or nothing (bots data)", () => {
  it('only the King carries the double', () => {
    expect(king.doubleOrNothing).toBe(true);
    for (const s of STORY_STOPS) if (s.id !== 'king') expect(s.doubleOrNothing, s.id).toBeFalsy();
    expect(king.twist.label).toContain('Double or nothing');
  });

  it('the doubled clear doubles the real first-clear reward; every other stop pays its own', () => {
    expect(storyReward(11, true)).toEqual({ xp: 275, coins: 220 });
    expect(storyClearReward(king)).toEqual({ xp: 550, coins: 440 });
    for (const s of STORY_STOPS) {
      if (s.id === 'king') continue;
      expect(storyClearReward(s), s.id).toEqual(storyReward(s.n, true));
    }
  });

  it('the tape states the terms BEFORE leg 1 — the rule is never a surprise', () => {
    const tape = buildStoryTape(king, { attempts: 0, cleared: false });
    expect(tape.terms).toBeTruthy();
    expect(tape.terms).toContain('beat the King twice in a row — double or nothing');
    expect(tape.terms!.toLowerCase()).toContain('banks nothing');
  });

  it('while the double is pending, the tape says so — history and terms both', () => {
    const tape = buildStoryTape(king, { attempts: 1, cleared: false, doublePending: true });
    expect(tape.history).toContain('the double is live');
    expect(tape.terms).toContain('already banked');
  });

  it('no other stop gets terms, and a cleared King drops them', () => {
    for (const s of STORY_STOPS) {
      if (s.id === 'king') continue;
      expect(buildStoryTape(s, { attempts: 0, cleared: false }).terms, s.id).toBeUndefined();
    }
    expect(buildStoryTape(king, { attempts: 2, cleared: true, clears: 1 }).terms).toBeUndefined();
  });

  it('the between-legs set-pieces are SHORT — a moment, not a scene', () => {
    const started = kingDoubleBeats('started');
    const lost = kingDoubleBeats('lost');
    expect(started.length).toBeLessThanOrEqual(4);
    expect(lost.length).toBeLessThanOrEqual(4);
    // The King names it, Dee answers.
    expect(started[0]!.speaker).toBe('king');
    expect(started.some((b) => b.speaker === 'dee')).toBe(true);
    expect(started.map((b) => b.line).join(' ').toLowerCase()).toContain('double or nothing');
    expect(lost[0]!.speaker).toBe('king');
    expect(lost.some((b) => b.speaker === 'dee')).toBe(true);
  });

  it('the gun staging (owner, 2026-10-21): exactly one beat carries the prop, and it is the King’s opener', () => {
    const started = kingDoubleBeats('started');
    const marked = started.filter((b) => b.prop === 'kingGun');
    expect(marked).toHaveLength(1);
    expect(started[0]!.prop).toBe('kingGun');
    expect(started[0]!.speaker).toBe('king');
    // the sentiment the owner ordered, in the King’s own words
    expect(started[0]!.line.toLowerCase()).toContain('you ain’t won yet');
    // the loss set-piece stages no prop — the run is over, the table is clear
    expect(kingDoubleBeats('lost').some((b) => b.prop)).toBe(false);
  });
});
