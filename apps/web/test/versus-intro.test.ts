/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStoryTape, storyStopById } from '@spades/bots';
import {
  VERSUS_CUES, VERSUS_HOLD_MS, VERSUS_IMPACT_MS, VERSUS_RESOLVE_CUE, VERSUS_ROW_STAGGER_MS,
  VERSUS_STORY_MS, VERSUS_TAPE_MS,
  VersusIntro, VersusStoryTape, VersusTape, bestIndex, markVersusShown, rowWinner, statLineFromCredProfile,
  summarizeSide, versusAlreadyShown, versusCueSchedule, versusDismissReady, versusEligible,
  winPctOf, type VersusModel, type VersusSideView,
} from '../src/VersusIntro';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* ------------------------------------------------ stats honesty */
describe('versus tape: stat lines come from the public cred payload, honestly', () => {
  const payload = {
    rank: { team: { division: 'x', elo: 1000, games: 20, wins: 12, losses: 8, peak: 1300, rank: 1, of: 2 } },
    stats: { team: { elo: 1214, wins: 12, games: 20, winPct: 60, streak: 3 } },
  };
  it('rating is the real ratings-table value (stats.elo), never the 1000 season display seed', () => {
    const line = statLineFromCredProfile(payload as never, 'team');
    expect(line?.rating).toBe(1214);
    expect(line?.wins).toBe(12);
    expect(line?.losses).toBe(8);
    expect(line?.streak).toBe(3);
  });
  it('an unrated human (no rated game yet) has rating null, not the seed', () => {
    const line = statLineFromCredProfile({ rank: { team: { wins: 0, losses: 0, games: 0 } }, stats: { team: { elo: null, wins: 0, games: 0, streak: 0 } } }, 'team');
    expect(line?.rating).toBeNull();
  });
  it('a missing payload is a missing line (guest / fetch failed)', () => {
    expect(statLineFromCredProfile(null, 'team')).toBeNull();
    expect(statLineFromCredProfile({}, 'cutthroat')).toBeNull();
  });
  it('a bot side gets NO stats object at all — no invented numbers', () => {
    expect(summarizeSide([null, null], false)).toBeNull();
    expect(summarizeSide([{ rating: 1500, wins: 9, losses: 1, streak: 4 }], false)).toBeNull(); // even a stray line is dropped for bots
  });
  it('a human side combines: average rating of those rated, summed record, best streak', () => {
    const s = summarizeSide([
      { rating: 1200, wins: 10, losses: 5, streak: 2 },
      { rating: 1300, wins: 4, losses: 6, streak: 5 },
    ], true);
    expect(s).toEqual({ rating: 1250, wins: 14, losses: 11, streak: 5 });
  });
  it('a human side whose payloads carried nothing degrades to all-null (renders —)', () => {
    expect(summarizeSide([null], true)).toEqual({ rating: null, wins: null, losses: null, streak: null });
  });
  it('win % derives from the season record only', () => {
    expect(winPctOf({ rating: null, wins: 12, losses: 8, streak: 0 })).toBe(60);
    expect(winPctOf({ rating: null, wins: 0, losses: 0, streak: 0 })).toBeNull();
    expect(winPctOf(null)).toBeNull();
  });
  it('gold goes to the better number; ties and missing values get none', () => {
    expect(rowWinner(1300, 1200)).toBe('a');
    expect(rowWinner(1100, 1200)).toBe('b');
    expect(rowWinner(1200, 1200)).toBeNull();
    expect(rowWinner(null, 1200)).toBeNull();
    expect(bestIndex([null, 5, 9, 9])).toBe(-1);
    expect(bestIndex([null, 5, 9, 2])).toBe(2);
  });
});

