import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type GameResult, type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { STORY_STOPS } from '@spades/bots';
import {
  SET_ANIMS, isThirdSetEnd, resolveSetAnim, setAnimForStop, setAnimStopForVenue,
  setAnimUnlockLine, setAnimUnlockNotice, setAnimUnlocked, setTierForCover,
} from '../src/setAnims';
import { clearedStopIds } from '../src/storyDecks';
import type { StoryProgress } from '../src/story/storyApi';
import { SetCover } from '../src/animfx/SetCover';
import { SetAnimPicker } from '../src/SetAnimPicker';
import { Intermission } from '../src/Intermission';
import { normalizeSettings } from '../src/settings';
import { clearTeamHoles } from '../src/shotMarks';

const stopRow = (stopId: string, clears: number) => ({ stopId, n: 1, state: (clears > 0 ? 'cleared' : 'available') as StoryProgress['stops'][number]['state'], attempts: clears + 1, clears, firstClearedAt: clears ? 1 : null });
const progress = (rows: ReturnType<typeof stopRow>[]): StoryProgress => ({ track: 'solo', stops: rows, currentStop: null, completed: false, completedAt: null, completionMark: null });
const clearedOf = (...ids: string[]) => clearedStopIds(progress(ids.map((id) => stopRow(id, 1))));

describe('the roster: one set animation per story stop, both tiers', () => {
  it('covers all 11 stops, in route order, each with a name and its venue', () => {
    expect(SET_ANIMS).toHaveLength(11);
    expect(SET_ANIMS.map((a) => a.stopId)).toEqual(STORY_STOPS.map((s) => s.id));
    for (const a of SET_ANIMS) {
      expect(a.name.length).toBeGreaterThan(2);
      expect(a.blurb.length).toBeGreaterThan(10);
      expect(a.venueId).toBe(STORY_STOPS.find((s) => s.id === a.stopId)!.venueId);
    }
  });

  it('renders a cover for every stop × tier (22 treatments registered)', () => {
    for (const a of SET_ANIMS) {
      for (const tier of ['regular', 'finale'] as const) {
        const html = renderToStaticMarkup(createElement(SetCover, { animId: a.stopId, tier, mode: 'fresh', reduced: false, side: 1 }));
        expect(html).toContain(`data-anim="${a.stopId}"`);
        expect(html).toContain(`data-tier="${tier}"`);
        expect(html).toContain('data-testid="recap-setanim-1"');
      }
    }
  });

  it('finale treatments are escalations, not copies: finale-only elements exist per stop that has them', () => {
    const finaleExtras: Record<string, string> = {
      corner: 'sc-lock', cookout: 'sc-lid', legends: 'sc-plaque', rooftop: 'sc-feather', 'church-basement': 'sc-halo',
    };
    for (const [stopId, cls] of Object.entries(finaleExtras)) {
      const reg = renderToStaticMarkup(createElement(SetCover, { animId: stopId, tier: 'regular', mode: 'fresh', reduced: false, side: 0 }));
      const fin = renderToStaticMarkup(createElement(SetCover, { animId: stopId, tier: 'finale', mode: 'fresh', reduced: false, side: 0 }));
      expect(reg).not.toContain(cls);
      expect(fin).toContain(cls);
    }
  });

  it('reduced / static renders the end state with the name tag, never the fresh motion classes', () => {
    const html = renderToStaticMarkup(createElement(SetCover, { animId: 'porch', tier: 'finale', mode: 'fresh', reduced: true, side: 0 }));
    expect(html).toContain('static');
    expect(html).toContain('Screen Door Slam · Finale');
  });

  it('an unknown animation id renders nothing', () => {
    expect(renderToStaticMarkup(createElement(SetCover, { animId: 'nope', tier: 'regular', mode: 'fresh', reduced: false, side: 0 }))).toBe('');
  });
});

