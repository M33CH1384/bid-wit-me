import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dragSlamIntensity, type DragSample } from '../src/slam';
const path = (pts: [number, number][]): DragSample[] => pts.map(([x, y], i) => ({ t: i * 16, x, y }));
describe('sitting slam regression (live bug: plain flick speed-slammed)', () => {
  it('fast straight flick in sitting is gentle; only the V slams', () => {
    const fastFlick = path([[195, 700], [195, 520], [195, 360], [180, 330]]);
    expect(dragSlamIntensity(fastFlick, 'sitting')).toBe(0);
    const fastSideways = path([[100, 600], [220, 590], [330, 585]]);
    expect(dragSlamIntensity(fastSideways, 'sitting')).toBe(0);
    const v = path([[195, 700], [195, 630], [195, 640], [195, 700], [180, 430]]);
    expect(dragSlamIntensity(v, 'sitting')).toBe(0); // Turn up OFF (default) gates the V too
    expect(dragSlamIntensity(fastFlick, 'standing')).toBe(0); // Turn up OFF by default
    expect(dragSlamIntensity(fastFlick, 'standing', true)).toBe(1); // Turn up ON restores max Standing slam
    expect(dragSlamIntensity(v, 'sitting', false)).toBe(0); // Sitting V-gesture IS gated by Turn up (founder fix)
    expect(dragSlamIntensity(v, 'sitting', true)).toBe(1); // Turn up ON preserves the V slam exactly
  });
  it('online table wires the View toggle', () => {
    const src = readFileSync(new URL('../src/online/OnlineTable.tsx', import.meta.url), 'utf8');
    expect(src).toContain('onView=');
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    // Table3D must receive the EFFECTIVE view (saved preference, or Sitting after the
    // seated-each-hand reset), and both toggles must go through toggleView so a manual
    // choice clears the auto-seat for the rest of the hand.
    expect(table).toContain('view={effView}');
    expect(table).toContain('const effView = effectiveView(settings.view, handView)');
    expect(table).toContain('data-testid="view-toggle" onClick={toggleView}');
    expect(table).toContain('data-testid="view-toggle-plate"');
  });
});
