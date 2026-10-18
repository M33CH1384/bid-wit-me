import { describe, expect, it, vi } from 'vitest';
import {
  XR_LOG_CAP, XR_LOG_STORAGE_KEY, XR_REFERENCE_SPACE_CHAIN, anchorGroupForEye, appendXrLog, buildVisionSafeSessionInit,
  checkImmersiveSupport, chooseGrantedReferenceType, describeBaseLayer, describeXrError, isFloorSpace,
  loadPersistedXrLog, originYOffset, pickReferenceSpace, savePersistedXrLog, yawFromForward,
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

describe('round 2: present-path hardening', () => {
  it('chooseGrantedReferenceType picks the first granted chain space, never an ungranted guess', () => {
    expect(chooseGrantedReferenceType(['local', 'hand-tracking'])).toBe('local');
    expect(chooseGrantedReferenceType(['viewer'])).toBe('viewer');
    expect(chooseGrantedReferenceType(['hand-tracking'])).toBeNull();
    expect(chooseGrantedReferenceType(null)).toBeNull();
    expect(chooseGrantedReferenceType(undefined)).toBeNull();
  });
  it('describeBaseLayer reports framebuffer size or layers', () => {
    expect(describeBaseLayer({ renderState: { baseLayer: { framebufferWidth: 2064, framebufferHeight: 2208 } } })).toContain('2064x2208');
    expect(describeBaseLayer({ renderState: { layers: [{}] } })).toContain('layers');
    expect(describeBaseLayer(null)).toContain('not available');
  });
  it('checkImmersiveSupport times out instead of sticking at Checking', async () => {
    const hung = { isSessionSupported: () => new Promise<boolean>(() => {}) };
    await expect(checkImmersiveSupport(hung, 20)).resolves.toBe('timeout');
    await expect(checkImmersiveSupport({ isSessionSupported: async () => true }, 1000)).resolves.toBe('supported');
    await expect(checkImmersiveSupport({ isSessionSupported: async () => false }, 1000)).resolves.toBe('unsupported');
    await expect(checkImmersiveSupport({ isSessionSupported: async () => { throw new Error('x'); } }, 1000)).resolves.toBe('error');
  });
  it('status log persists across page loads (one screenshot after exit is enough)', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    savePersistedXrLog(storage, ['a line', 'session ENDED']);
    expect(store.has(XR_LOG_STORAGE_KEY)).toBe(true);
    expect(loadPersistedXrLog(storage)).toEqual(['a line', 'session ENDED']);
    expect(loadPersistedXrLog(null)).toEqual([]);
    store.set(XR_LOG_STORAGE_KEY, 'not json');
    expect(loadPersistedXrLog(storage)).toEqual([]);
  });
  it('anchoring puts the designed seat under the eye, facing the table, for any yaw', () => {
    // eye straight ahead of the room at the designed seat: no shift needed
    expect(anchorGroupForEye({ x: 0, y: 1.25, z: 0.95 }, 0)).toEqual({ x: 0, y: 0, z: 0 });
    // eye at a floor-space origin (0,0,0) looking -z: room drops so the seat is at the eye
    const p = anchorGroupForEye({ x: 0, y: 0, z: 0 }, 0);
    expect(p.y).toBeCloseTo(-1.25); expect(p.z).toBeCloseTo(-0.95);
    // yaw math: forward -z is 0; forward +x (looking right) is -90deg
    expect(yawFromForward(0, -1)).toBeCloseTo(0);
    expect(yawFromForward(1, 0)).toBeCloseTo(-Math.PI / 2);
    const q = anchorGroupForEye({ x: 2, y: 1.4, z: 3 }, Math.PI / 2);
    expect(Number.isFinite(q.x + q.y + q.z)).toBe(true);
  });
});