/* ------------------------------------------------ dismissal: the story floor */
describe('versus dismissal: story floor + table ready, never assets alone', () => {
  it('a table ready instantly still waits for the full story', () => {
    expect(versusDismissReady({ storyComplete: false, tableReady: true })).toBe(false);
  });
  it('story done but table not ready holds the finished card', () => {
    expect(versusDismissReady({ storyComplete: true, tableReady: false })).toBe(false);
  });
  it('only story-complete AND ready dismisses', () => {
    expect(versusDismissReady({ storyComplete: true, tableReady: true })).toBe(true);
  });
  it('the beat sheet sums to the ~10s floor: smash ~1.5s, settle, ~2.5s stagger, ~5s readable hold', () => {
    expect(VERSUS_IMPACT_MS).toBe(1500);
    expect(VERSUS_TAPE_MS).toBe(2200);
    expect(VERSUS_STORY_MS).toBe(10_000);
    expect(VERSUS_ROW_STAGGER_MS).toBe(700);
    // rows stagger in over ~2.5s: first row at TAPE+120, four rows at the stagger, .35s row reveal
    expect(3 * VERSUS_ROW_STAGGER_MS + 350).toBeGreaterThanOrEqual(2400);
    // the last row is fully in by HOLD, and the clean hold after it runs ~5s+
    expect(VERSUS_TAPE_MS + 120 + 3 * VERSUS_ROW_STAGGER_MS + 350).toBeLessThanOrEqual(VERSUS_HOLD_MS);
    expect(VERSUS_STORY_MS - VERSUS_HOLD_MS).toBeGreaterThanOrEqual(5000);
  });
});

/* ------------------------------------------------ one-shot per match */
describe('versus eligibility: one-shot per match, never on resume', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  it('a fresh match seed is eligible; after showing, the same seed never replays', () => {
    expect(versusEligible({ seed: 'room42:1' })).toBe(true);
    markVersusShown('room42:1');
    expect(versusAlreadyShown('room42:1')).toBe(true);
    expect(versusEligible({ seed: 'room42:1' })).toBe(false); // refresh mid-game: no replay
  });
  it('a rematch (new seed) plays again', () => {
    expect(versusEligible({ seed: 'room42:2' })).toBe(true);
  });
  it('a resumed save never plays it, and a missing seed never plays it', () => {
    expect(versusEligible({ seed: 'offline-seed-9', resume: true })).toBe(false);
    expect(versusEligible({ seed: null })).toBe(false);
    expect(versusEligible({})).toBe(false);
  });
});

/* ------------------------------------------------ sound cues */
describe('versus sound: cues on the beats, spatial plumbing, reduced silence', () => {
  it('the schedule rides the beat sheet: whooshes in, impact on the collision frame, sting + crowd at the tape', () => {
    const cues = versusCueSchedule(false);
    const whooshes = cues.filter((c) => c.cue === 'versusWhoosh');
    expect(whooshes.map((c) => c.side)).toEqual([-1, 1]); // left side, then right
    expect(cues.find((c) => c.cue === 'versusImpact')?.at).toBe(VERSUS_IMPACT_MS);
    expect(cues.find((c) => c.cue === 'versusSting')?.at).toBeGreaterThanOrEqual(VERSUS_TAPE_MS);
    expect(cues.find((c) => c.cue === 'versusCrowd')?.at).toBeGreaterThanOrEqual(VERSUS_TAPE_MS);
    expect(VERSUS_RESOLVE_CUE).toBe('versusResolve');
  });
  it('reduced motion drops every dramatic cue', () => {
    expect(versusCueSchedule(true)).toEqual([]);
  });
  it('audio engine: versus cues route through the HRTF pipeline with a stereo fallback when spatial is off', () => {
    const audio = read('../src/audio.ts');
    expect(audio).toContain('versusRoute');
    expect(audio).toContain("this.settings.spatial !== false");
    expect(audio).toContain('StereoPannerNode'); // spatial OFF = plain stereo mix, never silence
    expect(audio).toContain('linearRampToValueAtTime'); // entrances travel toward center
    for (const kind of ['versusWhoosh', 'versusImpact', 'versusSting', 'versusCrowd', 'versusResolve']) {
      expect(audio).toContain(`'${kind}'`);
    }
    // layered, not a single beep: the impact stacks crack + thump + reflections
    expect(audio).toContain('versusImpact');
    expect(audio).toContain('room reflection 1');
  });
  it('the component schedules cues through sound.play (SFX channel: mute/volume apply) and silences them when reduced', () => {
    const src = read('../src/VersusIntro.tsx');
    expect(src).toContain('versusCueSchedule(false)');
    expect(src).toContain('sound.play(c.cue');
    expect(src).toContain('sound.play(VERSUS_RESOLVE_CUE');
  });
});

