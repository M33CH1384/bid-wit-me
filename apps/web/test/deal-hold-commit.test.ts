/**
 * The deal-hold release must land in the COMMIT that observes the deal window
 * closing — not only in the frame loop, and never gated on the tween's `started`
 * flag. (Owner recurrence, 2026-10-24: online game start — "you can't see your
 * cards and you have to close the app and reopen it to see them.")
 *
 * The 2026-10-19 fix released held cards in Card3D's useFrame under
 * `held && !liveHold && !started`. The hole: the render that closes the deal
 * window re-renders a still-waiting card with its settled 'lift' motion, and the
 * lift settle marks the tween `started` as it snaps the card into its fan slot —
 * without making it visible. From that commit the frame-loop release refused
 * forever, and only a fresh mount (app reopen) showed the card.
 *
 * happy-dom cannot run WebGL, so the ordering is pinned at the source, in the
 * house style of avatar-css.test.ts. Every pin below fails on the pre-fix
 * Card3D/dealFlight: the stale-hold predicate did not exist, the only release
 * lived in the frame loop behind the `started` gate, and the lift settle
 * carried no release at all.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const card = readFileSync(new URL('../src/three/Card3D.tsx', import.meta.url), 'utf8');
const flight = readFileSync(new URL('../src/three/dealFlight.ts', import.meta.url), 'utf8');

const RELEASE_CALL = 'dealHoldStale({ held: hideUntilStart.current, liveHold: holdUntilMove })';
const HIDE_LINE = 'if (hideUntilStart.current && !tw.current.started) g.visible = false;';

function occurrences(src: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) out.push(i);
  return out;
}

describe('deal hold release wiring (2026-10-24 recurrence)', () => {
  it('the stale-hold predicate takes no tween state — the poisoned predicate is gone', () => {
    expect(flight).toContain('export function dealHoldStale(o: { held: boolean; liveHold: boolean })');
    expect(flight).not.toContain('dealHoldReleased');
    expect(card).not.toContain('dealHoldReleased');
    expect(card).toContain("import { dealHoldStale, openingFlight } from './dealFlight';");
  });

  it('no release call site consults the tween started flag', () => {
    const sites = occurrences(card, RELEASE_CALL);
    // Two call sites: the commit-time layout effect and the frame-loop backstop.
    expect(sites.length).toBe(2);
    for (const at of sites) {
      const stmt = card.slice(at, card.indexOf(') {', at) + 3);
      expect(stmt).not.toContain('started');
    }
  });

  it('the commit-time release runs in the every-render layout effect, ahead of the hide line', () => {
    const releaseAt = card.indexOf(RELEASE_CALL);
    const hideAt = card.indexOf(HIDE_LINE);
    expect(releaseAt).toBeGreaterThanOrEqual(0);
    expect(hideAt).toBeGreaterThan(releaseAt);
    // Same effect body: no effect boundary between the release and the hide it disarms,
    // so the release lands in the very commit that first observes the flipped prop,
    // before paint — with no dependence on an animation frame ever running.
    const between = card.slice(releaseAt, hideAt);
    expect(between).not.toContain('useLayoutEffect');
    expect(between).not.toContain('useFrame');
    expect(between).not.toContain('}, [');
  });

  it('the lift settle itself releases the hold — settled in the fan means shown', () => {
    const start = card.indexOf("if (motion !== 'lift') return;");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = card.indexOf('}, [motion, poseKey, raise, roll, invalidate, target]);', start);
    expect(end).toBeGreaterThan(start);
    const settle = card.slice(start, end);
    expect(settle).toContain('s.started = true');
    expect(settle).toContain('hideUntilStart.current = false');
    expect(settle).toContain('g.visible = true');
  });

  it('the frame loop keeps the same release as a backstop (second call site)', () => {
    const frameAt = card.indexOf('useFrame((_, rawDt) => {');
    expect(frameAt).toBeGreaterThanOrEqual(0);
    const second = occurrences(card, RELEASE_CALL)[1]!;
    expect(second).toBeGreaterThan(frameAt);
  });
});
