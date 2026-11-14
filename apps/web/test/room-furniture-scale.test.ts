import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Venue backdrop furniture scale (owner report 2026-11-13: background chairs
// render too large in the photoreal rooms). The room pictures are rendered by
// tools/blender/build_room.py, which places Poly Haven models at
// SCALE = 2.7 game units per metre. Two mechanisms broke that contract:
// several models are NOT modelled at real size (the school chair measures
// 1.006 m tall vs ~0.80 m for a real one; the wooden chair is 2.274 m), and
// placements carried deliberate >1 multipliers on top of realistic models
// (clocks x1.4, plants x1.5-1.6, vases x2.0). build_room.py therefore carries
// a MODEL_FIX table (real-world reference / measured native size, measured
// from the shipped 1k glTFs) that prop()/on() apply to every placement, and
// no placement multiplier above 1.0 remains. This test pins both halves from
// source, plus the projection contract with RoomBackdrop.tsx (room shell and
// render eye), so a future venue edit cannot quietly re-inflate the furniture.
const buildRoom = readFileSync(resolve(__dirname, '../../../tools/blender/build_room.py'), 'utf8');
const backdrop = readFileSync(resolve(__dirname, '../src/three/RoomBackdrop.tsx'), 'utf8');

// asset: [measured native size (m), real-world reference (m)] — measured from
// the Poly Haven 1k glTF bounds (see the venue-furniture-scale lane's
// MEASUREMENTS.md). Footballs are judged on length, the rest on height.
const EXPECTED_FIX: Record<string, [number, number]> = {
  SchoolChair_01: [1.006, 0.8],
  plastic_monobloc_chair_01: [0.88, 0.82],
  WoodenChair_01: [2.274, 0.92],
  BarberShopChair_01: [1.489, 1.25],
  ArmChair_01: [1.065, 0.95],
  GreenChair_01: [1.059, 0.95],
  modern_arm_chair_01: [1.023, 0.9],
  mid_century_lounge_chair: [1.169, 0.8],
  metal_stool_01: [0.883, 0.75],
  WoodenTable_01: [0.549, 0.75],
  painted_wooden_cabinet_02: [2.569, 2.0],
  steel_frame_shelves_03: [2.312, 1.9],
  vintage_microwave: [0.526, 0.32],
  boombox: [0.47, 0.3],
  vintage_oil_lamp: [0.802, 0.38],
  football: [0.509, 0.28],
  american_football: [0.453, 0.28],
  life_jacket: [0.992, 0.65],
  korean_fire_extinguisher_01: [0.659, 0.52],
  wooden_bucket_01: [0.55, 0.35],
  wooden_barrels_01: [0.957, 0.9],
};

function modelFixTable(src: string): Record<string, number> {
  const block = src.match(/MODEL_FIX\s*=\s*\{([\s\S]*?)\n\}/);
  if (!block) return {};
  const out: Record<string, number> = {};
  for (const m of block[1].matchAll(/'([A-Za-z0-9_]+)':\s*([0-9]*\.?[0-9]+)/g)) out[m[1]] = parseFloat(m[2]);
  return out;
}

describe('room furniture scale (build_room.py)', () => {
  it('carries a MODEL_FIX factor for every natively off-scale model, sized reference/native', () => {
    const fix = modelFixTable(buildRoom);
    expect(Object.keys(fix).sort()).toEqual(Object.keys(EXPECTED_FIX).sort());
    for (const [asset, [native, ref]] of Object.entries(EXPECTED_FIX)) {
      expect(Math.abs(fix[asset] - ref / native), `${asset} factor`).toBeLessThanOrEqual(0.01);
      // after correction the model lands within 10% of its real-world size
      expect(Math.abs(native * fix[asset] - ref) / ref, `${asset} lands at real size`).toBeLessThanOrEqual(0.1);
    }
  });

  it('applies MODEL_FIX inside prop(), which on() routes through', () => {
    const propBody = buildRoom.slice(buildRoom.indexOf('def prop('), buildRoom.indexOf('def area('));
    const onBody = buildRoom.slice(buildRoom.indexOf('def on('), buildRoom.indexOf('def shell('));
    expect(propBody).toContain('MODEL_FIX');
    // on() stands items on surfaces by delegating to prop(), so the single
    // application inside prop() covers both paths exactly once.
    expect(onBody).toContain('prop(asset');
  });

  it('has no placement multiplier above 1.0 (deliberate inflation was the defect)', () => {
    const over = [...buildRoom.matchAll(/SCALE\s*\*\s*([0-9]*\.?[0-9]+)/g)]
      .map((m) => parseFloat(m[1]))
      .filter((v) => v > 1.0);
    expect(over).toEqual([]);
  });

  it('keeps the RoomBackdrop projection contract: church shell and render eye match build_room.py', () => {
    const churchFn = buildRoom.slice(buildRoom.indexOf('def church():'));
    const dims = churchFn.match(/X, Y0, Y1, TOP = ([0-9.]+), (-[0-9.]+), ([0-9.]+), ([0-9.]+)/);
    expect(dims).not.toBeNull();
    const [, X, Y0, Y1, TOP] = dims!.map(Number);
    const shell = backdrop.match(/church:\s*\[([^\]]+)\]/)![1].split(',').map((s) => parseFloat(s));
    // RoomBackdrop shell is [hx, farZ, nearZ, ceil] in game axes; build_room
    // works in Blender axes where game z = -Blender y.
    expect(shell).toEqual([X, -Y1, -Y0, TOP]);
    const eye = buildRoom.match(/EYE = Vector\(\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)\)/)!;
    const roomEye = backdrop.match(/ROOM_EYE[^=]*=\s*\[([^\]]+)\]/)![1].split(',').map((s) => parseFloat(s));
    // game eye = (Blender x, Blender z, -Blender y)
    expect(roomEye).toEqual([Number(eye[1]), Number(eye[3]), -Number(eye[2])]);
  });
});