/* ------------------------------------------------ composition */
const teamModel: VersusModel = {
  mode: 'team', kind: 'team',
  sides: [
    { label: 'Shot Callers', members: [{ name: 'Meech', uid: 'u1', isBot: false }, { name: 'LovleyT714', uid: 'u2', isBot: false }] },
    { label: 'Table Bots', members: [{ name: 'Tunde', uid: null, isBot: true }, { name: 'Skye', uid: null, isBot: true }] },
  ],
};
const soloModel: VersusModel = {
  mode: 'solo', kind: 'cutthroat',
  sides: ['Meech', 'Tunde', 'Skye', 'Boo'].map((name, i) => ({
    label: name,
    members: [{ name, uid: i === 0 ? 'u1' : null, isBot: i !== 0 }],
  })),
};

describe('versus composition', () => {
  it('partnership: duo clusters under their team names, VS at center', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: teamModel, reduced: false, ready: false, onStoryComplete: () => {} }));
    expect(html).toContain('versus-intro');
    expect(html).toContain('Shot Callers');
    expect(html).toContain('Meech &amp; LovleyT714');
    expect(html).toContain('Tunde &amp; Skye');
    expect(html).toContain('>VS<');
    // pre-paint (the static render): the story has not started — gate closed,
    // and no skip affordance exists yet (skipping unlocks when the tape lands)
    expect(html).toContain('class="versus team"');
    expect(html).not.toContain('Tap to skip');
  });
  it('cutthroat: a four-way 2×2 convergence, one face per player', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: soloModel, reduced: false, ready: false, onStoryComplete: () => {} }));
    expect(html).toContain('versus-stage solo');
    for (const q of ['q0', 'q1', 'q2', 'q3']) expect(html).toContain(`versus-quad ${q}`);
    for (const name of ['Meech', 'Tunde', 'Skye', 'Boo']) expect(html).toContain(name);
  });
  it('reduced motion renders the finished static card (done + reduced, no skip prompt)', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: teamModel, reduced: true, ready: true, onStoryComplete: () => {} }));
    expect(html).toContain('versus team done reduced');
    expect(html).not.toContain('Tap to skip');
  });
  it('with no stats anywhere the tape drops entirely — nothing fabricated to fill it', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: teamModel, reduced: false, ready: false, onStoryComplete: () => {} }));
    expect(html).not.toContain('versus-tape');
    expect(html).not.toContain('TALE OF THE TAPE');
  });
});

describe('versus tape rendering (resolved stats)', () => {
  const sides: VersusSideView[] = [
    { label: 'Shot Callers', members: [], stats: { rating: 1250, wins: 14, losses: 11, streak: 5 } },
    { label: 'Bots', members: [], stats: null },
  ];
  it('real numbers on the human side, — everywhere for the bot side, and NO gold (no honest comparison exists)', () => {
    const html = renderToStaticMarkup(createElement(VersusTape, { mode: 'team', sides }));
    expect(html).toContain('TALE OF THE TAPE');
    expect(html).toContain('1,250');
    expect(html).toContain('14–11');
    expect(html).toContain('56%');
    expect(html).not.toContain('gold'); // gold means "won the comparison" — a missing number can't lose one
    expect(html).toContain('versus-cell b">—<');  // bot side: the absence marker, never a number
    expect(html).not.toMatch(/versus-cell b[^<]*\d/); // no digit in any bot cell
  });
  it('both sides real: the better number per row goes gold', () => {
    const both: VersusSideView[] = [
      { label: 'A', members: [], stats: { rating: 1250, wins: 14, losses: 11, streak: 5 } },
      { label: 'B', members: [], stats: { rating: 1310, wins: 9, losses: 16, streak: 2 } },
    ];
    const html = renderToStaticMarkup(createElement(VersusTape, { mode: 'team', sides: both }));
    expect(html).toContain('versus-cell b gold">1,310'); // rating: B higher
    expect(html).toContain('versus-cell a gold">14–11'); // record (by win %): A better
    expect(html).toContain('versus-cell a gold">5');     // streak: A longer
  });
  it('the pot line shows only when the pot is known', () => {
    const withPot = renderToStaticMarkup(createElement(VersusTape, { mode: 'team', sides, pot: 2000 }));
    expect(withPot).toContain('Pot 2,000');
    const without = renderToStaticMarkup(createElement(VersusTape, { mode: 'team', sides }));
    expect(without).not.toContain('Pot');
  });
  it('solo tape: four columns, the best value in each row goes gold', () => {
    const solo: VersusSideView[] = [1250, null, 1100, 1300].map((rating, i) => ({
      label: `P${i}`, members: [],
      stats: rating === null ? null : { rating, wins: 3, losses: 1, streak: 1 },
    }));
    const html = renderToStaticMarkup(createElement(VersusTape, { mode: 'solo', sides: solo }));
    expect(html).toContain('1,300');
    expect(html).toContain('gold');
    expect(html).toContain('—');
  });
});

