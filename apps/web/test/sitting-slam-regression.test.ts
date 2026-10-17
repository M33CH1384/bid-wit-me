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
    expect(dragSlamIntensity(v, 'sitting')).toBe(1);
    expect(dragSlamIntensity(fastFlick, 'standing')).toBe(1);
  });
  it('online table wires the View toggle (dead toggle left online on Standing = always max)', () => {
    const src = readFileSync(new URL('../src/online/OnlineTable.tsx', import.meta.url), 'utf8');
    expect(src).toContain('onView=');
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('view={settings.view}');
  });
});