describe('unlock derivation (story clears are the ledger, like the decks)', () => {
  it('a cleared stop unlocks BOTH tiers of its animation; an uncleared one stays locked', () => {
    const cleared = clearedOf('porch');
    const porch = setAnimForStop('porch')!;
    expect(setAnimUnlocked(porch, cleared)).toBe(true);
    // one unlock, both tiers: tier is a cover fact at play time, not a second grant
    expect(setTierForCover({ tape: true, sheet: false })).toBe('regular');
    expect(setTierForCover({ tape: true, sheet: true })).toBe('finale');
    expect(setAnimUnlocked(setAnimForStop('corner')!, cleared)).toBe(false);
  });

  it('signed-out / no progress and still-loading both count as locked', () => {
    for (const a of SET_ANIMS) {
      expect(setAnimUnlocked(a, clearedStopIds(null))).toBe(false);
      expect(setAnimUnlocked(a, null)).toBe(false);
    }
  });

  it('locked rows name their stop; the King is the route finish', () => {
    expect(setAnimUnlockLine(setAnimForStop('the-pjs')!)).toBe("Clear The Pj's in Story Mode");
    expect(setAnimUnlockLine(setAnimForStop('porch')!)).toBe('Clear The Porch in Story Mode');
    expect(setAnimUnlockLine(setAnimForStop('king')!)).toContain('Finish the route');
  });

  it('the outro notice follows the deck pattern and covers both tiers in one line', () => {
    expect(setAnimUnlockNotice('porch')).toBe('New set animation unlocked: Screen Door Slam');
    expect(setAnimUnlockNotice('king')).toBe('New set animation unlocked: The Crown Settles');
    expect(setAnimUnlockNotice('nope')).toBeNull();
    expect(setAnimUnlockNotice(null)).toBeNull();
  });
});

describe('tier resolution: the finale keys off the cover fact, never a reason list', () => {
  it('sheet → finale, tape → regular, neither → null', () => {
    expect(setTierForCover({ tape: false, sheet: true })).toBe('finale');
    expect(setTierForCover({ tape: true, sheet: false })).toBe('regular');
    expect(setTierForCover({ tape: false, sheet: false })).toBeNull();
  });
  it('a hand-1 elimination carries tape AND sheet — the finale wins', () => {
    expect(setTierForCover({ tape: true, sheet: true })).toBe('finale');
  });
});

describe('resolution: house rule, earned-only elsewhere, NO free defaults', () => {
  const base = { venueId: null as string | null, setting: 'auto', cleared: new Set<string>() as ReadonlySet<string> | null, causedByViewer: true };

  it('at a story stop the house animation plays, earned or not, caused by anyone', () => {
    expect(resolveSetAnim({ ...base, storyStopId: 'porch', causedByViewer: false })).toBe('porch');
    expect(resolveSetAnim({ ...base, storyStopId: 'king', cleared: null })).toBe('king');
    expect(resolveSetAnim({ ...base, storyStopId: 'nope' })).toBeNull();
  });

  it('nothing earned + not at a story stop → NO animation, both tiers, no fallback', () => {
    // regular tier context (a plain set) and finale tier context (a game-ending
    // set) resolve identically here: the tier is chosen by the cover, the
    // animation by this function — with no unlocks there is nothing to play.
    expect(resolveSetAnim({ ...base, venueId: 'grandma', setting: 'auto' })).toBeNull();
    expect(resolveSetAnim({ ...base, venueId: 'classic', setting: 'porch' })).toBeNull();
    expect(resolveSetAnim({ ...base, venueId: null, setting: 'auto', cleared: null })).toBeNull();
  });

  it('non-story: only sets the viewer caused play their animation', () => {
    const cleared = clearedOf('porch');
    expect(resolveSetAnim({ ...base, cleared, setting: 'porch', causedByViewer: false })).toBeNull();
    expect(resolveSetAnim({ ...base, cleared, setting: 'porch', causedByViewer: true })).toBe('porch');
  });

  it('equipped: an earned animation plays at any venue; a locked one never does', () => {
    const cleared = clearedOf('legends');
    expect(resolveSetAnim({ ...base, cleared, setting: 'legends', venueId: 'classic' })).toBe('legends');
    expect(resolveSetAnim({ ...base, cleared, setting: 'porch', venueId: 'vegas' })).toBeNull();
  });

  it('Match the room: the venue stop plays when earned, nothing when not', () => {
    expect(resolveSetAnim({ ...base, cleared: clearedOf('porch'), venueId: 'grandma' })).toBe('porch');
    expect(resolveSetAnim({ ...base, cleared: clearedOf('porch'), venueId: 'vegas' })).toBeNull();
    expect(resolveSetAnim({ ...base, cleared: clearedOf('legends'), venueId: 'vegas' })).toBe('legends');
    expect(resolveSetAnim({ ...base, cleared: clearedOf('legends'), venueId: 'nowhere' })).toBeNull();
  });

  it("venue sharing: the block (blockAfterDark) matches The Pj's; the King is stop-only", () => {
    expect(setAnimStopForVenue('blockAfterDark')).toBe('the-pjs');
    expect(resolveSetAnim({ ...base, cleared: clearedOf('king'), venueId: 'blockAfterDark' })).toBeNull();
    expect(resolveSetAnim({ ...base, cleared: clearedOf('the-pjs'), venueId: 'blockAfterDark' })).toBe('the-pjs');
  });
});

