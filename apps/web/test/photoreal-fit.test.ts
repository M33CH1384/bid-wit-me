import { describe, expect, it } from 'vitest';
import { NUKE_ENGULF, fitToTable, photorealFor } from '../src/photoreal/host';

describe('photoreal overlays: trigger map + table fit', () => {
  it('maps the existing triggers (and nothing else)', () => {
    expect(photorealFor({ kind: 'jokerBig' })).toBe('quake');
    expect(photorealFor({ kind: 'overcut', level: 3 })).toBe('lightning');
    expect(photorealFor({ kind: 'overcut', level: 2 })).toBeNull();
    expect(photorealFor({ kind: 'shot' })).toBe('meteor');
    expect(photorealFor({ kind: 'wheels' })).toBe('goldrain');
    expect(photorealFor({ kind: 'ranIt' })).toBeNull(); // the tornado stays as is
    expect(photorealFor({ kind: 'streak' })).toBeNull();
  });
  it('anchors on the projected table and scales to it', () => {
    const L = { table: { cx: 422, cy: 152, x0: 83, x1: 761, y0: 71, y1: 347 }, trick: [{ x: 440, y: 130, w: 30, h: 40 }] };
    const q = fitToTable('quake', 844, 390, L);
    expect([q.gx, q.gy]).toEqual([422, 152]);
    expect(q.rx).toBe(339);
    expect(q.k).toBeCloseTo(339 / Math.min(844 * 0.46, 390 * 0.95), 6);
    const l = fitToTable('lightning', 844, 390, L);
    expect([l.gx, l.gy]).toEqual([455, 150]); // strikes land on the trick
    expect(fitToTable('nuke', 844, 390, L).k).toBeCloseTo(q.k * NUKE_ENGULF, 6);
  });
  it('falls back to the screen centre without a layout, k clamped', () => {
    const f = fitToTable('goldrain', 390, 844, null);
    expect(f.gx).toBe(195);
    expect(f.k).toBeGreaterThanOrEqual(0.6);
    expect(f.k).toBeLessThanOrEqual(1.8);
  });
});
