import { describe, expect, it } from 'vitest';
import { VENUES } from '@spades/protocol';
import { cameraFor } from '../src/three/layout';
import { DEFAULT_CATEGORY_VOLUMES, ROOM_STYLES, SOUNDSCAPE_ROOMS, styleForVenue, Spatializer, defaultAudioQuality, isVoiceMuted, listenerPose, normalizeCategoryVolumes, pannerCap, pickPanningModel, resolveSoundscape, roomName, seatPoint, withVoiceMuted, type SpatialCtxLike } from '../src/spatial';

const fakeCtx = (): SpatialCtxLike => ({
  createPanner: () => ({ panningModel: '', distanceModel: '', refDistance: 0, rolloffFactor: 0, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, connect: (d: unknown) => d }),
  listener: { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, forwardX: { value: 0 }, forwardY: { value: 0 }, forwardZ: { value: 0 }, upX: { value: 0 }, upY: { value: 0 }, upZ: { value: 0 } },
});
describe('spatial phase 2 plumbing', () => {
  it('category volumes normalise and default to unity (today\u2019s mix)', () => {
    expect(normalizeCategoryVolumes(undefined)).toEqual(DEFAULT_CATEGORY_VOLUMES);
    expect(normalizeCategoryVolumes({ sfx: 0.5, crowd: 7 } as never).sfx).toBe(0.5);
    expect(normalizeCategoryVolumes({ sfx: 0.5 } as never).crowd).toBe(1);
  });
  it('quality caps and panning model (HRTF desktop, equalpower phone)', () => {
    expect([pannerCap('low'), pannerCap('balanced'), pannerCap('high')]).toEqual([4, 8, 12]);
    expect(pickPanningModel(true, false)).toBe('HRTF'); expect(pickPanningModel(true, true)).toBe('equalpower'); expect(pickPanningModel(false, false)).toBe('equalpower');
    expect(defaultAudioQuality({ deviceMemory: 2 })).toBe('low'); expect(defaultAudioQuality({ cores: 8 })).toBe('balanced');
  });
  it('seat points oppose across the table; listener follows sitting camera', () => {
    const top = seatPoint('top', 4), bottom = seatPoint('bottom', 4);
    expect(top.z).toBeLessThan(0); expect(bottom.z).toBeGreaterThan(0);
    expect(listenerPose(cameraFor(390 / 844, false, 'sitting')).position.y).toBeLessThan(listenerPose(cameraFor(390 / 844, false, 'standing')).position.y);
  });
  it('soundscape resolver: explicit > story > seeded Auto roll (never venue)', () => {
    expect(resolveSoundscape({ explicit: 'barbershop', storyRoom: 'basement', seed: 'g1' })).toBe('barbershop');
    expect(resolveSoundscape({ explicit: 'auto', storyRoom: 'basement', seed: 'g1' })).toBe('basement');
    const roll = resolveSoundscape({ explicit: 'auto', seed: 'game-42' });
    expect(roll).not.toBe('none'); expect(resolveSoundscape({ explicit: 'auto', seed: 'game-42' })).toBe(roll); // deterministic: online agrees
  });
  it('one style per room: every repo venue has its own distinct soundscape', () => {
    expect(ROOM_STYLES.map((r) => r.venue).sort()).toEqual([...VENUES].sort());
    expect(new Set(ROOM_STYLES.map((r) => r.name)).size).toBe(ROOM_STYLES.length);
    for (const r of ROOM_STYLES) { expect(r.reverb).toBeTruthy(); expect(r.surface).toBeTruthy(); }
    expect(styleForVenue('vegas')?.crowd).toBe('arena'); expect(styleForVenue('classic')?.reverb).toBe('studio');
    expect(roomName('barbershop')).toBe('Barbershop'); expect(roomName('basement')).toBe('Basement Spades Night');
    for (const seed of ['a', 'game-1', 'xyz-9']) { const r = resolveSoundscape({ explicit: 'auto', seed }); expect(roomName(r).length).toBeGreaterThan(2); }
  });
  it('per-player voice mute is local and reversible', () => {
    const m = withVoiceMuted(undefined, 'p2', true);
    expect(isVoiceMuted(m, 'p2')).toBe(true); expect(isVoiceMuted(m, 'p1')).toBe(false);
    expect(isVoiceMuted(withVoiceMuted(m, 'p2', false), 'p2')).toBe(false);
  });
  it('spatializer caps live panners and is inert when disabled', () => {
    const ctx = fakeCtx();
    const off = new Spatializer('balanced', false, 'HRTF'); expect(off.seatPanner(ctx, 'top', 4)).toBeNull();
    const on = new Spatializer('low', true, 'equalpower');
    for (let i = 0; i < 4; i++) expect(on.seatPanner(ctx, 'top', 4)).not.toBeNull();
    expect(on.seatPanner(ctx, 'top', 4)).toBeNull(); // cap 4 at low
    on.applyListener(ctx, cameraFor(390 / 844, false, 'sitting'));
    expect(ctx.listener!.positionY.value).toBeGreaterThan(0);
  });
});
describe('spatial phase 3: variant no-dup rule', () => {
  it('never repeats the previous variant', async () => {
    const { pickVariantIdx } = await import('../src/audio');
    for (let last = 0; last < 3; last++) for (let r = 0; r < 20; r++) {
      const i = pickVariantIdx(3, last, () => r / 20);
      expect(i).not.toBe(last); expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(3);
    }
    expect(pickVariantIdx(1, 0)).toBe(0);
  });
});
