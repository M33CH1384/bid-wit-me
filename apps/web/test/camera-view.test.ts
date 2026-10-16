import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/settings';
import { dragSlamIntensity, isVGesture, type DragSample } from '../src/slam';
import { cameraFor } from '../src/three/layout';

const path = (pts: [number, number][]): DragSample[] => pts.map(([x, y], i) => ({ t: i * 40, x, y }));
describe('camera view', () => {
  it('sitting is lower and closer than standing', () => {
    const st = cameraFor(390 / 844, false, 'standing'); const si = cameraFor(390 / 844, false, 'sitting');
    expect(si.pos[1]).toBeLessThan(st.pos[1]); expect(si.pos[2]).toBeLessThan(st.pos[2]);
  });
  it('view setting normalises (default standing)', () => {
    expect(normalizeSettings({}).view).toBe('standing');
    expect(normalizeSettings({ view: 'sitting' as never }).view).toBe('sitting');
    expect(normalizeSettings({ view: 'floor' as never }).view).toBe('standing');
  });
  it('V gesture: continuous up then down slams in sitting; straight drag stays gentle', () => {
    const v = path([[195, 700], [195, 640], [195, 580], [195, 640], [195, 700], [180, 430]]);
    // final release point is over the felt; the V legs are the first five samples
    expect(isVGesture(v.slice(0, 5))).toBe(true);
    expect(dragSlamIntensity(v.slice(0, 5), 'sitting')).toBe(1);
    const straight = path([[195, 700], [195, 690], [195, 680], [195, 670], [195, 660]]); // slow straight drag, no V
    expect(isVGesture(straight)).toBe(false);
    expect(dragSlamIntensity(straight, 'sitting')).toBeLessThan(0.6);
    expect(dragSlamIntensity(straight, 'standing')).toBe(1);
    expect(isVGesture(path([[195, 700], [195, 690], [195, 700]]))).toBe(false); // legs too small
  });
});
