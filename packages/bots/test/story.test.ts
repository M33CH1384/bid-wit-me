/** Story Mode Phase 1: stop definitions, characters, scripts, unlock + reward math. */
import { describe, expect, it } from 'vitest';
import {
  PERSONAS, STORY_CHARACTERS, STORY_SCRIPTS, STORY_STOPS, STORY_TIER_SKILL, beatsFor,
  deeSkillForStop, storyCurrentStop, storyPairTrackKey, storyReward, storyStopById,
  storyStopState, storyStopUnlocked, storyTrackKeyValid,
} from '../src';
import { BOT_SKILLS } from '../src/bidding';

describe('story stops', () => {
  it('the route has 11 stops, numbered 1..11 in order, with unique ids', () => {
    expect(STORY_STOPS.length).toBe(11);
    expect(STORY_STOPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(STORY_STOPS.map((s) => s.id)).size).toBe(11);
    expect(STORY_STOPS[10]!.id).toBe('king');
  });

  it('every stop names a real venue, a real pair, a twist and a tier skill', () => {
    for (const s of STORY_STOPS) {
      expect(s.venueId, s.id).toBeTruthy();
      expect(s.twist.label.length, s.id).toBeGreaterThan(3);
      expect(BOT_SKILLS).toContain(STORY_TIER_SKILL[s.tier]);
      expect(s.pair.length).toBe(2);
      expect(s.pair[0]).not.toBe(s.pair[1]);
      for (const cid of s.pair) {
        const c = STORY_CHARACTERS[cid];
        expect(c, `${s.id}:${cid}`).toBeDefined();
        expect(PERSONAS[c!.personaId], `${cid} persona`).toBeDefined();
      }
    }
  });

  it('the brief\u2019s stops land in order with their twists', () => {
    expect(storyStopById('porch')!.twist.targetScore).toBe(250);
    expect(storyStopById('porch')!.twist.bidTimerSec).toBe(45);
    expect(storyStopById('barbershop')!.twist.mode).toBe('aceDown');
    expect(storyStopById('rec-center')!.twist).toMatchObject({ bidTimerSec: 20, playTimerSec: 20 });
    expect(storyStopById('corner')!.twist.targetScore).toBe(500);
    expect(storyStopById('church-basement')!.twist.nilValue).toBe(200);
    expect(storyStopById('rooftop')!.twist.blindNil).toEqual({ availability: 'always', value: 300 });
    expect(storyStopById('high-rise')!.twist.targetScore).toBe(500);
    expect(storyStopById('the-pjs')!.venueId).toBe('blockAfterDark');
    expect(storyStopById('king')!.twist.targetScore).toBe(750);
    expect(storyStopById('king')!.tier).toBe('elite');
  });

  it('difficulty ramps: adversary skill never decreases along the route', () => {
    const rank = (s: string) => BOT_SKILLS.indexOf(s as never);
    const skills = STORY_STOPS.map((s) => rank(STORY_TIER_SKILL[s.tier]));
    for (let i = 1; i < skills.length; i++) expect(skills[i]!).toBeGreaterThanOrEqual(skills[i - 1]!);
    expect(STORY_TIER_SKILL[STORY_STOPS[0]!.tier]).toBe('novice');
    expect(STORY_TIER_SKILL[STORY_STOPS[10]!.tier]).toBe('shark');
  });
});

describe('Dee', () => {
  it('is a real character on a real persona', () => {
    expect(STORY_CHARACTERS.dee).toBeDefined();
    expect(PERSONAS[STORY_CHARACTERS.dee!.personaId]).toBeDefined();
  });
  it('her skill literally scales stop to stop', () => {
    expect(deeSkillForStop(1)).toBe('novice');
    expect(deeSkillForStop(2)).toBe('novice');
    expect(deeSkillForStop(4)).toBe('regular');
    expect(deeSkillForStop(7)).toBe('pro');
    expect(deeSkillForStop(9)).toBe('shark');
    expect(deeSkillForStop(11)).toBe('shark');
    const rank = (s: string) => BOT_SKILLS.indexOf(s as never);
    for (let n = 2; n <= 11; n++) expect(rank(deeSkillForStop(n))).toBeGreaterThanOrEqual(rank(deeSkillForStop(n - 1)));
  });
});

