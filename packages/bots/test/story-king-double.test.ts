/** The King's double or nothing — data + tape + between-legs beats.
 *  The structure lives in the stop data (doubleOrNothing), the clear
 *  reward doubles ONLY at that stop, and the tape states the terms
 *  before leg 1 and the live state while the double is pending. */
import { describe, expect, it } from 'vitest';
import {
  GUIDE_FINALE, KING_PROPOSAL_LINES, STORY_STOPS, buildStoryTape, kingDoubleBeats, kingProposalBeats,
  storyClearReward, storyReward, storyStopById,
} from '../src/index';
import { storyCorpus } from '../../../scripts/voice-bake/dump-story-lines';

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

describe('the co-op proposal (Phase 4, spec §6.3/§8.10)', () => {
  it('the six proposal lines are byte-identical to the bake-authored texts', () => {
    // The mini-bake's manifest keys were computed from these exact texts —
    // a single reworded character orphans a recorded clip. Pin them.
    expect(KING_PROPOSAL_LINES).toEqual([
      { speaker: 'king', line: 'The second game is usually the first one, played again. Same table. Same terms.' },
      { speaker: 'king', line: 'For you two, the terms change.' },
      { speaker: 'king', line: 'You climbed this whole route holding each other up. So my last test pulls the other way.' },
      { speaker: 'king', line: 'Cutthroat. Four seats, no partners. The hand across from you stops being yours to protect.' },
      { speaker: 'king', line: 'Take it outright and the double pays — to both names. Or keep the clear you earned and walk out together. Decide like people who know what things cost.' },
      { speaker: 'ringer', line: 'Choose carefully.' },
    ]);
  });

  it('the bake corpus registers exactly the six, under coop:proposal', () => {
    const fam = storyCorpus().filter((c) => c.source === 'coop:proposal');
    expect(fam).toHaveLength(6);
    expect(fam.filter((c) => c.speaker === 'king')).toHaveLength(5);
    expect(fam.filter((c) => c.speaker === 'ringer')).toHaveLength(1);
    expect(fam.map((c) => c.line)).toEqual(KING_PROPOSAL_LINES.map((b) => b.line));
  });

  it('the full scene: gun first (placed, never pointed), the King’s terms, the Ringer, then Dee answers', () => {
    const beats = kingProposalBeats(false);
    expect(beats).toHaveLength(8); // 6 proposal + Dee's two (GUIDE_FINALE [1]/[2])
    expect(beats[0]).toMatchObject({ speaker: 'king', prop: 'kingGun', line: KING_PROPOSAL_LINES[0]!.line });
    expect(beats.slice(1, 6).map((b) => b.line)).toEqual(KING_PROPOSAL_LINES.slice(1).map((b) => b.line));
    expect(beats[6]).toEqual({ speaker: 'dee', line: GUIDE_FINALE[1] });
    expect(beats[7]).toEqual({ speaker: 'dee', line: GUIDE_FINALE[2] });
    // canon: exactly one beat carries the prop, and no line ever has him point, touch or fire it
    expect(beats.filter((b) => b.prop)).toHaveLength(1);
    for (const b of beats) expect(b.line.toLowerCase()).not.toMatch(/point|aim|shoot|fire|trigger|raise the|lift the/);
  });

  it('the short scene: the price and Dee’s reminder, the gun already down', () => {
    const beats = kingProposalBeats(true);
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({ speaker: 'king', prop: 'kingGun', line: KING_PROPOSAL_LINES[4]!.line });
    expect(beats[1]).toEqual({ speaker: 'dee', line: GUIDE_FINALE[1] });
  });
});
