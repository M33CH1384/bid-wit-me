/**
 * @vitest-environment happy-dom
 *
 * Transition-family sound (transitionSound.ts): the non-spray
 * programs' foley rides the spraySound discipline — phase-event
 * driven off the shared controller, one instance per episode, on the
 * SFX bus, silent when the transition is suppressed. The Fan gets a
 * soft shuffle; the Deal three staggered card slides; the Sweep one
 * card shove; Ink and the Doorway stay silent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fxStub = vi.hoisted(() => ({ reduced: false, osReducedMotion: false }));
vi.mock('../src/fx', () => ({ fx: fxStub }));

const soundMock = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock('../src/audio', () => ({ sound: soundMock }));

import {
  cancelTransitions,
  coverTableEntry,
  coverThen,
  registerTransitionRenderer,
} from '../src/transitions';
import { initTransitionSound } from '../src/transitionSound';

beforeEach(() => {
  vi.useFakeTimers();
  soundMock.play.mockClear();
  fxStub.reduced = false;
  fxStub.osReducedMotion = false;
  registerTransitionRenderer(false);
  cancelTransitions();
});

describe('transition-family sound', () => {
  it('the fan plays one soft shuffle when its cover starts, nothing on reveal', () => {
    registerTransitionRenderer(true);
    const off = initTransitionSound();
    coverThen(vi.fn(), 'profile-social');
    expect(soundMock.play).toHaveBeenCalledTimes(1);
    expect(soundMock.play).toHaveBeenCalledWith('shuffle', expect.objectContaining({ dur: 0.8 }));
    vi.advanceTimersByTime(2000);
    expect(soundMock.play).toHaveBeenCalledTimes(1);
    off();
  });

  it('the deal plays three staggered card slides across its dwell', () => {
    registerTransitionRenderer(true);
    const off = initTransitionSound();
    coverTableEntry();
    const deals = soundMock.play.mock.calls.filter((c) => c[0] === 'deal');
    expect(deals).toHaveLength(3);
    expect(deals.map((c) => (c[1] as { delay?: number }).delay)).toEqual([0, 0.14, 0.28]);
    off();
  });

  it('the sweep plays one card shove', () => {
    registerTransitionRenderer(true);
    const off = initTransitionSound();
    coverThen(vi.fn(), 'table-exit');
    expect(soundMock.play).toHaveBeenCalledTimes(1);
    expect(soundMock.play).toHaveBeenCalledWith('sweep', expect.anything());
    off();
  });

  it('ink (menu moves) and the doorway stay silent here', () => {
    registerTransitionRenderer(true);
    const off = initTransitionSound();
    coverThen(vi.fn(), 'menu-nav'); // classic theme: spray — spraySound owns it
    vi.advanceTimersByTime(2500);
    coverThen(vi.fn(), 'story-entry');
    expect(soundMock.play).not.toHaveBeenCalled();
    off();
  });

  it('a suppressed transition is silent (no episode ever starts)', () => {
    registerTransitionRenderer(true);
    fxStub.reduced = true;
    const off = initTransitionSound();
    coverThen(vi.fn(), 'profile-social');
    expect(soundMock.play).not.toHaveBeenCalled();
    off();
  });

  it('a second episode sounds again (single-instance is per episode)', () => {
    registerTransitionRenderer(true);
    const off = initTransitionSound();
    coverThen(vi.fn(), 'profile-social');
    vi.advanceTimersByTime(1000);
    coverThen(vi.fn(), 'profile-social');
    expect(soundMock.play).toHaveBeenCalledTimes(2);
    off();
  });
});
