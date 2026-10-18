import { describe, expect, it, vi } from 'vitest';
import {
  XR_LOG_CAP, XR_REFERENCE_SPACE_CHAIN, appendXrLog, buildVisionSafeSessionInit,
  describeXrError, isFloorSpace, originYOffset, pickReferenceSpace,
} from '../src/xr/session';

describe('XR vision-safe session init', () => {
  it('requires nothing: no requiredFeatures, no DOM overlay, no layers key', () => {
    const init = buildVisionSafeSessionInit() as unknown as Record<string, unknown>;
    expect(init.requiredFeatures ?? []).toEqual([]);
    expect(init).not.toHaveProperty('domOverlay');
    expect(init.optionalFeatures).toEqual([...XR_REFERENCE_SPACE_CHAIN, 'hand-tracking']);
  });
  it('offers the reference-space fallback chain local-floor -> local -> viewer as optional', () => {
    expect(XR_REFERENCE_SPACE_CHAIN).toEqual(['local-floor', 'local', 'viewer']);
  });
});

describe('pickReferenceSpace fallback chain', () => {
  const fake = (impl: (t: string) => Promise<unknown>, enabled?: string[]) => ({
    enabledFeatures: enabled ? new Set(enabled) : undefined,
    requestReferenceSpace: vi.fn(impl),
  });
  it('grants local-floor first when available and stops', async () => {
    const s = fake(async (t) => ({ t }));
    const applied: string[] = [];
    await expect(pickReferenceSpace(s, (_sp, t) => applied.push(t))).resolves.toBe('local-floor');
    expect(applied).toEqual(['local-floor']);
    expect(s.requestReferenceSpace).toHaveBeenCalledTimes(1);
  });
  it('falls back to local when local-floor throws (the Vision Pro case)', async () => {
    const s = fake(async (t) => { if (t === 'local-floor') throw new DOMException('no floor', 'NotSupportedError'); return { t }; });
    const skipped: string[] = [];
    await expect(pickReferenceSpace(s, () => {}, (t) => skipped.push(t))).resolves.toBe('local');
    expect(skipped).toEqual(['local-floor']);
  });
  it('falls back to viewer when both floor and local fail', async () => {
    const s = fake(async (t) => { if (t !== 'viewer') throw new Error('nope'); return { t }; });
    await expect(pickReferenceSpace(s, () => {})).resolves.toBe('viewer');
  });
  it('returns null (caller keeps three internal space) when every space fails', async () => {
    const s = fake(async () => { throw new Error('nope'); });
    const apply = vi.fn();
    await expect(pickReferenceSpace(s, apply)).resolves.toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
  it('skips spaces the granted session did not enable, without requesting them', async () => {
    const s = fake(async (t) => ({ t }), ['local']);
    await expect(pickReferenceSpace(s, () => {})).resolves.toBe('local');
    expect(s.requestReferenceSpace).toHaveBeenCalledTimes(1);
    expect(s.requestReferenceSpace).toHaveBeenCalledWith('local');
  });
});

describe('XR origin height + error/log helpers', () => {
  it('floor spaces need no eye-height lift; local/viewer get the seated estimate', () => {
    expect(isFloorSpace('local-floor')).toBe(true);
    expect(originYOffset('local-floor')).toBe(0);
    expect(originYOffset('local')).toBeGreaterThan(1);
    expect(originYOffset('viewer')).toBe(originYOffset('local'));
    expect(originYOffset(null)).toBe(originYOffset('local'));
  });
  it('describeXrError keeps name + message for DOMExceptions and plain values', () => {
    expect(describeXrError(new DOMException('denied', 'SecurityError'))).toBe('SecurityError: denied');
    expect(describeXrError('boom')).toBe('boom');
  });
  it('appendXrLog caps the panel log', () => {
    let lines: string[] = [];
    for (let i = 0; i < XR_LOG_CAP + 10; i++) lines = appendXrLog(lines, `line ${i}`, 0);
    expect(lines).toHaveLength(XR_LOG_CAP);
    expect(lines[lines.length - 1]).toContain(`line ${XR_LOG_CAP + 9}`);
  });
});
