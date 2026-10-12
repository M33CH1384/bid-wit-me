import { describe, expect, it, vi } from 'vitest';
import { HAPTIC, createHaptics, setVibration, vibrationOn } from '../src/haptics';
import type { HapticPorts } from '../src/haptics';

function ports(over: Partial<HapticPorts> = {}) {
  const calls: (number | number[])[] = [];
  let now = 0;
  const p: HapticPorts = {
    vibrate: (pattern) => { calls.push(pattern); return true; },
    now: () => now,
    reducedMotion: () => false,
    enabled: () => true,
    unlocked: () => true,
    hidden: () => false,
    ios: () => false,
    ...over,
  };
  return { calls, p, setNow: (n: number) => { now = n; } };
}

describe('haptic patterns', () => {
  it('matches the spec, including the detonation slots that open the 3D blast', () => {
    expect(HAPTIC.beat).toEqual([12]);
    expect(HAPTIC.detonation).toEqual([40, 30, 120, 40, 200]);
    expect(HAPTIC.detonation.reduce((a, b) => a + b, 0)).toBe(430);
    expect(HAPTIC.tornadoSpin).toEqual([20, 40, 20, 40, 30, 30, 40, 20, 60, 20, 80]);
    expect(HAPTIC.tornadoSpin.reduce((a, b) => a + b, 0)).toBe(400);
    expect(HAPTIC.tornadoImpact).toEqual([150]);
    expect(HAPTIC.trickWin).toEqual([15]);
    expect(HAPTIC.setOrShot).toEqual([60, 40, 60]);
    expect(HAPTIC.gameWin).toEqual([80, 60, 80, 60, 200]);
    expect(HAPTIC.reducedTick).toEqual([12]);
  });
});

describe('createHaptics', () => {
  it('plays a pattern after a gesture when vibration is on', () => {
    const { calls, p } = ports();
    const h = createHaptics(p);
    expect(h.haptic(HAPTIC.beat, 'beat')).toBe('played');
    expect(calls).toEqual([[12]]);
  });

  it('throttles to one pattern per 250ms', () => {
    const { calls, p, setNow } = ports();
    const h = createHaptics(p);
    expect(h.haptic(HAPTIC.beat, 'beat')).toBe('played');
    setNow(249);
    expect(h.haptic(HAPTIC.detonation, 'detonate')).toBe('throttled');
    setNow(250);
    expect(h.haptic(HAPTIC.detonation, 'detonate')).toBe('played');
    expect(calls).toEqual([[12], [40, 30, 120, 40, 200]]);
  });

  it('plays one short tick under reduced motion, then ignores later patterns until cancel', () => {
    const { calls, p } = ports({ reducedMotion: () => true });
    const h = createHaptics(p);
    expect(h.haptic(HAPTIC.detonation, 'detonate')).toBe('reduced');
    expect(h.haptic(HAPTIC.beat, 'beat')).toBe('reduced');
    expect(calls).toEqual([[12]]);
    expect(h.cancel('skipped')).toBe('cancelled');
    expect(calls.at(-1)).toBe(0);
    expect(h.haptic(HAPTIC.trickWin, 'trick-win')).toBe('reduced');
    expect(calls.filter((c) => Array.isArray(c))).toEqual([[12], [12]]);
  });

  it('calls vibrate(0) when the page is hidden', () => {
    const { calls, p } = ports({ hidden: () => true });
    const h = createHaptics(p);
    expect(h.haptic(HAPTIC.gameWin, 'game-win')).toBe('cancelled');
    expect(calls).toEqual([0]);
  });

  it('does nothing on iPhone, or before a gesture, or when the setting is off', () => {
    expect(createHaptics(ports({ ios: () => true }).p).haptic(HAPTIC.beat, 'beat')).toBe('skipped');
    expect(createHaptics(ports({ unlocked: () => false }).p).haptic(HAPTIC.beat, 'beat')).toBe('skipped');
    expect(createHaptics(ports({ enabled: () => false }).p).haptic(HAPTIC.beat, 'beat')).toBe('skipped');
  });
});

describe('vibration setting', () => {
  it('defaults on and persists an explicit off', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    try {
      expect(vibrationOn()).toBe(true);
      setVibration(false);
      expect(vibrationOn()).toBe(false);
      expect(store.get('bwm.vibrate')).toBe('0');
      setVibration(true);
      expect(vibrationOn()).toBe(true);
      expect(store.get('bwm.vibrate')).toBe('1');
    } finally {
      setVibration(true);
      vi.unstubAllGlobals();
    }
  });
});