describe('story scripts', () => {
  it('every stop has intro, loss-return, win and loss beats, spoken by real characters', () => {
    const speakers = new Set([...Object.keys(STORY_CHARACTERS), 'you']);
    for (const s of STORY_STOPS) {
      const sc = STORY_SCRIPTS[s.id];
      expect(sc, s.id).toBeDefined();
      for (const key of ['intro', 'introReturn', 'outroWin', 'outroLose'] as const) {
        expect(sc![key].length, `${s.id}.${key}`).toBeGreaterThan(0);
        for (const beat of sc![key]) {
          expect(speakers.has(beat.speaker), `${s.id}.${key}: ${beat.speaker}`).toBe(true);
          expect(beat.line.length).toBeGreaterThan(3);
        }
      }
      // Dee rides along in every intro — the solo journey is a two-person story
      expect(sc!.intro.some((beat) => beat.speaker === 'dee'), `${s.id} intro has Dee`).toBe(true);
    }
  });

  it('the selector is fact-driven: loss-return beats only after a loss, first-visit beats otherwise', () => {
    const stop = STORY_STOPS[0]!;
    expect(beatsFor(stop, 'intro', { attempts: 0, cleared: false })).toBe(STORY_SCRIPTS[stop.id]!.intro);
    expect(beatsFor(stop, 'intro', { attempts: 2, cleared: false })).toBe(STORY_SCRIPTS[stop.id]!.introReturn);
    expect(beatsFor(stop, 'intro', { attempts: 2, cleared: true })).toBe(STORY_SCRIPTS[stop.id]!.intro);
    expect(beatsFor(stop, 'outroWin', { attempts: 1, cleared: true })).toBe(STORY_SCRIPTS[stop.id]!.outroWin);
    expect(beatsFor(stop, 'outroLose', { attempts: 1, cleared: false })).toBe(STORY_SCRIPTS[stop.id]!.outroLose);
  });
});

describe('unlock + rewards math', () => {
  it('unlock is strictly sequential', () => {
    expect(storyStopUnlocked(1, new Set())).toBe(true);
    expect(storyStopUnlocked(2, new Set())).toBe(false);
    expect(storyStopUnlocked(2, new Set([1]))).toBe(true);
    expect(storyStopUnlocked(3, new Set([1]))).toBe(false);
    expect(storyStopState(1, new Set())).toBe('current');
    expect(storyStopState(2, new Set())).toBe('locked');
    expect(storyStopState(1, new Set([1]))).toBe('cleared');
    expect(storyCurrentStop(new Set())).toBe(1);
    expect(storyCurrentStop(new Set([1, 2, 3]))).toBe(4);
    expect(storyCurrentStop(new Set(STORY_STOPS.map((s) => s.n)))).toBeNull();
  });

  it('first-clear rewards scale with the stop; replays pay upkeep only', () => {
    expect(storyReward(1, true)).toEqual({ xp: 25, coins: 20 });
    expect(storyReward(5, true)).toEqual({ xp: 125, coins: 100 });
    expect(storyReward(11, true)).toEqual({ xp: 275, coins: 220 });
    for (let n = 1; n <= 11; n++) expect(storyReward(n, false)).toEqual({ xp: 10, coins: 5 });
  });
});

describe('track keys', () => {
  it('solo is its own track; pair keys are order-independent and validated', () => {
    expect(storyTrackKeyValid('solo')).toBe(true);
    expect(storyPairTrackKey('u2', 'u1')).toBe('pair:u1:u2');
    expect(storyTrackKeyValid(storyPairTrackKey('u1', 'u2'))).toBe(true);
    expect(storyTrackKeyValid('pair:u1:u1')).toBe(false);
    expect(storyTrackKeyValid('whatever')).toBe(false);
    expect(storyTrackKeyValid(42)).toBe(false);
  });
});
