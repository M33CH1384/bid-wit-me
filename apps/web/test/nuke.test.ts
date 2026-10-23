import { describe, expect, it, vi } from 'vitest';
import { isNukeTrick } from '@spades/rules';
import { NUKE_ALLOWANCE_MS } from '@spades/protocol';
import { isIosWebKit, nukeClockStalled, nukeProfile } from '../src/three/nukeVisual';
import { nextTrickPause, restingFlightWait } from '../src/trickTiming';

vi.mock('../src/audio', () => ({ sound: { play() {}, stopTornado() {} } }));

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

const iphone: { ua: string; platform: string; maxTouchPoints: number } = {
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  platform: 'iPhone', maxTouchPoints: 5,
};
const ipadDesktop: { ua: string; platform: string; maxTouchPoints: number } = {
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  platform: 'MacIntel', maxTouchPoints: 5,
};
const desktop: { ua: string; platform: string; maxTouchPoints: number } = {
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  platform: 'MacIntel', maxTouchPoints: 0,
};

describe('last-trick nuke on iPhone Safari', () => {
  it('does not mount the half-float bloom composer (that pass freezes the white flash)', () => {
    expect(isIosWebKit(iphone)).toBe(true);
    expect(isIosWebKit(ipadDesktop)).toBe(true);
    expect(isIosWebKit(desktop)).toBe(false);
    const ios = nukeProfile('high', iphone);
    expect(ios.post).toBe(false);
    expect(ios.octaves).toBe(0);
    expect(ios.screen).toBe(false);
    expect(ios.detail).toBeGreaterThan(0);
    expect(nukeProfile('high', ipadDesktop).post).toBe(false);
    expect(nukeProfile('high', desktop).post).toBe(true);
    expect(nukeProfile('high', desktop).octaves).toBe(1);
    expect(nukeProfile('high', desktop).screen).toBe(true);
    expect(nukeProfile('low', desktop).post).toBe(false);
  });

  it('a clock stuck on the white flash is a stall; a clock that jumps after a hitch is not', () => {
    expect(nukeClockStalled(null, null, 800)).toBe(true); // mounted, never drew
    expect(nukeClockStalled(null, 0.3, 400)).toBe(false); // still inside the grace
    expect(nukeClockStalled(0.3, 0.3, 800)).toBe(true); // frozen at the flash
    expect(nukeClockStalled(0.3, 1.1, 800)).toBe(false); // advanced
    expect(nukeClockStalled(0.2, 2.4, 2200)).toBe(false); // hitch, then one frame catches up via performance.now()
    expect(nukeClockStalled(3.5, 3.5, 800)).toBe(false); // blast already over
    // ☢☢ the mega blast runs 4.4 s: a clock frozen at 3.9 s is still mid-blast for it…
    expect(nukeClockStalled(3.9, 3.9, 800, 4.4)).toBe(true);
    // …but already over under the nuke's default length, and past the mega's window at 4.3 s
    expect(nukeClockStalled(3.9, 3.9, 800)).toBe(false);
    expect(nukeClockStalled(4.3, 4.3, 800, 4.4)).toBe(false);
  });

  it('the hand-ending nuke trick is held on the first paint, and the next hand releases it', () => {
    const mid = { handNo: 2, trickCount: 12 };
    const nuked = { handNo: 2, trickCount: 13 }; // last trick resolved (auto-play included), hand is over
    expect(nextTrickPause(mid, nuked)).toBe('hold');
    expect(nextTrickPause(nuked, { handNo: 3, trickCount: 0 })).toBe('release');
    expect(nextTrickPause(mid, { handNo: 2, trickCount: 12 })).toBe('same');
    expect(nextTrickPause(null, nuked)).toBe('same');
  });

  it('a resting card waits out the auto-play stagger; a card already in flight does not restart it', () => {
    expect(restingFlightWait(0.47, true)).toBe(0.47);
    expect(restingFlightWait(0, true)).toBe(0);
    expect(restingFlightWait(undefined, true)).toBe(0);
    expect(restingFlightWait(0.47, false)).toBeNull();
  });
});
