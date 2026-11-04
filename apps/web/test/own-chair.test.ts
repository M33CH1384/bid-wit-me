import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAIR_SPOTS } from '../src/three/classicStudioLayout';
import { isSouthSeatPos, isSouthSeatSpot } from '../src/three/ownChair';

/**
 * THE OWN-CHAIR RULE (owner, 2026-11-02: "I shouldn't see my chair in
 * the frame"). The camera anchors at local seat 0 (south) in every
 * mode; in local play that seat is first-person and never carries a
 * figure, so the chair every room builds at the south spot renders
 * bare in the lower frame. The fix: rooms consume Scene's
 * OwnChairHiddenContext (provided from Table's spectator flag) and do
 * not build the south chair in a local seated scene; spectator /
 * watch / broadcast surfaces keep all four chairs (the anchor seat
 * there is a real participant — a bot seated at south carries a
 * figure that needs its chair).
 *
 * This suite pins (a) the south-spot predicates against the REAL spot
 * data of every chair-building room, (b) the wiring Table -> Scene ->
 * context, and (c) a census sweep: every file in src/three that
 * builds seat chairs from CHAIR_SPOTS must apply the guard at exactly
 * one site — a future room that builds seat chairs without the guard
 * fails here until its site joins the census.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** The bespoke rooms' local seat array (identical in all nine, source-verified). */
const LOCAL_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, -0.9, 1.98], ry: Math.PI },
  { pos: [2.14, -0.9, 0], ry: -Math.PI / 2 },
  { pos: [0, -0.9, -1.98], ry: 0 },
  { pos: [-2.14, -0.9, 0], ry: Math.PI / 2 },
];

/** The Legends rail dressing chairs (LegendsTableRoom) — never seat chairs. */
const LEGENDS_RAIL = [
  { x: -4.15, z: -2.55 }, { x: -3.35, z: -4.15 },
  { x: 4.55, z: -2.45 }, { x: 4.55, z: -4.6 },
];

