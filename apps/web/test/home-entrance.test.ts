/**
 * @vitest-environment happy-dom
 *
 * MENU WEATHER / FIRE ENTRANCE (owner, 2026-11-05): "The weather / fire
 * shouldn't just snap on when I get to the menu — it should fade in for
 * snow, and light like a real fire, with sound."
 *
 * The contract pinned here:
 *  - the snow ramp starts at NOTHING and builds to the tier's full
 *    strength over SNOW_ENTRANCE_MS (smoothstep — the layer at ramp 1
 *    is the settled layer, untouched);
 *  - the fire's params start at a kindling row (small, sparse, low)
 *    and blend to the tier row along the catch curve — kindle slow,
 *    catch fast, settle easing to EXACTLY the tier row (the resting
 *    band is byte-identical to before);
 *  - the gate: once per arrival, keyed to the streak state's first
 *    PRESENTATION with an active atmosphere — neutral presents
 *    nothing and marks nothing, a played arrival never replays;
 *  - the boot reveal signal the entrance waits on (never before the
 *    splash tap, never fighting the sting): unresolved until the gate
 *    marks it, resolved forever after;
 *  - the fireIgnite cue is a fully registered menu one-shot (Sfx
 *    union, FILES → SFX_COUNT derives, UI_SFX so it may sound on
 *    Home, a play() case), fired exactly once from Setup, and the
 *    recorded sample is credited and shipped.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FIRE_ENTRANCE_MS,
  FIRE_KINDLE_PARAMS,
  SNOW_ENTRANCE_MS,
  entranceDecision,
  fireEntranceBlend,
  fireEntranceParams,
  snowEntranceAt,
} from '../src/homeEntrance';
import { HOME_FIRE_TIERS } from '../src/streakFire';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const setup = read('../src/Setup.tsx');
const layer = read('../src/snow/BlizzardLayer.tsx');
const gate = read('../src/BootSplash.tsx');
const audio = read('../src/audio.ts');
const credits = read('../../../CREDITS.md');

describe('the snow ramp', () => {
  it('starts at nothing and reaches full strength at the duration', () => {
    expect(snowEntranceAt(-50)).toBe(0);
    expect(snowEntranceAt(0)).toBe(0);
    expect(snowEntranceAt(SNOW_ENTRANCE_MS)).toBe(1);
    expect(snowEntranceAt(SNOW_ENTRANCE_MS * 3)).toBe(1);
    expect(SNOW_ENTRANCE_MS).toBeGreaterThanOrEqual(2500); // a fade, not a blink
  });

  it('builds monotonically (density never steps backwards)', () => {
    let prev = 0;
    for (let t = 0; t <= SNOW_ENTRANCE_MS; t += 100) {
      const v = snowEntranceAt(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(snowEntranceAt(SNOW_ENTRANCE_MS / 2)).toBeCloseTo(0.5, 1);
  });
});

describe('the fire ignition curve', () => {
  it('the kindling row is a small, sparse, just-lit flame', () => {
    expect(FIRE_KINDLE_PARAMS.flameHeight).toBeLessThanOrEqual(0.2);
    expect(FIRE_KINDLE_PARAMS.particles).toBeLessThan(HOME_FIRE_TIERS[1].particles);
    expect(FIRE_KINDLE_PARAMS.glow).toBeLessThanOrEqual(0.15);
    expect(FIRE_KINDLE_PARAMS.sparksPerSec).toBe(0);
    expect(FIRE_KINDLE_PARAMS.spawnPerSec).toBeGreaterThan(0); // it IS lit, not absent
  });

  it('the blend kindles slow, catches fast, and settles at exactly 1', () => {
    expect(fireEntranceBlend(0)).toBe(0);
    expect(fireEntranceBlend(900)).toBeLessThanOrEqual(0.3); // still kindling at 0.9 s
    expect(fireEntranceBlend(2000)).toBeGreaterThanOrEqual(0.85); // caught by 2 s
    expect(fireEntranceBlend(FIRE_ENTRANCE_MS)).toBe(1);
    expect(fireEntranceBlend(FIRE_ENTRANCE_MS * 2)).toBe(1);
    expect(FIRE_ENTRANCE_MS).toBeGreaterThanOrEqual(2000);
    expect(FIRE_ENTRANCE_MS).toBeLessThanOrEqual(3200);
  });

  it('params start at kindling and land EXACTLY on the tier row', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      const target = HOME_FIRE_TIERS[tier];
      expect(fireEntranceParams(target, 0)).toEqual(FIRE_KINDLE_PARAMS);
      expect(fireEntranceParams(target, FIRE_ENTRANCE_MS)).toEqual(target);
      expect(fireEntranceParams(target, FIRE_ENTRANCE_MS + 5000)).toEqual(target);
      const mid = fireEntranceParams(target, 1500);
      expect(mid.flameHeight).toBeGreaterThan(FIRE_KINDLE_PARAMS.flameHeight);
      expect(mid.flameHeight).toBeLessThan(target.flameHeight);
    }
  });
});

describe('the once-per-arrival gate', () => {
  it('plays on the first active presentation, settles after, ignores neutral', () => {
    expect(entranceDecision(false, true)).toBe('play');
    expect(entranceDecision(true, true)).toBe('settled');
    expect(entranceDecision(false, false)).toBe('none');
    expect(entranceDecision(true, false)).toBe('none');
  });
});

describe('the boot reveal signal', () => {
  it('whenBootRevealed stays pending until the gate marks the reveal', async () => {
    // with a boot gate in the document (the production shape — App wraps
    // the menu in BootSplashGate), the reveal waits for the gate's mark;
    // with no gate at all it is revealed by definition (covered below by
    // every other suite that mounts Home bare).
    document.body.innerHTML = '<div class="boot-gate"></div>';
    const bs = await import('../src/bootSplash');
    bs.__resetBootSplashClaimForTest();
    expect(bs.bootRevealed()).toBe(false);
    let resolved = false;
    const p = bs.whenBootRevealed().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    bs.markBootRevealed();
    await p;
    expect(resolved).toBe(true);
    expect(bs.bootRevealed()).toBe(true);
    // and every later waiter resolves immediately
    await expect(bs.whenBootRevealed()).resolves.toBeUndefined();
    bs.__resetBootSplashClaimForTest();
    expect(bs.bootRevealed()).toBe(false);
  });
});

describe('the wiring', () => {
  it('the boot gate marks the reveal (the seam the entrance waits on)', () => {
    expect(gate).toContain('markBootRevealed');
  });

  it('Setup runs the gate, waits for the reveal, and fires the cue exactly once', () => {
    expect(setup).toContain('entrancePlayedRef');
    expect(setup).toContain('whenBootRevealed');
    expect(setup.match(/sound\.play\('fireIgnite'\)/g)).toHaveLength(1);
    expect(setup).toContain('useIgnitedFireParams');
    // leaving the home step resets the gate — a return is a new arrival
    expect(setup).toMatch(/step !== 'home'[\s\S]{0,200}entrancePlayedRef\.current = false/);
  });

  it('the layers mount only once the gate has decided (no full-strength flash frame)', () => {
    expect(setup).toContain('blizTier > 0 && entranceDecided');
    expect(setup).toContain('fireTier > 0 && entranceDecided');
  });

  it('the blizzard layer takes the entrance clock and ramps its opacity', () => {
    expect(layer).toContain('entranceStartedAt');
    expect(layer).toContain('snowEntranceAt');
    expect(layer).toMatch(/opacity/);
  });
});

describe('the cue registry (family pattern)', () => {
  it('fireIgnite is an Sfx, a FILES sample, a UI one-shot, and a play() case', () => {
    expect(audio).toContain("| 'fireIgnite'");
    expect(audio).toContain("fireIgnite: ['fire-ignite']"); // FILES registry → SFX_COUNT derives
    expect(audio).toMatch(/UI_SFX[^=]*= new Set\(\[[^\]]*'fireIgnite'[^\]]*\]\)/);
    expect(audio).toContain("case 'fireIgnite': return this.sample('fireIgnite', t, 0.9 * g");
  });

  it('the recorded sample is credited', () => {
    expect(credits).toContain('fire-ignite.mp3');
    expect(credits).toContain('SSE_Library_FIRE');
  });

  it('the recorded sample ships in the sfx folder', () => {
    // read through a dynamic path (like `read` above): a LITERAL
    // `new URL('...mp3', import.meta.url)` in the test body is
    // statically rewritten by vite's asset handling into a served
    // http URL under happy-dom, and the read loses its file: scheme.
    const mp3 = readFileSync(new URL(['../public/assets/sfx/', 'fire-ignite.mp3'].join(''), import.meta.url));
    expect(mp3.length).toBeGreaterThan(1000);
    expect(mp3.subarray(0, 3).toString('latin1')).toBe('ID3');
  });
});
