/**
 * @vitest-environment happy-dom
 *
 * Story scene pass (web, 2026-10-21): the cinematic scene player (letterbox,
 * cast focus, skip, egg hotspot), the narrative Tale of the Tape, portrait
 * fallback, the story fallback-voice picker (American, card gender — Pat
 * and Uncle Ray named), milestone/event detection from game state, the
 * story save slot (round-trip, separation from the normal save, stale
 * validation, resume on the map), badges (derivation + tap detail), and
 * the /story header regression pins (safe-area + dock slot — the blur the
 * owner screenshotted was the header sitting in the iOS frosted zone with
 * the dock floating over it).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_SCRIPTS, STORY_STOPS, buildStoryTape } from '@spades/bots';
import { makeRules, newGame, type GameState } from '@spades/rules';
import ScriptPlayer, { CLIP_REVEAL_FRACTION, fixedRevealMs, reservedBodyHeight, revealDurationMs } from '../src/story/ScriptPlayer';
import StoryTape from '../src/story/StoryTape';
import StoryFace from '../src/story/StoryFace';
import StoryBadges, { badgeFactsOf } from '../src/story/StoryBadges';
import StoryHome from '../src/story/StoryHome';
import { personaVoiceFor } from '../src/talkPrefs';
import { storyEvents, storyFactsOf, storyMilestones, storySnap } from '../src/story/storyScene';
import { clearStoryGame, loadStoryGame, saveStoryGame, storySaveValidFor, STORY_SAVE_KEY, type StorySavedGame } from '../src/story/storySave';
import { SAVE_KEY, saveGame } from '../src/save';
import { DEFAULT_SETTINGS } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  roots.push(root);
  await act(async () => { root.render(el); });
  return c;
}
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
  localStorage.clear();
});

const porch = STORY_STOPS[0]!;
const BEATS = [
  { speaker: 'uncleRay', line: 'First line, short.' },
  { speaker: 'pat', line: 'Second line, also short.' },
  { speaker: 'dee', line: 'Third line lands it.' },
];

describe('scene player', () => {
  it('letterbox + cast focus: the current speaker is lit, the rest dimmed; focus moves on advance; skip works', async () => {
    const onDone = vi.fn();
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: BEATS, cta: 'To the table', onDone, bgUrl: '/assets/venues/grandma/bg.jpg',
      cast: ['uncleRay', 'dee', 'pat'],
    }));
    expect(c.querySelectorAll('.story-bar').length).toBe(2); // letterbox bars
    expect(c.querySelector('.story-scene-bg')).toBeTruthy(); // venue backdrop behind the scene
    const ray = c.querySelector('[data-testid="story-cast-uncleRay"]')!;
    const pat = c.querySelector('[data-testid="story-cast-pat"]')!;
    expect(ray.getAttribute('data-active')).toBe('true');
    expect(pat.getAttribute('data-active')).toBe('false');
    // tap completes the reveal, tap again advances — focus moves to Pat
    await click(c.querySelector('[data-testid="story-script-next"]')!);
    await click(c.querySelector('[data-testid="story-script-next"]')!);
    expect(c.querySelector('[data-testid="story-cast-pat"]')!.getAttribute('data-active')).toBe('true');
    expect(c.querySelector('[data-testid="story-cast-uncleRay"]')!.getAttribute('data-active')).toBe('false');
    await click(c.querySelector('[data-testid="story-script-skip"]')!);
    expect(onDone).toHaveBeenCalled();
  });

  it('railbirds stand on the rail in the scene frame (portraits, set back from the cast)', async () => {
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: BEATS, cta: 'Go', onDone: () => {}, bgUrl: '/assets/venues/church/bg.jpg',
      cast: ['deaconFord', 'dee', 'sisterMae'], rail: ['uncleRay'],
    }));
    const railEl = c.querySelector('[data-testid="story-rail"]')!;
    expect(railEl).toBeTruthy();
    expect(railEl.querySelector('img')!.getAttribute('src')).toBe('/assets/story/portraits/uncleRay.webp');
    // the rail is not the cast: Ray has no cast medallion here
    expect(c.querySelector('[data-testid="story-cast-uncleRay"]')).toBeNull();
  });

  it('the scene egg hotspot fires the find once', async () => {
    const onEggFound = vi.fn();
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: BEATS, cta: 'Go', onDone: () => {}, cast: ['uncleRay', 'dee', 'pat'],
      egg: { trigger: 'sceneTap' as const, ready: false, beats: [{ speaker: 'pat', line: 'A secret.' }] },
      onEggFound,
    }));
    const spot = c.querySelector('[data-testid="story-egg-hotspot"]')!;
    expect(spot).toBeTruthy();
    await click(spot);
    expect(onEggFound).toHaveBeenCalledTimes(1);
  });

  it('eggs stay reachable in the SHORT rebalance intros: the hotspot is live on the last beat too', async () => {
    const onEggFound = vi.fn();
    const beats = STORY_SCRIPTS.porch!.intro; // the trimmed 5-beat sit-down
    const c = await renderEl(createElement(ScriptPlayer, {
      beats, cta: 'Go', onDone: () => {}, cast: ['uncleRay', 'dee', 'pat'],
      egg: { trigger: 'sceneTap' as const, ready: false, beats: [{ speaker: 'pat', line: 'A secret.' }] },
      onEggFound,
    }));
    expect(c.querySelector('[data-testid="story-egg-hotspot"]')).toBeTruthy();
    // walk to the final beat (one click completes the reveal, the next advances)
    for (let n = 0; n < (beats.length - 1) * 2; n++) await click(c.querySelector('[data-testid="story-script-next"]')!);
    expect(c.querySelector('[data-testid="story-egg-hotspot"]')).toBeTruthy();
    await click(c.querySelector('[data-testid="story-egg-hotspot"]')!);
    expect(onEggFound).toHaveBeenCalledTimes(1);
  });

  it('the deeTap egg fires on the third medallion tap inside a short scene', async () => {
    const onEggFound = vi.fn();
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: STORY_SCRIPTS['church-basement']!.intro, cta: 'Go', onDone: () => {}, cast: ['deaconFord', 'dee', 'sisterMae'],
      egg: { trigger: 'deeTap' as const, ready: false, beats: [{ speaker: 'dee', line: 'A secret.' }] },
      onEggFound,
    }));
    const medallion = c.querySelector('[data-testid="story-cast-dee"]')!;
    await click(medallion);
    await click(medallion);
    expect(onEggFound).not.toHaveBeenCalled();
    await click(medallion);
    expect(onEggFound).toHaveBeenCalledTimes(1);
  });
});

describe('scene player layout reservation (owner: the divs jumped as text typed)', () => {
  // June's Barbershop line from the owner's screenshot — long enough to
  // wrap several rows at phone width, so an unreserved box would grow
  // in steps for its whole reveal.
  const LONG = 'What he’s not saying: half those men are gone now, and the shops on either side of us are nail salons. This table is the last classroom on the block. So we don’t waste lessons.';
  const RES_BEATS = [
    { speaker: 'june', line: LONG },
    { speaker: 'mrColeman', line: 'Short one.' },
  ];
  const renderScene = () => renderEl(createElement(ScriptPlayer, {
    beats: RES_BEATS, cta: 'To the table', onDone: () => {}, cast: ['mrColeman', 'dee', 'june'],
  }));
  // happy-dom has no layout: give the sizer a deterministic rendered
  // height, the way a real browser would lay out the full beat.
  const stubSizerHeight = (c: HTMLElement, h: number) => {
    const sizer = c.querySelector('[data-testid="story-script-sizer"]')!;
    Object.defineProperty(sizer, 'offsetHeight', { value: h, configurable: true });
  };

  it('reservedBodyHeight: the sizer’s fully-rendered height, or 0 when unmeasurable', () => {
    expect(reservedBodyHeight({ offsetHeight: 137 })).toBe(137);
    expect(reservedBodyHeight({ offsetHeight: 0 })).toBe(0);
    expect(reservedBodyHeight(null)).toBe(0);
    expect(reservedBodyHeight(undefined)).toBe(0);
  });

  it('the sizer always renders the FULL line while the visible line is still typing', async () => {
    const c = await renderScene();
    const sizer = c.querySelector('[data-testid="story-script-sizer"]')!;
    expect(sizer.textContent).toContain(LONG); // the whole beat, from the first frame
    const visible = c.querySelector<HTMLElement>('.story-script-body > .story-script-line')!;
    expect(LONG.startsWith(visible.textContent ?? '')).toBe(true); // visible is a prefix (or done)
  });

  it('the body height is the reservation while typing, and changes only when the beat changes', async () => {
    const c = await renderScene();
    const body = () => c.querySelector<HTMLElement>('.story-script-body')!;
    stubSizerHeight(c, 137);
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    expect(body().style.height).toBe('137px'); // reserved for the full line before it finishes typing
    // completing the reveal changes the words only — the box does not move
    await click(c.querySelector('[data-testid="story-script-next"]')!);
    expect(c.querySelector('.story-script-body > .story-script-line')!.textContent).toBe(LONG);
    expect(body().style.height).toBe('137px');
    // advancing reserves the NEXT beat's height (the glide itself is the CSS transition)
    stubSizerHeight(c, 88);
    await click(c.querySelector('[data-testid="story-script-next"]')!);
    expect(body().style.height).toBe('88px');
  });
});

describe('scene player typewriter pacing (owner: the words typed way faster than they were heard)', () => {
  // ~120 chars: the fixed pace for a line this long runs at the 14 ms/char floor.
  const LONG_LINE = 'The house remembers every hand ever played under this roof, and it keeps its own ledger of who paid and who still owes.';
  // Serve sprite manifests (the JSON half of a sprite; the audio half
  // 404s, which load() tolerates — the duration lookup reads the JSON
  // alone). Smoke (og-m) and Queenie (mama-f) are used because no other
  // test in this file loads their sprites (the sprite cache is
  // module-level and would keep the first answer it got).
  const stubVoices = (clipsByKey: Record<string, Record<string, [number, number]>>) => {
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input);
      const m = /\/voices\/v2\/([a-z-]+)\.json/.exec(url);
      if (m) return { ok: true, status: 200, json: async () => ({ clips: clipsByKey[m[1]!] ?? {} }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
  };
  afterEach(() => { vi.unstubAllGlobals(); });
  const visibleLine = (c: HTMLElement) => c.querySelector('.story-script-body > .story-script-line')!.textContent ?? '';
  const hint = (c: HTMLElement) => c.querySelector('.story-script-body > .story-script-hint')!.textContent;
  const settle = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

  it('the pacing math: the fixed pace without a clip, ~92% of the clip with one', () => {
    expect(fixedRevealMs(10)).toBe(300); // short lines linger: 30 ms/char
    expect(fixedRevealMs(30)).toBe(900);
    expect(fixedRevealMs(45)).toBe(900); // 20 ms/char
    expect(fixedRevealMs(100)).toBe(1400); // long lines: the 14 ms/char floor
    expect(revealDurationMs(100, null)).toBe(fixedRevealMs(100));
    expect(revealDurationMs(100, 0)).toBe(fixedRevealMs(100));
    expect(revealDurationMs(100, 4000)).toBe(Math.round(4000 * CLIP_REVEAL_FRACTION));
    expect(CLIP_REVEAL_FRACTION).toBeGreaterThanOrEqual(0.9);
    expect(CLIP_REVEAL_FRACTION).toBeLessThanOrEqual(0.95);
  });

  it('a beat WITH a clip types across the clip, not the fixed pace — and a tap still completes it', async () => {
    stubVoices({ 'og-m': { [LONG_LINE]: [0, 30000] } }); // Smoke's sprite holds a 30 s take of the line
    const beats = [
      { speaker: 'smoke', line: LONG_LINE },
      { speaker: 'dee', line: 'Short follow-up.' },
    ];
    const c = await renderEl(createElement(ScriptPlayer, { beats, cta: 'Go', onDone: () => {}, cast: ['smoke', 'dee', 'redd'] }));
    // well past the moment the fixed pace would have finished the line…
    await settle(fixedRevealMs(LONG_LINE.length) + 800);
    // …the reveal is still early, paced against the voice, and the
    // continue affordance has NOT arrived early (nothing advances —
    // by timer or by hint — before the audio is nearly done)
    expect(visibleLine(c).length).toBeLessThanOrEqual(LONG_LINE.length / 3);
    expect(LONG_LINE.startsWith(visibleLine(c))).toBe(true);
    expect(hint(c)).toBe('Tap for the full line');
    // tap completes the text instantly, exactly as before (the
    // still-playing voice is untouched — typer and audio are separate)
    await click(c.querySelector('[data-testid="story-script-next"]')!);
    expect(visibleLine(c)).toBe(LONG_LINE);
  });

  it('a beat with NO clip keeps the fixed pacing', async () => {
    stubVoices({ 'mama-f': {} }); // Queenie's sprite loads, but this line has no take in it
    const beats = [
      { speaker: 'queenie', line: LONG_LINE },
      { speaker: 'dee', line: 'Short follow-up.' },
    ];
    const c = await renderEl(createElement(ScriptPlayer, { beats, cta: 'Go', onDone: () => {}, cast: ['queenie', 'dee', 'ace'] }));
    await settle(fixedRevealMs(LONG_LINE.length) + 800);
    expect(visibleLine(c)).toBe(LONG_LINE);
    expect(hint(c)).toBe('Tap to continue');
  });
});

describe('tale of the tape (narrative)', () => {
  it('renders both adversaries + Dee + the stakes; the history row appears ONLY with a fact', async () => {
    const c = await renderEl(createElement(StoryTape, { stop: porch, facts: { attempts: 0, cleared: false }, cta: 'Play the scene', onDone: () => {} }));
    expect(c.querySelector('[data-testid="story-tape-uncleRay"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-tape-pat"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-tape-dee"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-tape-stakes"]')!.textContent).toBe(porch.stakes);
    expect(c.querySelector('[data-testid="story-tape-history"]')).toBeNull();
    const c2 = await renderEl(createElement(StoryTape, { stop: porch, facts: { attempts: 2, cleared: false }, cta: 'x', onDone: () => {} }));
    expect(c2.querySelector('[data-testid="story-tape-history"]')!.textContent).toContain('attempt 3');
  });

  it('rows are label/value grid rows (tape rework): four per entry, threat in the same system, You medallioned', async () => {
    const facts = { attempts: 0, cleared: false };
    const c = await renderEl(createElement(StoryTape, { stop: porch, facts, cta: 'Play the scene', onDone: () => {} }));
    // every entry: exactly four detail rows, each one label span + value span
    for (const id of ['you', 'dee', 'uncleRay', 'pat']) {
      const entry = c.querySelector(`[data-testid="story-tape-${id}"]`)!;
      const rows = entry.querySelectorAll('.story-tape-row');
      expect(rows.length).toBe(4);
      expect([...rows].map((r) => r.querySelector('.story-tape-label')!.textContent)).toEqual(['Who', 'Known for', 'The tell', 'The bond']);
      for (const r of rows) expect(r.querySelector('.story-tape-value')!.textContent.length).toBeGreaterThan(0);
    }
    // the threat line rides the same labeled-row system, copy verbatim
    const threatRow = [...c.querySelectorAll('.story-tape-inner > .story-tape-row')]
      .find((r) => r.querySelector('.story-tape-label')!.textContent === 'The threat')!;
    expect(threatRow).toBeTruthy();
    expect(threatRow.querySelector('.story-tape-value')!.textContent).toBe(buildStoryTape(porch, facts).threat);
    // You wears the designed monogram medallion — not the bare initial disc
    expect(c.querySelector('[data-testid="story-tape-you"] .story-you-face')).toBeTruthy();
    // the tape's backdrop is its own layer now, never the scene player's
    expect(c.querySelector('.story-tape-bg')).toBeTruthy();
    expect(c.querySelector('.story-scene-bg')).toBeNull();
  });
});

describe('portraits', () => {
  it('resolve by character id and fall back to the initial medallion on error — no broken image left behind', async () => {
    const c = await renderEl(createElement(StoryFace, { characterId: 'pat', name: 'Pat' }));
    const img = c.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/assets/story/portraits/pat.webp');
    await act(async () => { img.dispatchEvent(new Event('error', { bubbles: true })); });
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('P');
  });
});

describe('story fallback voices: American, card gender', () => {
  const LIST = [
    { name: 'Daniel', lang: 'en-GB' },        // the "old Englishman"
    { name: 'Google UK English Male', lang: 'en-GB' },
    { name: 'Alex', lang: 'en-US' },
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Google UK English Female', lang: 'en-GB' },
  ] as unknown as SpeechSynthesisVoice[];
  it("Pat resolves to an American FEMALE voice, never the British male", () => {
    const v = personaVoiceFor('storyteller', 'Pat', LIST);
    expect(v?.name).toBe('Samantha');
  });
  it('Uncle Ray resolves to an American male voice, never Daniel', () => {
    const v = personaVoiceFor('comedian', 'Uncle Ray', LIST);
    expect(v?.name).toBe('Alex');
  });
  it('a normal (non-story) bot still resolves by the old path', () => {
    const v = personaVoiceFor('comedian', 'Marcus', LIST);
    expect(v).not.toBeNull();
  });
});

describe('milestone + event detection (deterministic from state)', () => {
  const base = () => newGame(makeRules('joker'), 'scene-test');
  it('first hand + nil attempt + pull-away fire from hand results', () => {
    const st = base();
    const s0 = storySnap(st);
    const st2 = {
      ...st, scores: [160, 0],
      history: [{ handNo: 1, bids: ['nil', 4, 3, 4], tricksWon: [0, 6, 3, 4], sides: [
        { side: 0, seats: [0, 2], points: 160, contractMade: true, nils: [{ seat: 0, kind: 'nil', tricks: 0, made: true, points: 100 }] },
        { side: 1, seats: [1, 3], points: 0, contractMade: true, nils: [] },
      ] }],
    } as unknown as GameState;
    const s1 = storySnap(st2);
    const ms = storyMilestones(s0, s1).map((m) => m.milestone);
    expect(ms).toContain('firstHand');
    expect(ms).toContain('nilAttempt');
    expect(ms).toContain('pullAway');
    const evs = storyEvents(s0, s1);
    expect(evs).toContain('nilMade');
    expect(evs).toContain('bigSwing');
  });
  it('a big bid registers when it lands; facts count sets, nils and Dee honestly', () => {
    const st = base();
    const s0 = storySnap({ ...st, bids: [null, null, null, null] } as unknown as GameState);
    const s1 = storySnap({ ...st, bids: [7, null, null, null] } as unknown as GameState);
    expect(storyEvents(s0, s1)).toContain('bigBid');
    const done = {
      ...st, scores: [260, 90],
      history: [
        { handNo: 1, bids: [3, 4, 'nil', 4], tricksWon: [4, 5, 0, 4], sides: [
          { side: 0, seats: [0, 2], points: 130, contractMade: true, nils: [{ seat: 2, kind: 'nil', tricks: 0, made: true, points: 100 }] },
          { side: 1, seats: [1, 3], points: -40, contractMade: false, nils: [] }] },
        { handNo: 2, bids: [4, 3, 4, 3], tricksWon: [5, 4, 3, 1], sides: [
          { side: 0, seats: [0, 2], points: 130, contractMade: true, nils: [] },
          { side: 1, seats: [1, 3], points: 130, contractMade: true, nils: [] }] },
      ],
    } as unknown as GameState;
    const f = storyFactsOf(done);
    expect(f.deeNilsMade).toBe(1);
    expect(f.ourNilsMade).toBe(1);
    expect(f.setsAgainstThem).toBe(1);
    expect(f.setsAgainstUs).toBe(0);
    expect(f.deeSteady).toBe(true); // Dee took a trick and her side made it, both hands
    expect(f.margin).toBe(170);
    expect(f.setOnFirstHand).toBe(true);
  });
  it('midgame (the signature beat’s moment) fires exactly once: on the transition to two completed hands', () => {
    const st = base();
    const hand = (handNo: number, p0: number, p1: number) => ({
      handNo, bids: [3, 4, 3, 3], tricksWon: [4, 5, 3, 1], sides: [
        { side: 0, seats: [0, 2], points: p0, contractMade: true, nils: [] },
        { side: 1, seats: [1, 3], points: p1, contractMade: true, nils: [] }],
    });
    const s0 = storySnap(st);
    const s1 = storySnap({ ...st, scores: [60, 40], history: [hand(1, 60, 40)] } as unknown as GameState);
    const s2 = storySnap({ ...st, scores: [130, 80], history: [hand(1, 60, 40), hand(2, 70, 40)] } as unknown as GameState);
    const s3 = storySnap({ ...st, scores: [200, 120], history: [hand(1, 60, 40), hand(2, 70, 40), hand(3, 70, 40)] } as unknown as GameState);
    expect(storyMilestones(s0, s1).map((m) => m.milestone)).toContain('firstHand');
    expect(storyMilestones(s0, s1).map((m) => m.milestone)).not.toContain('midgame');
    expect(storyMilestones(s1, s2).map((m) => m.milestone)).toEqual(['midgame']);
    expect(storyMilestones(s2, s3).map((m) => m.milestone)).not.toContain('midgame');
  });
  it("Dee's own made nil is its own memory event (her arc), distinct from any nil", () => {
    const st = base();
    const withDeeNil = (made: boolean) => ({
      ...st, scores: [made ? 160 : -60, 0],
      history: [{ handNo: 1, bids: [3, 4, 'nil', 4], tricksWon: [4, 5, 0, 4], sides: [
        { side: 0, seats: [0, 2], points: made ? 160 : -60, contractMade: true, nils: [{ seat: 2, kind: 'nil', tricks: made ? 0 : 2, made, points: made ? 100 : -100 }] },
        { side: 1, seats: [1, 3], points: 0, contractMade: true, nils: [] }] }],
    }) as unknown as GameState;
    const s0 = storySnap(st);
    const madeSnap = storySnap(withDeeNil(true));
    expect(madeSnap.lastHand?.deeNilMade).toBe(true);
    expect(storyEvents(s0, madeSnap)).toContain('deeNilMade');
    const bustedSnap = storySnap(withDeeNil(false));
    expect(bustedSnap.lastHand?.deeNilMade).toBe(false);
    expect(bustedSnap.lastHand?.deeNilBusted).toBe(true);
    expect(storyEvents(s0, bustedSnap)).toContain('nilBusted');
    expect(storyEvents(s0, bustedSnap)).not.toContain('deeNilMade');
  });
});

describe('story save slot', () => {
  const mkSave = (): StorySavedGame => {
    const st = newGame(makeRules('joker'), 'story-seed');
    return {
      v: 1, savedAt: 1, seed: 'story-seed', settings: DEFAULT_SETTINGS, state: st, chat: [],
      names: ['You', 'Uncle Ray', 'Dee', 'Pat'],
      story: { stopId: 'porch', track: 'solo', attemptsAtStart: 1, clearsAtStart: 0, session: { fired: ['firstHand'], memory: ['bigSwing'], satDown: true, railFired: 2, lastRailHand: 3 } },
    };
  };
  it('round-trips engine state + story wrapper + session state', () => {
    const s = mkSave();
    saveStoryGame(s, s.story);
    const back = loadStoryGame()!;
    expect(back).toBeTruthy();
    expect(back.seed).toBe('story-seed');
    expect(back.state.handNo).toBe(s.state.handNo);
    expect(back.story.stopId).toBe('porch');
    expect(back.story.attemptsAtStart).toBe(1);
    expect(back.story.session.fired).toEqual(['firstHand']);
    expect(back.story.session.memory).toEqual(['bigSwing']);
    expect(back.story.session.satDown).toBe(true);
    expect(back.story.session.railFired).toBe(2);
    expect(back.story.session.lastRailHand).toBe(3);
  });
  it('is a separate slot: story save/clear never touches the normal save, and vice versa', () => {
    const st = newGame(makeRules('joker'), 'normal-seed');
    saveGame({ seed: 'normal-seed', settings: DEFAULT_SETTINGS, state: st, chat: [] });
    const before = localStorage.getItem(SAVE_KEY);
    const s = mkSave();
    saveStoryGame(s, s.story);
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    clearStoryGame();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(localStorage.getItem(STORY_SAVE_KEY)).toBeNull();
    expect(loadStoryGame()).toBeNull();
  });
  it('stale validation: progress that moved on (attempts/clears changed, stop locked) kills the save', () => {
    const s = mkSave();
    const prog = (over: object) => ({
      track: 'solo', currentStop: 1, completed: false, completedAt: null, completionMark: null,
      finds: { eggs: [], feats: [] },
      stops: STORY_STOPS.map((x) => ({ stopId: x.id, n: x.n, state: x.id === 'porch' ? 'current' : 'locked', attempts: 0, clears: 0, firstClearedAt: null })),
      ...over,
    }) as never;
    expect(storySaveValidFor(s, prog({}))).toBe(false); // attempts 0 ≠ attemptsAtStart 1
    const matching = prog({});
    (matching as { stops: { attempts: number }[] }).stops[0]!.attempts = 1;
    expect(storySaveValidFor(s, matching)).toBe(true);
    const clearedElsewhere = prog({});
    const st0 = (clearedElsewhere as { stops: { attempts: number; clears: number }[] }).stops[0]!;
    st0.attempts = 2; st0.clears = 1;
    expect(storySaveValidFor(s, clearedElsewhere)).toBe(false);
  });
});

describe('badges', () => {
  it('derivation: earned from real facts only, with the remainder counted', async () => {
    const facts = badgeFactsOf({
      stops: STORY_STOPS.map((s) => ({ stopId: s.id, attempts: s.id === 'porch' ? 1 : 0, clears: s.id === 'porch' ? 1 : 0 })),
      finds: { eggs: ['porch-radio'], feats: [] },
      completed: false,
    });
    const c = await renderEl(createElement(StoryBadges, { facts }));
    expect(c.querySelector('[data-testid="story-badges-count"]')!.textContent).toBe('2 of 13');
    expect(c.querySelector('[data-testid="story-badge-porch-graduate"]')!.getAttribute('data-earned')).toBe('true');
    expect(c.querySelector('[data-testid="story-badge-king-of-the-block"]')!.getAttribute('data-earned')).toBe('false');
    // tap a locked badge: the fair hint shows, no spoiler directions for eggs
    await click(c.querySelector('[data-testid="story-badge-egg-hunter"]')!);
    expect(c.querySelector('[data-testid="story-badge-detail"]')).toBeTruthy();
    // tap an earned badge: how it was earned shows
    await click(c.querySelector('[data-testid="story-badge-porch-graduate"]')!);
    expect(c.querySelector('[data-testid="story-badge-detail"]')!.textContent).toContain('cleared The Porch');
  });
});

describe('map resume', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, storyAccess: true, unlocks: [] }) };
      if (url.includes('/api/story/progress')) return {
        ok: true, status: 200,
        json: async () => ({
          track: 'solo', currentStop: 1, completed: false, completedAt: null, completionMark: null,
          finds: { eggs: [], feats: [] },
          stops: STORY_STOPS.map((s) => ({ stopId: s.id, n: s.n, state: s.id === 'porch' ? 'current' : 'locked', attempts: s.id === 'porch' ? 1 : 0, clears: 0, firstClearedAt: null })),
        }),
      };
      throw new Error(`no network in tests: ${url}`);
    });
  });
  it('a saved match shows Resume on its stop; Restart discards the save with no result posted', async () => {
    const st = newGame(makeRules('joker'), 'map-seed');
    const save: StorySavedGame = {
      v: 1, savedAt: 1, seed: 'map-seed', settings: DEFAULT_SETTINGS, state: st, chat: [], names: ['You', 'Uncle Ray', 'Dee', 'Pat'],
      story: { stopId: 'porch', track: 'solo', attemptsAtStart: 1, clearsAtStart: 0, session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 } },
    };
    saveStoryGame(save, save.story);
    const c = await renderEl(createElement(StoryHome));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(c.querySelector('[data-testid="story-resume-porch"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-inprogress-porch"]')).toBeTruthy();
    await click(c.querySelector('[data-testid="story-restart-porch"]')!);
    expect(localStorage.getItem(STORY_SAVE_KEY)).toBeNull();
    // after discarding, the stop offers the fresh intro path again (tape first)
    expect(c.querySelector('[data-testid="story-tape"]')).toBeTruthy();
  });
});
