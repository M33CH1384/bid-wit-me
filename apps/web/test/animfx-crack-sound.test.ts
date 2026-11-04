/**
 * @vitest-environment happy-dom
 *
 * SCREEN CRACK SOUND (owner device report, 2026-11-04: "When the screen
 * cracking animation happens there is no sound."). The crack shot — the
 * glass-vein plate crack the AnimFxLayer fires on a cutthroat elimination
 * and on a busted nil — shipped with NO audio cue assigned at all: the
 * layer's only sound call in the file was the fireOut hiss. These pins
 * hold the fix:
 *
 *  - both crack triggers call sound.play('glassCrack') exactly once, on
 *    the same render that adds the crack shot (the fracture's onset is
 *    the mount instant — the main vein carries no CSS delay — so the
 *    cue takes no delay and its attack lands on the first frame);
 *  - Reduce effects (calm) silences the cue with the visual, together;
 *  - unrelated transitions stay silent;
 *  - the cue is a registered engine one-shot in the family pattern
 *    (Sfx union, FILES → SFX_COUNT derives, play() case, credits row),
 *    staged like its plate-event sibling fireOut.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRules, type PlayerView } from '@spades/rules';
import AnimFxLayer from '../src/animfx/AnimFxLayer';
import { fx } from '../src/fx';
import { sound } from '../src/audio';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rules = makeRules('joker');
const view = (o: Partial<PlayerView> = {}): PlayerView => ({
  seat: 0, rules, phase: 'playing', handNo: 1, dealer: 0, turn: 1,
  hand: null, handCounts: [13, 13, 13, 13], bids: [4, 4, 4, 4], revealed: [true, true, true, true],
  exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
  spadesBroken: false, scores: [0, 0], bags: [0, 0], history: [], result: null,
  failStreak: [], eliminated: [false, false, false, false], bidOptions: null, legal: [],
  ...o,
} as PlayerView);

let root: Root | null = null;
function mount(v: PlayerView) {
  document.body.innerHTML = `
    <div class="badge-layer">${[0, 1, 2, 3].map((s) => `<div class="plate" data-testid="seat-${s}"></div>`).join('')}</div>
    <div class="bug-teams"><div class="bug-team"></div><div class="bug-team"></div></div>`;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AnimFxLayer, { st: v })));
  return host;
}
function rerender(v: PlayerView) { act(() => root!.render(createElement(AnimFxLayer, { st: v }))); }

const Q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const crackCalls = () => playSpy.mock.calls.filter((c) => c[0] === 'glassCrack');

let playSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  playSpy = vi.spyOn(sound, 'play').mockImplementation(() => { /* the engine itself is pinned in audio-glass-crack.test.ts */ });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  fx.setReduce(false);
  playSpy.mockRestore();
  delete (window as unknown as { __bwmLayout?: unknown }).__bwmLayout;
});

describe('the crack cue fires with the picture', () => {
  it('NIL, BUSTED (plate path): one glassCrack call, no delay, on the crack render', () => {
    mount(view({ bids: [4, 'nil', 4, 4] }));
    playSpy.mockClear();
    rerender(view({ bids: [4, 'nil', 4, 4], tricksWon: [0, 1, 0, 0] }));
    expect(Q('animfx-crack')).not.toBeNull();
    expect(crackCalls()).toHaveLength(1);
    const opts = crackCalls()[0]![1] as { delay?: number } | undefined;
    expect(opts?.delay ?? 0).toBe(0); // fracture onset = mount (t=0): the cue is never scheduled late
  });

  it('NIL, BUSTED (card-slot path): still exactly one call', () => {
    (window as unknown as { __bwmLayout: unknown }).__bwmLayout = { slots: [0, 1, 2, 3].map((i) => ({ x: i * 90, y: 200, w: 60, h: 84 })) };
    mount(view({ bids: [4, 'nil', 4, 4] }));
    playSpy.mockClear();
    rerender(view({ bids: [4, 'nil', 4, 4], tricksWon: [0, 1, 0, 0] }));
    expect(Q('animfx-crack')).not.toBeNull();
    expect(crackCalls()).toHaveLength(1);
  });

  it('CUTTHROAT ELIMINATION: the crack render carries the cue', () => {
    mount(view({}));
    playSpy.mockClear();
    rerender(view({ eliminated: [false, true, false, false] }));
    expect(Q('animfx-crack')).not.toBeNull();
    expect(crackCalls()).toHaveLength(1);
  });

  it('Reduce effects: no visual, no cue — they skip together', () => {
    mount(view({ bids: [4, 'nil', 4, 4] }));
    fx.setReduce(true);
    playSpy.mockClear();
    rerender(view({ bids: [4, 'nil', 4, 4], tricksWon: [0, 1, 0, 0] }));
    expect(Q('animfx-crack')).toBeNull();
    expect(crackCalls()).toHaveLength(0);
  });

  it('an unrelated trick taken fires nothing', () => {
    mount(view({}));
    playSpy.mockClear();
    rerender(view({ tricksWon: [1, 0, 0, 0] }));
    expect(Q('animfx-crack')).toBeNull();
    expect(crackCalls()).toHaveLength(0);
  });
});

/* The registry / onset-constant / credits pins for this cue live in
 * glass-crack-registry.test.ts (source-reading suites run in the node
 * environment, like boot-sting / streak-fire — happy-dom's module URL
 * is not a file URL). */
