import { describe, expect, it, vi } from 'vitest';
import { isNukeTrick } from '@spades/rules';
import { NUKE_ALLOWANCE_MS } from '@spades/protocol';

vi.mock('../src/audio', () => ({ sound: { play() {}, stopTornado() {}, geiger() {} } }));

/**
 * Regression: Demetrius's Big-over-Little nuke showed only a small flash (v0.3.1). Root cause: the macOS / iOS
 * "Reduce motion" setting (prefers-reduced-motion) was silently treated as "Reduce effects", which forced the nuke
 * to Off (banner + boom). Plus Big-then-Little tricks got no nuke hold, so the trick was swept mid-blast.
 */
function stubWindow(reduceMotion: boolean) {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: reduceMotion && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }), setTimeout, clearTimeout });
  return store;
}

describe('nuke is never downgraded by the OS', () => {
  it('OS Reduce motion does NOT turn on Reduce effects; the full nuke still plays (only shake is dropped)', async () => {
    stubWindow(true);
    vi.resetModules();
    const { fx } = await import('../src/fx');
    expect(fx.osReducedMotion).toBe(true);
    expect(fx.reduced).toBe(false);
    expect(fx.nukeMode).toBe('full');
    fx.emit('nuke', { silent: true });
    expect(fx.fired.nuke).toBe(1);
    expect(fx.shake).toBeNull(); // no camera shake under OS reduce motion
    vi.unstubAllGlobals();
  });
  it('defaults to Full Nuke with no saved prefs; Reduce effects is an explicit opt-in that forces Off', async () => {
    stubWindow(false);
    vi.resetModules();
    const { fx } = await import('../src/fx');
    expect(fx.nukeMode).toBe('full');
    fx.setReduce(true);
    expect(fx.nukeMode).toBe('off');
    fx.setReduce(false);
    expect(fx.nukeMode).toBe('full');
    vi.unstubAllGlobals();
  });
  it('one blast per nuked trick even if the landing cue and the watchdog both fire', async () => {
    stubWindow(false);
    vi.resetModules();
    const { fx } = await import('../src/fx');
    fx.emit('nuke', { silent: true }); fx.emit('nuke', { silent: true });
    expect(fx.fired.nuke).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('nuked trick detection (hold allowance)', () => {
  const t = (cs: string[]) => cs.map((card, seat) => ({ seat, card }) as never);
  it('Little then Big and Big then Little both count', () => {
    expect(isNukeTrick(t(['LJ', '3H', 'BJ', '4H']))).toBe(true);
    expect(isNukeTrick(t(['BJ', 'LJ', '3H', '4H']))).toBe(true);
    expect(isNukeTrick(t(['BJ', '2H', '3H', '4H']))).toBe(false);
  });
  it('a Run it! trick is never a nuke (the tornado is the show)', () => {
    expect(isNukeTrick([{ seat: 0, card: 'BJ', run: true }, { seat: 1, card: 'LJ', run: true }] as never)).toBe(false);
  });
  it('every nuke level gets a hold long enough for the 3.6 s blast where it plays', () => {
    expect(NUKE_ALLOWANCE_MS.full).toBeGreaterThanOrEqual(3600);
    expect(NUKE_ALLOWANCE_MS.classic).toBeGreaterThanOrEqual(3000);
  });
});
