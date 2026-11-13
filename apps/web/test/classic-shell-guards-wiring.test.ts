/**
 * @vitest-environment happy-dom
 *
 * WIRING PINS for the 2026-11-10 shell guards (whiteout + white noise):
 * the pure decision functions have their own suites; these pins hold the
 * integration points a future refactor could quietly bypass —
 *
 *  - every recorded-bed starter reaches the speaker only through
 *    startRecordedBedLoop (the validating doorway), and the helper is the
 *    ONLY place a bed buffer source is built from a decoded ambience raw;
 *  - filterHall validates the custom bake and retries through the public
 *    fromEquirectangular path before any texture can reach HallAttach.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('audio: all recorded beds pass the validating doorway', () => {
  const audio = read('../src/audio.ts');

  it('routes all twelve bed starters through startRecordedBedLoop', () => {
    const calls = audio.match(/this\.startRecordedBedLoop\(\{ raw, url:/g) ?? [];
    expect(calls.length).toBe(12);
  });

  it('builds a bed buffer source from a decoded raw in exactly one place', () => {
    const builds = audio.match(/trimLoopBuffer\(c, args\.raw|trimLoopBuffer\(this\.ctx, raw/g) ?? [];
    // the helper's own call is the only survivor; the starters' direct builds are gone
    expect(builds).toEqual(['trimLoopBuffer(c, args.raw']);
  });

  it('the element fallback and the witness live inside the helper', () => {
    const helper = audio.slice(audio.indexOf('private startRecordedBedLoop'));
    const body = helper.slice(0, helper.indexOf('\n  /**'));
    expect(body).toContain('createMediaElementSource');
    expect(body).toContain('bedBufferSane(args.raw)');
    expect(body).toContain('this.bedLoopsAlive++');
  });
});

describe('hallEnv: validation gates the map', () => {
  const hall = read('../src/three/hallEnv.tsx');

  it('assesses the custom bake before returning its texture', () => {
    const filter = hall.slice(hall.indexOf('async function filterHall'));
    const probeAt = filter.indexOf('probeEnvMeanLuminance(gl, target.texture)');
    const returnAt = filter.indexOf('return target.texture');
    expect(probeAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(probeAt);
    expect(filter).toContain("assessBake(sourceMean, probe) === 'ok'");
  });

  it('retries a blown bake through the public PMREM path, then gives up to no environment', () => {
    const filter = hall.slice(hall.indexOf('async function filterHall'));
    expect(filter).toContain('fromEquirectangular(tex)');
    expect(filter).toContain("assessBake(sourceMean, probe2) === 'ok'");
  });
});