/* ------------------------------------------ story mode: narrative card
 * Owner, 2026-10-21: the Porch versus intro leaked the stock layer three
 * ways — the loader's room line named the venue asset ("GRANDMA'S KITCHEN"),
 * gold headers billed generic team names ("HOMIES" / "SMOOTH OPERATORS")
 * over the already-correct pairing labels, and the tape was the LEAGUE tape
 * (his overall profile stats against an all-"—" bot column). In story mode
 * the intro is a story card: stop name up top (Table wiring, pinned in
 * story-team-names.test.ts), no gold team-name headers, and the tape is the
 * narrative one from buildStoryTape — the same content source as the
 * sit-down tape. The side labels below deliberately carry the OLD generic
 * names to prove story mode never renders them as headers. */
const porch = storyStopById('porch')!;
const storyModel: VersusModel = {
  mode: 'team', kind: 'team',
  story: { tape: buildStoryTape(porch, { attempts: 0, cleared: false }) },
  sides: [
    { label: 'Homies', members: [{ name: 'You', uid: 'u1', isBot: false }, { name: 'Dee', uid: null, isBot: true, storyId: 'dee' }] },
    { label: 'Smooth Operators', members: [{ name: 'Uncle Ray', uid: null, isBot: true, storyId: 'uncleRay' }, { name: 'Pat', uid: null, isBot: true, storyId: 'pat' }] },
  ],
};