describe('own-chair predicates over the real spot data', () => {
  it('classic CHAIR_SPOTS: exactly the (0, +2.8) spot is south', () => {
    expect(CHAIR_SPOTS.filter(isSouthSeatSpot)).toEqual([{ x: 0, z: 2.8, ry: Math.PI }]);
    // the other three seats keep their chairs, at their canonical spots
    expect(CHAIR_SPOTS.filter((s) => !isSouthSeatSpot(s))).toEqual([
      { x: 0, z: -2.45, ry: 0 },
      { x: -2.3, z: 0, ry: Math.PI / 2 },
      { x: 2.3, z: 0, ry: -Math.PI / 2 },
    ]);
  });

  it('bespoke local arrays: exactly the [0, y, +1.98] spot is south', () => {
    expect(LOCAL_SPOTS.filter((s) => isSouthSeatPos(s.pos))).toEqual([LOCAL_SPOTS[0]]);
    expect(LOCAL_SPOTS.filter((s) => !isSouthSeatPos(s.pos))).toEqual(LOCAL_SPOTS.slice(1));
  });

  it('no Legends rail chair is a south seat spot', () => {
    for (const r of LEGENDS_RAIL) expect(isSouthSeatSpot(r)).toBe(false);
  });

  it('every bespoke room file carries the identical local array, south first', () => {
    const files = [
      'BarbershopMirrorRoom', 'BeachCabanaRoom', 'ChurchBasementRoom', 'CookoutYardRoom',
      'GrandmasKitchenRoom', 'RooftopSkylineRoom', 'SpeakeasyLoungeRoom', 'VegasCasinoRoom',
      'YachtDeckRoom',
    ];
    for (const f of files) {
      const src = read(`../src/three/${f}.tsx`);
      const decl = src.indexOf('const CHAIR_SPOTS');
      const arrStart = src.indexOf('= [', decl);
      const block = src.slice(arrStart, src.indexOf('\n];', arrStart));
      const triples = [...block.matchAll(/pos: \[(-?[\d.]+), [A-Z_]+, (-?[\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(triples, f).toEqual([[0, 1.98], [2.14, 0], [0, -1.98], [-2.14, 0]]);
      const south = triples.filter(([x, z]) => isSouthSeatPos([x!, 0, z!]));
      expect(south, f).toEqual([[0, 1.98]]);
    }
  });
});

describe('own-chair wiring', () => {
  it('Table passes its spectating flag to Scene', () => {
    const table = read('../src/Table.tsx');
    expect(table).toContain('spectator: spectating,');
  });

  it('Scene declares the prop and provides the context from its negation', () => {
    const scene = read('../src/three/Scene.tsx');
    expect(scene).toContain('spectator?: boolean;');
    expect(scene).toContain('<OwnChairHiddenContext.Provider value={!props.spectator}>');
    expect(scene).toContain("import { OwnChairHiddenContext } from './ownChair';");
  });

  it('the context defaults to keeping every chair (out-of-Scene renders unchanged)', () => {
    const mod = read('../src/three/ownChair.ts');
    expect(mod).toContain('createContext(false)');
    expect(mod).toContain('export function useOwnChairHidden()');
    expect(mod).toContain('export function isSouthSeatSpot(');
    expect(mod).toContain('export function isSouthSeatPos(');
  });
});

describe('chair-site census — every seat-chair builder applies the guard once', () => {
  const threeDir = new URL('../src/three/', import.meta.url);
  const builders = readdirSync(threeDir)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .filter((f) => {
      const src = readFileSync(new URL(f, threeDir), 'utf8');
      return src.includes('for (const spot of CHAIR_SPOTS)')
        || src.includes('CHAIR_SPOTS.map(')
        || src.includes('[...CHAIR_SPOTS, ...rail].map(');
    })
    .sort();

  it('the census finds exactly the twenty known chair builders', () => {
    expect(builders).toEqual([
      'BarbershopMirrorRoom.tsx', 'BarbershopRoom.tsx', 'BeachCabanaRoom.tsx',
      'ChurchBasementRoom.tsx', 'ClassicStudio.tsx', 'CookoutYardRoom.tsx',
      'CornerStreetRoom.tsx', 'GrandmasKitchenRoom.tsx', 'HighRisePenthouseRoom.tsx',
      'KingLoungeRoom.tsx', 'LegendsTableRoom.tsx', 'PjsStreetRoom.tsx',
      'PorchDeckRoom.tsx', 'RecCenterGymRoom.tsx', 'RooftopDuskRoom.tsx',
      'RooftopSkylineRoom.tsx', 'SpeakeasyLoungeRoom.tsx', 'VegasCasinoRoom.tsx',
      'YachtDeckRoom.tsx', 'cubeVenue.tsx',
    ]);
  });

  it('each builder consumes the context and guards exactly one chair site', () => {
    for (const f of builders) {
      const src = readFileSync(new URL(f, threeDir), 'utf8');
      expect(src, f).toContain('useOwnChairHidden()');
      expect(src, f).toContain("from './ownChair'");
      const guards = src.match(/hideOwnChair &&/g) ?? [];
      expect(guards.length, f).toBe(1);
      // the guard sits at the chair site: a JSX room returns null for the
      // south entry inside its CHAIR_SPOTS map; a GLB loop skips the clone
      if (src.includes('for (const spot of CHAIR_SPOTS)')) {
        expect(src, f).toContain('if (hideOwnChair && isSouthSeatSpot(spot)) continue;');
      } else {
        expect(src, f).toMatch(/if \(hideOwnChair && (i < CHAIR_SPOTS\.length && )?isSouthSeat(Spot|Pos)\((s|pos)\)\) return null;/);
      }
    }
  });

  it('dressing chairs are not guarded (BarberChairs, rail, stacks stay)', () => {
    const barber = read('../src/three/BarbershopMirrorRoom.tsx');
    const dressing = barber.slice(barber.indexOf('function BarberChairs'));
    expect(dressing).not.toContain('hideOwnChair');
    const legends = read('../src/three/LegendsTableRoom.tsx');
    // the rail portion of the Legends map is reached only past the seat
    // portion's length bound in the guard itself
    expect(legends).toContain('i < CHAIR_SPOTS.length && isSouthSeatSpot(s)');
  });
});
