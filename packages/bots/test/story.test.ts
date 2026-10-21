/** Story Mode Phase 1: stop definitions, characters, scripts, unlock + reward math. */
import { describe, expect, it } from 'vitest';
import {
  PERSONAS, STORY_BID_REACT, STORY_CALLBACKS, STORY_CHARACTERS, STORY_INTRO_VARIANTS, STORY_MID_SCENES,
  STORY_PLAY_REACTS, STORY_RETRY_FIRST, STORY_SCRIPTS, STORY_SECRETS, STORY_SIT_DOWN, STORY_STOPS,
  STORY_TABLE_EXCHANGES, STORY_TIER_SKILL, STORY_VOICE_CAST, beatsFor, buildStoryTape, callbackFor,
  deeSkillForStop, deeStageForStop, deeTapeFor, midSceneFor, nameGender, playBeatFor, storyCastForName,
  storyCurrentStop, storyEggEventMet, storyFeatMet, storyPairTrackKey, storyPortraitFor, storyReward,
  storyStopById, storyStopState, storyStopUnlocked, storyTrackKeyValid, storyVoiceKey, tableExchangeFor,
  voiceFor, voiceGender, type StoryGameFacts,
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

  it('the selector is fact-driven: attempt bands pick stranger / second / grind / champion scenes', () => {
    const stop = STORY_STOPS[0]!;
    expect(beatsFor(stop, 'intro', { attempts: 0, cleared: false })).toBe(STORY_SCRIPTS[stop.id]!.intro);
    expect(beatsFor(stop, 'intro', { attempts: 1, cleared: false })).toBe(STORY_INTRO_VARIANTS[stop.id]!.second);
    expect(beatsFor(stop, 'intro', { attempts: 2, cleared: false })).toBe(STORY_INTRO_VARIANTS[stop.id]!.grind);
    expect(beatsFor(stop, 'intro', { attempts: 5, cleared: false })).toBe(STORY_INTRO_VARIANTS[stop.id]!.grind);
    expect(beatsFor(stop, 'intro', { attempts: 2, cleared: true })).toBe(STORY_INTRO_VARIANTS[stop.id]!.champion);
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

/* ================= Scene pass (2026-10-21) ================= */

const FACTS0 = { margin: 0, handsPlayed: 0, setsAgainstUs: 0, setsAgainstThem: 0, ourNilsMade: 0, ourBlindNilsMade: 0, deeNilsMade: 0, deeSteady: false, setOnFirstHand: false, oppSetTwice: false } satisfies StoryGameFacts;
const facts = (over: Partial<StoryGameFacts>): StoryGameFacts => ({ ...FACTS0, ...over });

describe('scene pass: scenes are scenes', () => {
  it('intros are SHORT sit-downs — the rebalance caps (the match tells the story now)', () => {
    const routeBefore = (id: string) => STORY_STOPS.slice(0, STORY_STOPS.findIndex((s) => s.id === id)).map((s) => s.id);
    for (const stop of STORY_STOPS) {
      const intro = STORY_SCRIPTS[stop.id]!.intro;
      const isKing = stop.id === 'king';
      // raw sit-down cap: ~5 exchanges (King 6 — the double-or-nothing terms beat + one ceremony beat)
      expect(intro.length, `${stop.id} intro length`).toBeLessThanOrEqual(isKing ? 6 : 5);
      // as composed for a first visit (gated lines merged, rail woven in)
      const shown = beatsFor(stop, 'intro', { attempts: 0, cleared: false, clearedStopIds: routeBefore(stop.id) });
      expect(shown.length, `${stop.id} intro shown`).toBeLessThanOrEqual(isKing ? 7 : 6);
      const speakers = new Set(intro.map((b) => b.speaker));
      expect(speakers.size, `${stop.id} intro speakers`).toBeGreaterThanOrEqual(3);
      expect(speakers.has('dee'), `${stop.id} intro: Dee speaks`).toBe(true);
      for (const cid of stop.pair) expect(speakers.has(cid), `${stop.id} intro: ${cid} speaks`).toBe(true);
      // the pair still talk to EACH OTHER in the short sit-down, not just to the player
      const pairLines = intro.filter((b) => stop.pair.includes(b.speaker)).length;
      expect(pairLines, `${stop.id} intro pair presence`).toBeGreaterThanOrEqual(2);
      // return / cleared bands are miniatures (raw ≤3), and stay small once composed
      expect(STORY_SCRIPTS[stop.id]!.introReturn.length, `${stop.id} introReturn`).toBeLessThanOrEqual(3);
      const v = STORY_INTRO_VARIANTS[stop.id]!;
      expect(v.second.length, `${stop.id} second`).toBeLessThanOrEqual(3);
      expect(v.grind.length, `${stop.id} grind`).toBeLessThanOrEqual(3);
      expect(v.champion.length, `${stop.id} champion`).toBeLessThanOrEqual(3);
      expect(beatsFor(stop, 'intro', { attempts: 1, cleared: false }).length, `${stop.id} second shown`).toBeLessThanOrEqual(5);
      expect(beatsFor(stop, 'intro', { attempts: 2, cleared: false }).length, `${stop.id} grind shown`).toBeLessThanOrEqual(5);
      expect(beatsFor(stop, 'intro', { attempts: 0, cleared: true }).length, `${stop.id} champion shown`).toBeLessThanOrEqual(4);
      // outros are closers now: win ≤4 (King ≤5 — the graduation), loss ≤3
      expect(STORY_SCRIPTS[stop.id]!.outroWin.length, `${stop.id} outroWin`).toBeLessThanOrEqual(isKing ? 5 : 4);
      expect(STORY_SCRIPTS[stop.id]!.outroLose.length, `${stop.id} outroLose`).toBeLessThanOrEqual(3);
    }
    // the King states the double-or-nothing terms inside his intro cap
    expect(STORY_SCRIPTS.king!.intro.map((b) => b.line).join(' ')).toContain('Two in a row');
  });

  it('win scenes resolve forward: stops 1–10 name the next table (stop name or its pair)', () => {
    for (let i = 0; i < 10; i++) {
      const stop = STORY_STOPS[i]!;
      const next = STORY_STOPS[i + 1]!;
      const text = STORY_SCRIPTS[stop.id]!.outroWin.map((b) => b.line).join(' ');
      const nextNames = [next.name, ...next.pair.map((id) => STORY_CHARACTERS[id]!.name)];
      expect(nextNames.some((n) => text.includes(n.replace(/^The /, '')) || text.includes(n)), `${stop.id} outroWin → ${next.id}`).toBe(true);
      expect(STORY_SCRIPTS[stop.id]!.outroWin.length).toBeGreaterThanOrEqual(3);
      expect(STORY_SCRIPTS[stop.id]!.outroLose.length).toBeGreaterThanOrEqual(3);
      expect(STORY_SCRIPTS[stop.id]!.introReturn.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('retry bands are three different scenes — no verbatim repeat, no stranger re-intro', () => {
    for (const stop of STORY_STOPS) {
      const v = STORY_INTRO_VARIANTS[stop.id]!;
      expect(v.second.length, `${stop.id} second`).toBeGreaterThanOrEqual(3);
      expect(v.grind.length, `${stop.id} grind`).toBeGreaterThanOrEqual(3);
      expect(v.champion.length, `${stop.id} champion`).toBeGreaterThanOrEqual(3);
      const joined = (bs: { line: string }[]) => bs.map((b) => b.line).join('|');
      expect(joined(v.second)).not.toBe(joined(v.grind));
      expect(joined(v.second)).not.toBe(joined(STORY_SCRIPTS[stop.id]!.intro));
      expect(joined(v.grind)).not.toBe(joined(STORY_SCRIPTS[stop.id]!.intro));
    }
    // Porch attempt-2 opens by remembering, not introducing
    expect(STORY_INTRO_VARIANTS.porch!.second[0]!.line).toMatch(/back|again|rematch/i);
  });

  it('continuity lines fire ONLY when their stored fact holds', () => {
    const shop = STORY_STOPS[1]!;
    const without = beatsFor(shop, 'intro', { attempts: 0, cleared: false }).map((b) => b.line).join(' ');
    const withPorch = beatsFor(shop, 'intro', { attempts: 0, cleared: false, clearedStopIds: ['porch'] }).map((b) => b.line).join(' ');
    expect(without).not.toContain('Ray’s porch first, then my shop');
    expect(withPorch).toContain('Ray’s porch first, then my shop');
    const pjs = STORY_STOPS[8]!;
    expect(beatsFor(pjs, 'intro', { attempts: 0, cleared: false }).map((b) => b.line).join(' ')).not.toContain('in the old order. Respect that');
    expect(beatsFor(pjs, 'intro', { attempts: 0, cleared: false, clearedStopIds: ['porch'] }).map((b) => b.line).join(' ')).toContain('in the old order. Respect that');
  });

  it("Dee's arc bands: green early, believing mid-route, belonging late", () => {
    expect(deeStageForStop(1)).toBe('green');
    expect(deeStageForStop(3)).toBe('green');
    expect(deeStageForStop(5)).toBe('believing');
    expect(deeStageForStop(7)).toBe('believing');
    expect(deeStageForStop(9)).toBe('belonging');
    expect(deeStageForStop(11)).toBe('belonging');
  });

  it('mid-scenes, exchanges, threaded beats and callbacks are complete for every stop', () => {
    for (const stop of STORY_STOPS) {
      for (const m of ['firstHand', 'signature', 'pullAwayUs', 'pullAwayThem', 'nilAttempt', 'matchPoint', 'finalHand'] as const) {
        expect(STORY_MID_SCENES[stop.id]![m].length, `${stop.id}.${m}`).toBeGreaterThan(0);
      }
      for (const m of ['firstHand', 'nilAttempt', 'matchPoint', 'finalHand'] as const) {
        expect(midSceneFor(stop, m, null, { attempts: 0, cleared: false }).length, `${stop.id} mid ${m}`).toBeGreaterThan(0);
      }
      expect(midSceneFor(stop, 'pullAway', 'us', { attempts: 0, cleared: false }).length).toBeGreaterThan(0);
      expect(midSceneFor(stop, 'pullAway', 'them', { attempts: 0, cleared: false }).length).toBeGreaterThan(0);
      expect(STORY_TABLE_EXCHANGES[stop.id]!.won.length).toBeGreaterThan(0);
      expect(STORY_TABLE_EXCHANGES[stop.id]!.lost.length).toBeGreaterThan(0);
      expect(tableExchangeFor(stop, true).length).toBeGreaterThan(0);
      expect(STORY_SIT_DOWN[stop.id]!.length).toBeGreaterThan(0);
      expect(STORY_BID_REACT[stop.id]!.length).toBeGreaterThan(0);
      expect(STORY_RETRY_FIRST[stop.id]!.length).toBeGreaterThan(0);
      expect(STORY_PLAY_REACTS[stop.id]!.joker.length).toBeGreaterThan(0);
      expect(STORY_PLAY_REACTS[stop.id]!.cut.length).toBeGreaterThan(0);
      expect(STORY_CALLBACKS[stop.id]!.nilBusted.length).toBeGreaterThan(0);
      expect(STORY_CALLBACKS[stop.id]!.bigSwing.length).toBeGreaterThan(0);
      expect(STORY_CALLBACKS[stop.id]!.deeNilMade.length).toBeGreaterThan(0);
      expect(callbackFor(stop, 'nilBusted').length).toBeGreaterThan(0);
      expect(callbackFor(stop, 'deeNilMade').length).toBeGreaterThan(0);
      expect(midSceneFor(stop, 'midgame', null, { attempts: 0, cleared: false })).toBe(STORY_MID_SCENES[stop.id]!.signature);
      expect(playBeatFor(stop, 'sitDown').length).toBeGreaterThan(0);
      // all speakers in the threaded records are this table's cast
      const allowed = new Set([...stop.pair, 'dee', 'you']);
      for (const rec of [STORY_MID_SCENES[stop.id]!.firstHand, STORY_MID_SCENES[stop.id]!.signature, STORY_SIT_DOWN[stop.id]!, STORY_CALLBACKS[stop.id]!.bigSwing, STORY_CALLBACKS[stop.id]!.deeNilMade]) {
        for (const b of rec) expect(allowed.has(b.speaker), `${stop.id}: ${b.speaker}`).toBe(true);
      }
    }
    // a retry game's first hand acknowledges the history
    const porch = STORY_STOPS[0]!;
    expect(midSceneFor(porch, 'firstHand', null, { attempts: 1, cleared: false })).toBe(STORY_RETRY_FIRST.porch);
    expect(midSceneFor(porch, 'firstHand', null, { attempts: 0, cleared: false })).toBe(STORY_MID_SCENES.porch!.firstHand);
  });

  it('the match carries the story: a signature beat + a full progression spine at every stop', () => {
    for (const stop of STORY_STOPS) {
      const set = STORY_MID_SCENES[stop.id]!;
      const spine = [set.firstHand, set.signature, set.pullAwayUs, set.pullAwayThem, set.nilAttempt, set.matchPoint, set.finalHand];
      // at least three progression-keyed story sets fire across a match
      expect(spine.filter((x) => x.length > 0).length, `${stop.id} progression sets`).toBeGreaterThanOrEqual(3);
      // the signature beat is a real beat, not a one-liner — the displaced intro arc lives here
      expect(set.signature.length, `${stop.id} signature`).toBeGreaterThanOrEqual(3);
      // Dee's own made nil earns an endgame callback at every stop (memory-gated in Table)
      expect(STORY_CALLBACKS[stop.id]!.deeNilMade.length, `${stop.id} deeNilMade`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('identity legibility + voice casting (all 23 characters)', () => {
  it('every character resolves to their card gender in BOTH voice paths — no hash coin-flips', () => {
    for (const c of Object.values(STORY_CHARACTERS)) {
      expect(nameGender(c.name), `${c.name} nameGender`).toBe(c.gender);
      expect(voiceGender(c.name), `${c.name} voiceGender`).toBe(c.gender);
      // recorded sprite key: persona + gender
      expect(voiceFor(c.personaId, c.name).gender, `${c.name} recorded gender`).toBe(c.gender);
      expect(voiceFor(c.personaId, c.name).key, `${c.name} recorded key`).toBe(`${c.personaId}-${c.gender}`);
      // story cast: card gender, American Kokoro voice, en-US
      const cast = STORY_VOICE_CAST[c.id]!;
      expect(cast, `${c.id} cast`).toBeDefined();
      expect(cast.gender, `${c.id} cast gender`).toBe(c.gender);
      expect(cast.kokoro.startsWith('a'), `${c.id} cast voice is American (${cast.kokoro})`).toBe(true);
      expect(storyVoiceKey(c.id).endsWith(`-${c.gender}`), `${c.id} story key`).toBe(true);
      expect(storyCastForName(c.name)?.characterId).toBe(c.id);
      // presentation: a role line and full tape context
      expect(c.role.length, `${c.id} role`).toBeGreaterThan(3);
      for (const k of ['who', 'knownFor', 'style', 'bond'] as const) expect(c.tape[k].length, `${c.id} tape.${k}`).toBeGreaterThan(10);
    }
  });

  it("Pat and Uncle Ray, named: she resolves female storyteller, he resolves an American elder — never a Brit, never Santa", () => {
    expect(voiceGender('Pat')).toBe('f');
    expect(voiceFor('storyteller', 'Pat').key).toBe('storyteller-f');
    expect(voiceFor('storyteller', 'Pat').voice).toBe('af_sarah');
    const pat = STORY_VOICE_CAST.pat!;
    expect(pat.gender).toBe('f');
    expect(pat.kokoro).toBe('af_sarah');
    const ray = STORY_VOICE_CAST.uncleRay!;
    expect(ray.gender).toBe('m');
    expect(ray.persona).toBe('storyteller'); // recast from comedian
    expect(ray.kokoro).toBe('am_onyx');
    expect(ray.kokoro.startsWith('am_')).toBe(true);
  });

  it('portrait paths resolve by character id (art pass convention)', () => {
    for (const c of Object.values(STORY_CHARACTERS)) {
      expect(storyPortraitFor(c.id)).toBe(`/assets/story/portraits/${c.id}.webp`);
    }
    expect(storyPortraitFor('pat')).toBe('/assets/story/portraits/pat.webp');
  });
});

describe('secrets: eggs + unlockables', () => {
  it('every stop has one egg (valid trigger) and one unlockable', () => {
    for (const stop of STORY_STOPS) {
      const s = STORY_SECRETS[stop.id]!;
      expect(s, stop.id).toBeDefined();
      expect(s.egg.id.length).toBeGreaterThan(3);
      expect(s.egg.name.length).toBeGreaterThan(3);
      expect(s.egg.hint.length).toBeGreaterThan(10);
      expect(['sceneTap', 'deeTap', 'matchEvent', 'chain']).toContain(s.egg.trigger.type);
      if (s.egg.trigger.type !== 'matchEvent') expect(s.egg.beat?.length, `${stop.id} egg beats`).toBeGreaterThan(0);
      expect(s.unlockable.itemId.startsWith('story-')).toBe(true);
      expect(s.unlockable.name.length).toBeGreaterThan(5);
      expect(s.unlockable.featText.length).toBeGreaterThan(10);
      expect(stop.stakes.length, `${stop.id} stakes`).toBeGreaterThan(20);
    }
  });

  it('feat evaluation is honest: granted on the real fact, not without it', () => {
    // Porch: clean clear
    expect(storyFeatMet('porch', facts({ setsAgainstUs: 0 }), true)).toBe(true);
    expect(storyFeatMet('porch', facts({ setsAgainstUs: 1 }), true)).toBe(false);
    expect(storyFeatMet('porch', facts({ setsAgainstUs: 0 }), false)).toBe(false); // needsWin
    // Church: a made nil grants even on a loss
    expect(storyFeatMet('church-basement', facts({ ourNilsMade: 1 }), false)).toBe(true);
    expect(storyFeatMet('church-basement', facts({ ourNilsMade: 0 }), true)).toBe(false);
    // Corner: 150+ margin
    expect(storyFeatMet('corner', facts({ margin: 150 }), true)).toBe(true);
    expect(storyFeatMet('corner', facts({ margin: 149 }), true)).toBe(false);
    // Rooftop: blind nil, win or lose
    expect(storyFeatMet('rooftop', facts({ ourBlindNilsMade: 1 }), false)).toBe(true);
    expect(storyFeatMet('rooftop', facts({ ourNilsMade: 1, ourBlindNilsMade: 0 }), true)).toBe(false);
    // King: the clean crown
    expect(storyFeatMet('king', facts({ setsAgainstUs: 0 }), true)).toBe(true);
    expect(storyFeatMet('king', facts({ setsAgainstUs: 0 }), false)).toBe(false);
  });

  it('match-event eggs key off the recorded event facts only', () => {
    expect(storyEggEventMet('rec-center', 'deeNilMade', facts({ deeNilsMade: 1 }))).toBe(true);
    expect(storyEggEventMet('rec-center', 'deeNilMade', facts({}))).toBe(false);
    expect(storyEggEventMet('corner', 'setOnFirstHand', facts({ setOnFirstHand: true }))).toBe(true);
    expect(storyEggEventMet('the-pjs', 'oppSetTwice', facts({ setsAgainstThem: 2 }))).toBe(true);
    expect(storyEggEventMet('porch', 'deeNilMade', facts({ deeNilsMade: 1 }))).toBe(false); // porch egg is a scene tap, not an event
  });
});

describe('tale of the tape (narrative)', () => {
  it('every stop renders a tape with both adversaries + Dee + the stop stakes', () => {
    for (const stop of STORY_STOPS) {
      const tape = buildStoryTape(stop, { attempts: 0, cleared: false });
      expect(tape.stakes).toBe(stop.stakes);
      expect(tape.pair.map((e) => e.id)).toEqual([...stop.pair]);
      expect(tape.dee.id).toBe('dee');
      expect(tape.you.id).toBe('you');
      for (const e of [tape.dee, ...tape.pair]) {
        expect(e.who.length).toBeGreaterThan(10);
        expect(e.knownFor.length).toBeGreaterThan(10);
        expect(e.style.length).toBeGreaterThan(10);
        expect(e.bond.length).toBeGreaterThan(10);
      }
      expect(tape.threat).toContain('Threat:');
      expect(tape.history).toBeUndefined(); // no fact, no history row
    }
  });

  it("Dee's tape entry evolves by route band", () => {
    const early = buildStoryTape(STORY_STOPS[1]!, { attempts: 0, cleared: false }).dee;
    const late = buildStoryTape(STORY_STOPS[8]!, { attempts: 0, cleared: false }).dee;
    expect(early.knownFor).not.toBe(late.knownFor);
    expect(early.style).not.toBe(late.style);
    expect(deeTapeFor(2).knownFor).toBe(early.knownFor);
    expect(deeTapeFor(9).knownFor).toBe(late.knownFor);
  });

  it('the history row appears ONLY when a stored fact supports it', () => {
    const stop = STORY_STOPS[0]!;
    expect(buildStoryTape(stop, { attempts: 2, cleared: false }).history).toContain('attempt 3');
    expect(buildStoryTape(stop, { attempts: 1, cleared: true, clears: 1 }).history).toContain('hold this table');
    expect(buildStoryTape(stop, { attempts: 0, cleared: false }).history).toBeUndefined();
  });
});


import { RAIL_CAPS, STORY_RAIL, STORY_RAIL_INTRO, STORY_RAIL_LINES, railCapFor, railFor, railIssues, railLineFor } from '../src/storyRail';

describe('railbirds: the neighborhood on the rail', () => {
  it('the rail map is honest: known characters, never seated, never Dee, never met early', () => {
    expect(railIssues()).toEqual([]);
  });

  it('the Porch and the High-Rise run empty rails — for opposite reasons', () => {
    expect(railFor('porch')).toEqual([]); // nobody's been met yet
    expect(railFor('high-rise')).toEqual([]); // nobody from the block belongs in that lobby
    expect(railFor('church-basement')).toEqual(['uncleRay']); // the owner's example
  });

  it('at the King the rail is FULL: every met character, minus the seated pair and Dee', () => {
    const rail = railFor('king');
    expect(rail.length).toBe(20);
    for (const id of ['uncleRay', 'pat', 'mrColeman', 'june', 'keisha', 'smoke', 'sisterMae', 'poet', 'velvet', 'captainBlock', 'queenie', 'ace']) {
      expect(rail, id).toContain(id);
    }
    expect(rail).not.toContain('king');
    expect(rail).not.toContain('ringer');
    expect(rail).not.toContain('dee');
  });

  it('every stop with a rail acknowledges it in the intro scene, and every line speaker is ON that rail', () => {
    for (const [stopId, rail] of Object.entries(STORY_RAIL)) {
      if (!rail.length) continue;
      expect(STORY_RAIL_INTRO[stopId]?.length, stopId).toBeGreaterThan(0);
      for (const pools of Object.values(STORY_RAIL_LINES[stopId] ?? {})) {
        for (const l of pools ?? []) expect(rail, `${stopId}:${l.speaker}`).toContain(l.speaker);
      }
    }
  });

  it('caps hold and rotation is deterministic', () => {
    const facts = { fired: 0, handNo: 2, stopsCleared: 3 };
    const a = railLineFor('cookout', 'jokerDropped', facts);
    expect(a).toEqual(railLineFor('cookout', 'jokerDropped', facts));
    expect(railLineFor('cookout', 'jokerDropped', { ...facts, fired: 1 })?.speaker).not.toBe(a?.speaker);
    expect(railLineFor('cookout', 'jokerDropped', { ...facts, fired: railCapFor('cookout') })).toBeNull();
    expect(RAIL_CAPS['corner']).toBe(2); // the grit stops run thin
  });

  it('the King goes quiet after the early hands — except the finalHand witness line', () => {
    expect(railLineFor('king', 'jokerDropped', { fired: 0, handNo: 6, stopsCleared: 10 })).toBeNull();
    expect(railLineFor('king', 'finalHand', { fired: 1, handNo: 9, stopsCleared: 10 })?.speaker).toBe('mrColeman');
  });

  it("Ray's rail memory is fact-keyed: Porch attempts needle, Dee's growth acknowledged", () => {
    const needle = railLineFor('church-basement', 'bigSwing', { fired: 0, handNo: 2, stopsCleared: 5, attemptsAtOwnStop: 3 });
    expect(needle?.line).toContain('get off my porch');
    const growth = railLineFor('church-basement', 'bigSwing', { fired: 0, handNo: 2, stopsCleared: 6, attemptsAtOwnStop: 1 });
    expect(growth?.line).toContain('Look at Dee now');
    const plain = railLineFor('church-basement', 'bigSwing', { fired: 0, handNo: 2, stopsCleared: 2, attemptsAtOwnStop: 1 });
    expect(plain?.line).toContain('fellowship-hall');
  });

  it("the King's outro rail answers both endings", async () => {
    const { beatsFor } = await import('../src/storyScripts');
    const king = STORY_STOPS.find((s) => s.id === 'king')!;
    const win = beatsFor(king, 'outroWin', { attempts: 0, cleared: false });
    expect(win.some((b) => b.speaker === 'uncleRay' && b.line.includes('Tell it right'))).toBe(true);
    const lose = beatsFor(king, 'outroLose', { attempts: 0, cleared: false });
    expect(lose.some((b) => b.speaker === 'uncleRay' && b.line.includes('Nobody’s leaving'))).toBe(true);
  });
});