describe('versus in story mode: the narrative card, no stock leaks', () => {
  it('renders the story tape: stakes, the pair’s context, Dee’s current entry, the threat line', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: storyModel, reduced: false, ready: false, onStoryComplete: () => {} }));
    expect(html).toContain('versus-story-tape');
    expect(html).toContain('TALE OF THE TAPE');
    expect(html).toContain(porch.stakes); // the stop's own stakes line
    // the pair, from the character cards (buildStoryTape's pair entries)
    expect(html).toContain('Never hurrying, never losing the thread of a hand');
    expect(html).toContain('Remembering exactly what you bid three hands ago');
    // Dee's entry, banded for stop 1 (green)
    expect(html).toContain('Being the kid from Ray’s porch with something to prove.');
    expect(html).toContain('Gentle table'); // the threat line, in plain language
  });

  it('no gold team-name headers and no generic names anywhere on the card', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: storyModel, reduced: false, ready: false, onStoryComplete: () => {} }));
    expect(html).not.toContain('versus-team-name');
    expect(html).not.toContain('Homies');
    expect(html).not.toContain('Smooth Operators');
    // the pairing labels under the portraits — already right — still carry the sides
    expect(html).toContain('You &amp; Dee');
    expect(html).toContain('Uncle Ray &amp; Pat');
  });

  it('no league stat rows in story mode — the league tape never renders', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: storyModel, reduced: false, ready: false, onStoryComplete: () => {} }));
    expect(html).not.toContain('Season record');
    expect(html).not.toContain('Win streak');
    expect(html).not.toContain('Win %');
    expect(html).not.toContain('versus-row'); // league rows are .versus-row; story rows are .versus-story-row
  });

  it('story mode never fetches profiles (the uids gate)', () => {
    const src = read('../src/VersusIntro.tsx');
    expect(src).toContain('if (model.story) return [];');
  });

  it('the history row appears only when a stored fact supports it', () => {
    const fresh = renderToStaticMarkup(createElement(VersusStoryTape, { tape: buildStoryTape(porch, { attempts: 0, cleared: false }) }));
    expect(fresh).not.toContain('Last meeting');
    const rematch = renderToStaticMarkup(createElement(VersusStoryTape, { tape: buildStoryTape(porch, { attempts: 2, cleared: false }) }));
    expect(rematch).toContain('Last meeting: they turned you back. This is attempt 3.');
    const held = renderToStaticMarkup(createElement(VersusStoryTape, { tape: buildStoryTape(porch, { attempts: 3, clears: 2, cleared: true }) }));
    expect(held).toContain('You hold this table — cleared 2×.');
  });

  it('the story tape is the same content the sit-down tape renders (one builder)', () => {
    const tape = buildStoryTape(porch, { attempts: 0, cleared: false });
    const html = renderToStaticMarkup(createElement(VersusStoryTape, { tape }));
    for (const e of [...tape.pair, tape.dee]) {
      expect(html).toContain(e.name);
      expect(html).toContain(e.knownFor);
      expect(html).toContain(e.style);
    }
    expect(html).toContain(tape.threat);
    expect(html).toContain(tape.stakes);
  });

  it('Dee’s versus entry evolves with the route (the King stop reads belonging, not green)', () => {
    const king = storyStopById('king')!;
    const html = renderToStaticMarkup(createElement(VersusStoryTape, { tape: buildStoryTape(king, { attempts: 0, cleared: false }) }));
    expect(html).toContain('Being the reason pairs warn each other about the quiet seat.');
    expect(html).not.toContain('something to prove');
  });

  it('normal games are unchanged: gold team-name headers still render', () => {
    const html = renderToStaticMarkup(createElement(VersusIntro, { model: teamModel, reduced: false, ready: false, onStoryComplete: () => {} }));
    expect(html).toContain('versus-team-name');
    expect(html).toContain('Shot Callers');
    expect(html).not.toContain('versus-story-tape');
  });
});

/* ------------------------------------------------ wiring */
describe('versus wiring: load flow, deal gate, table handoff', () => {
  it('Table renders the intro inside the loader and dismisses on story AND ready', () => {
    const table = read('../src/Table.tsx');
    expect(table).toContain('<VersusIntro');
    expect(table).toContain('versusDismissReady({ storyComplete: versusStoryDone, tableReady: !loading })');
    expect(table).toContain('versusEligible({ seed, resume: !!resume })');
    expect(table).toContain('markVersusShown(seed)');
  });
  it('cards never deal behind the intro: the deal gate holds while the story runs', () => {
    const table = read('../src/Table.tsx');
    expect(table).toContain('if (versusActive && !versusStoryDone) return;');
  });
  it('the pre-deal countdown shows on the loaded table (online first deal only)', () => {
    const table = read('../src/Table.tsx');
    expect(table).toContain('data-testid="predeal-note"');
    expect(table).toContain('st.handNo === 0 && dealAtMs !== null');
    const online = read('../src/online/OnlineTable.tsx');
    expect(online).toContain('dealAt: room.dealAt != null ? clientDeadline(room.dealAt, room.now, Date.now()) : null');
    expect(online).toContain('fetchWagerList'); // pot source for the tape
  });
  it('CSS: smash keyframes exist, finished/reduced states are static, parity is structural (no theme fork)', () => {
    const css = read('../src/styles.css');
    expect(css).toContain('@keyframes versus-shake');
    expect(css).toContain('@keyframes versus-in-left');
    expect(css).toContain('@keyframes versus-flash-pop');
    expect(css).toContain('.versus.done .versus-side');
    expect(css).toContain('.versus.reduced .versus-side');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toContain('html[data-theme="neon"] .versus'); // same card both themes
  });
  it('CSS: beats ride the new sheet, and every beat holds at frame one until the paint gate opens', () => {
    const css = read('../src/styles.css');
    expect(css).toContain('versus-shake .38s ease-out 1.5s both'); // shake on the 1.5s collision frame
    expect(css).toContain('versus-tape-in .45s cubic-bezier(.2,1.3,.4,1) 2.2s both'); // tape lands at 2.2s
    expect(css).toContain('.versus:not(.play) .versus-side'); // pre-paint hold
    expect(css).toContain('animation-play-state: paused');
    expect(css).not.toContain('versus-row-in .4s ease-out 2.2s both'); // the skip hint is state-gated now, not CSS-delayed
  });
});