describe('the picker: full roster visible, locked grayed, equip only when earned', () => {
  const render = (cleared: ReadonlySet<string> | null, value = 'auto') =>
    renderToStaticMarkup(createElement(SetAnimPicker, { value, onChange: () => {}, cleared }));

  it('with nothing earned, every stop row is disabled with its unlock line; auto stays available', () => {
    const html = render(new Set());
    expect(html).toContain('data-testid="setanim-opt-auto"');
    expect(html).not.toContain('disabled="" data-testid="setanim-opt-auto"');
    for (const a of SET_ANIMS) {
      expect(html).toContain(`data-testid="setanim-opt-${a.stopId}"`);
      // SSR escapes apostrophes (The Pj's → The Pj&#x27;s) in the raw markup
      expect(html).toContain(setAnimUnlockLine(a).replace(/'/g, '&#x27;'));
    }
    expect(html).toContain('🔒');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(11);
  });

  it('an earned stop is enabled and shows its blurb instead of the unlock line', () => {
    const html = render(clearedOf('porch'));
    expect(html).toContain('The screen door slams');
    expect(html).not.toContain('Clear The Porch in Story Mode');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(10);
  });

  it('still-loading progress (null) shows the whole roster locked', () => {
    expect((render(null).match(/disabled=""/g) ?? []).length).toBe(11);
  });
});

describe('the setting itself: stored safely', () => {
  it("normalizeSettings keeps 'auto' and real stop ids, repairs junk to 'auto'", () => {
    expect(normalizeSettings({}).setAnim).toBe('auto');
    expect(normalizeSettings({ setAnim: 'porch' }).setAnim).toBe('porch');
    expect(normalizeSettings({ setAnim: 'caution-tape' }).setAnim).toBe('auto');
    expect(normalizeSettings({ setAnim: 42 as never }).setAnim).toBe('auto');
  });
});

describe('3 THE HARD WAY: the third-set ending callout', () => {
  it('fires iff the result ended by the third-set reason', () => {
    expect(isThirdSetEnd({ endReason: 'third-set' } as GameResult)).toBe(true);
    expect(isThirdSetEnd({ endReason: 'shotOut' } as GameResult)).toBe(false);
    expect(isThirdSetEnd({ endReason: 'target' } as GameResult)).toBe(false);
    expect(isThirdSetEnd({ endReason: 'floor' } as GameResult)).toBe(false);
    expect(isThirdSetEnd(null)).toBe(false);
    expect(isThirdSetEnd(undefined)).toBe(false);
  });
});

/* ---- the recap surface: Intermission integration ---- */

function toHandOver(mode: 'joker' | 'cutthroat'): GameState {
  const rules = mode === 'cutthroat' ? makeRules('cutthroat', { playerCount: 3, targetScore: 300 }) : makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, `setanim-${mode}`);
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

function stamp(st: GameState, sideShots: number[][], opts: { lost?: number[]; thirdSet?: boolean } = {}): GameState {
  const last = st.history.at(-1)!;
  const history = sideShots.map((shotSides, i) => ({
    ...last,
    handNo: i + 1,
    bids: last.bids.map(() => 4),
    sides: last.sides.map((s) => ({
      ...s,
      contract: 4,
      contractMade: shotSides.includes(s.side) ? false as const : true,
      contractTricks: shotSides.includes(s.side) ? 1 : 4,
      // the engine marks an eliminated side out on its final record
      ...(opts.lost?.includes(s.side) && i === sideShots.length - 1 ? { out: true } : {}),
    })),
  }));
  const result = opts.lost ? {
    endReason: (opts.thirdSet ? 'third-set' : 'shotOut') as GameResult['endReason'],
    shotOut: opts.lost,
    finalScores: st.scores,
    placements: st.scores.map(() => 1),
    winners: [0],
  } : null;
  return { ...st, rules: { ...st.rules, shotOut: true }, result, history, handNo: history.length, phase: opts.lost ? 'gameOver' : 'handOver' };
}

function recap(st: GameState, names: string[], setAnimCtx?: { storyStopId?: string | null; venueId?: string | null; setting?: string }) {
  return renderToStaticMarkup(createElement(Intermission, {
    st, names, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
    onReady: () => {}, onScorePad: () => {}, onChat: () => {}, setAnimCtx,
  }));
}

describe('the recap: retired pair gone, earned/house animations in their place', () => {
  const names = ['You', 'Hana', 'Mei', 'Jamal'];
  beforeEach(() => clearTeamHoles());

  it('NO unlocks, no story stop: a set renders NO tape, NO sheet, NO set animation — scoring only', () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1]]), names);
    expect(html).not.toContain('recap-tape-');
    expect(html).not.toContain('recap-shroud-');
    expect(html).not.toContain('recap-setanim-');
    expect(html).not.toContain('police-rim');
    expect(html).not.toContain('/shot/tape.webp');
    expect(html).not.toContain('/shot/rip.webp');
    // the scoring/feedback facts all survive
    expect(html).toContain('data-tape="yes"');
    expect(html).toContain('data-testid="recap-shot-stamp-1"');
    expect(html).toContain('>ON NOTICE<');
  });

  it('NO unlocks: a game-ending set (finale tier context) also renders nothing special', () => {
    const html = recap(stamp(toHandOver('joker'), [[1]], { lost: [1] }), names);
    expect(html).toContain('data-sheet="yes"');
    expect(html).not.toContain('recap-shroud-');
    expect(html).not.toContain('recap-setanim-');
    expect(html).toContain('data-testid="time-of-death"');
  });

  it("at a story stop, the HOUSE animation plays on a set — before any clear", () => {
    const html = recap(stamp(toHandOver('joker'), [[], [1]]), names, { storyStopId: 'porch', venueId: 'grandma', setting: 'auto' });
    expect(html).toContain('data-testid="recap-setanim-1"');
    expect(html).toContain('data-anim="porch"');
    expect(html).toContain('data-tier="regular"');
    expect(html).toContain('data-mode="fresh"');
  });

  it("at a story stop, a game-ending set plays the stop's FINALE tier", () => {
    const html = recap(stamp(toHandOver('joker'), [[1]], { lost: [1] }), names, { storyStopId: 'corner', venueId: 'speakeasy', setting: 'auto' });
    expect(html).toContain('data-testid="recap-setanim-1"');
    expect(html).toContain('data-anim="corner"');
    expect(html).toContain('data-tier="finale"');
    expect(html).toContain('sc-lock');
  });

  it('third-set ending: the HARD WAY flash fires AND composes with the stop finale (delayed, not stacked)', () => {
    const html = recap(stamp(toHandOver('joker'), [[1], [], [1], [], [1]], { lost: [1], thirdSet: true }), names, { storyStopId: 'porch', venueId: 'grandma', setting: 'auto' });
    expect(html).toContain('data-testid="hardway-flash"');
    expect(html).toContain('3 THE HARD WAY');
    expect(html).toContain('data-anim="porch"');
    expect(html).toContain('data-tier="finale"');
    expect(html).toContain('--sc-delay:2300ms');
  });

  it('the flash does NOT fire on a shot-out ending, a target ending, or a mid-game recap', () => {
    const shotOut = recap(stamp(toHandOver('joker'), [[1]], { lost: [1] }), names);
    expect(shotOut).not.toContain('hardway-flash');
    const mid = recap(stamp(toHandOver('joker'), [[], [1]], { thirdSet: false }), names);
    expect(mid).not.toContain('hardway-flash');
  });

  it('third-set ending away from story: the flash stands on its own (no unlock needed, no finale required)', () => {
    const html = recap(stamp(toHandOver('joker'), [[1], [], [1], [], [1]], { lost: [1], thirdSet: true }), names);
    expect(html).toContain('data-testid="hardway-flash"');
    expect(html).not.toContain('recap-setanim-');
  });
});