/* ------------------------------------------ playback: paint gate + skip window
 * Owner report 2026-10-21: "Game loading screen is not long enough." Two of the
 * three causes live in the component's runtime behavior (the third was the
 * floor itself, pinned above): the story clock armed at MOUNT — burning while
 * the phone still showed the previous screen — and the tap-to-skip handler was
 * live from the first frame, so a prod at the loader killed the intro. RAF is
 * a manual queue and timers are vitest fakes, so frames and beats are exact. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('versus playback: paint-gated start, deliberate skip (DOM)', () => {
  let rafQ: { id: number; cb: FrameRequestCallback }[] = [];
  let rafSeq = 0;
  let container: HTMLDivElement;
  let root: Root | null = null;

  const pumpFrame = (ts: number) => {
    const q = rafQ;
    rafQ = [];
    act(() => { for (const f of q) f.cb(ts); });
  };
  const advance = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); };
  const mountIntro = (props: { reduced: boolean; ready: boolean; onStoryComplete: () => void }) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(createElement(VersusIntro, { model: teamModel, ...props })); });
    return container.querySelector('[data-testid="versus-intro"]')!;
  };
  const tap = (el: Element) => { act(() => { el.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); }); };

  beforeEach(() => {
    rafQ = [];
    rafSeq = 0;
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = ++rafSeq; rafQ.push({ id, cb }); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQ = rafQ.filter((f) => f.id !== id); });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // profile payloads never land here; not what these tests measure
  });
  afterEach(() => {
    act(() => { root?.unmount(); });
    root = null;
    container?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('the story clock does not run before first paint — it measures from the gate, not from mount', () => {
    const done = vi.fn();
    const el = mountIntro({ reduced: false, ready: true, onStoryComplete: done });
    // mount + a full story's worth of wall time, but no painted frame yet:
    advance(VERSUS_STORY_MS + 5000);
    expect(done).not.toHaveBeenCalled();
    expect(el.className).not.toContain('play');
    expect(el.className).not.toContain('done');
    // two painted frames open the gate; the beats (and CSS) start now
    pumpFrame(16);
    pumpFrame(32);
    expect(el.className).toContain('play');
    advance(VERSUS_STORY_MS - 1);
    expect(done).not.toHaveBeenCalled();
    advance(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(el.className).toContain('done');
  });

  it('a tap during the entrance/smash does NOT skip; once the tape is up, a tap finishes the card', () => {
    const done = vi.fn();
    const el = mountIntro({ reduced: false, ready: true, onStoryComplete: done });
    pumpFrame(16);
    pumpFrame(32);
    advance(VERSUS_TAPE_MS - 1); // entrances + smash have played; tape not up yet
    expect(container.textContent).not.toContain('Tap to skip');
    tap(el); // the accidental prod
    expect(done).not.toHaveBeenCalled();
    expect(el.className).not.toContain('done');
    advance(1); // tape lands — skipping unlocks and the hint shows
    expect(container.textContent).toContain('Tap to skip');
    tap(el);
    expect(done).toHaveBeenCalledTimes(1);
    expect(el.className).toContain('done');
  });

  it('reduced motion skips the gate entirely: the static card completes on mount', () => {
    const done = vi.fn();
    const el = mountIntro({ reduced: true, ready: true, onStoryComplete: done });
    expect(done).toHaveBeenCalledTimes(1);
    expect(el.className).toContain('done');
    expect(el.className).toContain('reduced');
  });
});
