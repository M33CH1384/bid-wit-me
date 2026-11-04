import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { roomYawForViewerSeat } from '../src/turnState';
import { seatDir, type SeatPos } from '../src/three/layout';
import { CHAIR_SPOTS } from '../src/three/classicStudioLayout';
import {
  isOwnSeatPos, isOwnSeatSpot, isSouthSeatPos, isSouthSeatSpot, ownSeatDirForYaw,
} from '../src/three/ownChair';

/**
 * ROOM VANTAGE (owner report 2026-11-03: "my partner sees the same thing
 * instead of the opposite view of the room"). The client's game model is
 * view space — the local player is always seat 0 at the bottom, plates,
 * hands, cards and figures already rotate per player — but the 3D ROOM
 * rendered in canonical orientation for everyone, so a north-seated
 * partner saw the south player's wall behind the south player's seat.
 *
 * The fix rotates ONLY the room layer in Scene by the viewer's seat yaw:
 * roomYawForViewerSeat (turnState.ts, beside localSeatOfServerTurn — the
 * same server-seat -> viewer-frame shift, for the room) takes the
 * viewer's canonical seat direction onto +z, the canonical camera side.
 * The play layer and camera never move. The own-chair skip follows the
 * same yaw: the chair left out is the one at the VIEWER's canonical seat
 * (ownChair's isOwnSeatSpot/isOwnSeatPos), not the fixed south spot.
 */

/** Table's seat-index -> view-position mapping (Table.tsx positions()). */
const POS = (n: number): SeatPos[] => (n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right']);

/** The bespoke rooms' local seat array (identical in all nine rooms). */
const LOCAL_SPOTS: { pos: [number, number, number]; ry: number }[] = [
  { pos: [0, -0.9, 1.98], ry: Math.PI },
  { pos: [2.14, -0.9, 0], ry: -Math.PI / 2 },
  { pos: [0, -0.9, -1.98], ry: 0 },
  { pos: [-2.14, -0.9, 0], ry: Math.PI / 2 },
];

/** The Legends rail dressing chairs — never seat chairs. */
const LEGENDS_RAIL = [
  { x: -4.15, z: -2.55 }, { x: -3.35, z: -4.15 },
  { x: 4.55, z: -2.45 }, { x: 4.55, z: -4.6 },
];

const dirOf = (seat: number, n: number): { x: number; z: number } => {
  const d = seatDir(POS(n)[seat]!, n);
  return { x: d.x, z: d.z };
};

describe('roomYawForViewerSeat — the room turns to the viewer\'s seat', () => {
  it('4p yaws are the four compass turns', () => {
    expect(roomYawForViewerSeat(0, 4)).toBeCloseTo(0, 12);
    expect(roomYawForViewerSeat(1, 4)).toBeCloseTo(Math.PI / 2, 12);
    expect(Math.abs(roomYawForViewerSeat(2, 4))).toBeCloseTo(Math.PI, 12);
    expect(roomYawForViewerSeat(3, 4)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('rotating the viewer\'s canonical seat direction by the yaw lands it on +z (the camera side), every seat, 3p and 4p', () => {
    for (const n of [3, 4]) {
      for (let seat = 0; seat < n; seat++) {
        const d = seatDir(POS(n)[seat]!, n);
        const v = d.clone().applyAxisAngle(new Vector3(0, 1, 0), roomYawForViewerSeat(seat, n));
        expect(v.x, `n=${n} seat=${seat}`).toBeCloseTo(0, 9);
        expect(v.z, `n=${n} seat=${seat}`).toBeCloseTo(1, 9);
      }
    }
  });

  it('every OTHER seat lands where the viewer\'s plates already put it', () => {
    // The play layer is view space: server seat s appears at local index
    // (s - viewer) mod n. After the room rotates by the viewer's yaw, the
    // room spot of server seat s must sit in that same direction.
    // 4p is exact. 3p is exact only for the viewer's own seat (above):
    // the game's 3p seat dirs are 120.14° apart, not 120° (seatDir's
    // 0.86/0.5 diagonals), so the other seats land within ~0.6° of their
    // local direction — the same slack that already sits between 3p
    // figures (diagonal) and the rooms' axis chairs in canonical view.
    // What must never happen is a side swap, so 3p also pins the signs.
    for (const n of [3, 4]) {
      for (let viewer = 0; viewer < n; viewer++) {
        const yaw = roomYawForViewerSeat(viewer, n);
        for (let s = 0; s < n; s++) {
          const local = ((s - viewer) % n + n) % n;
          const want = seatDir(POS(n)[local]!, n);
          const got = seatDir(POS(n)[s]!, n).applyAxisAngle(new Vector3(0, 1, 0), yaw);
          if (n === 4) {
            expect(got.x, `n=${n} viewer=${viewer} seat=${s}`).toBeCloseTo(want.x, 9);
            expect(got.z, `n=${n} viewer=${viewer} seat=${s}`).toBeCloseTo(want.z, 9);
          } else {
            expect(got.dot(want), `n=${n} viewer=${viewer} seat=${s}`).toBeGreaterThan(0.9999);
            const sgn = (v: number) => (Math.abs(v) < 1e-6 ? 0 : Math.sign(v));
            expect(sgn(got.x), `n=${n} viewer=${viewer} seat=${s}`).toBe(sgn(want.x));
            expect(sgn(got.z), `n=${n} viewer=${viewer} seat=${s}`).toBe(sgn(want.z));
          }
        }
      }
    }
  });

  it('Table still maps seat indexes to the view positions this math assumes', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain("return n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'];");
  });
});

describe('ownSeatDirForYaw — the own-chair skip follows the same yaw', () => {
  it('inverts roomYawForViewerSeat for every seat, 3p and 4p', () => {
    for (const n of [3, 4]) {
      for (let seat = 0; seat < n; seat++) {
        const dir = ownSeatDirForYaw(roomYawForViewerSeat(seat, n));
        const want = dirOf(seat, n);
        expect(dir.x, `n=${n} seat=${seat}`).toBeCloseTo(want.x, 9);
        expect(dir.z, `n=${n} seat=${seat}`).toBeCloseTo(want.z, 9);
      }
    }
  });

  it('yaw 0 is the canonical south seat', () => {
    expect(ownSeatDirForYaw(0)).toEqual({ x: 0, z: 1 });
  });
});

describe('isOwnSeatSpot / isOwnSeatPos — exactly the viewer\'s chair is skipped', () => {
  const compass: { name: string; seat: number }[] = [
    { name: 'south', seat: 0 }, { name: 'west', seat: 1 }, { name: 'north', seat: 2 }, { name: 'east', seat: 3 },
  ];
  for (const { name, seat } of compass) {
    it(`viewer at ${name}: classic CHAIR_SPOTS selects only the ${name} spot`, () => {
      const dir = dirOf(seat, 4);
      const want = CHAIR_SPOTS[seat === 0 ? 1 : seat === 1 ? 2 : seat === 2 ? 0 : 3]!;
      expect(CHAIR_SPOTS.filter((s) => isOwnSeatSpot(s, dir))).toEqual([want]);
    });
    it(`viewer at ${name}: bespoke local spots select only the ${name} spot`, () => {
      const dir = dirOf(seat, 4);
      const want = LOCAL_SPOTS[seat === 0 ? 0 : seat === 1 ? 3 : seat === 2 ? 2 : 1]!;
      expect(LOCAL_SPOTS.filter((s) => isOwnSeatPos(s.pos, dir))).toEqual([want]);
    });
  }

  it('3p side viewers select the nearest side chair (west for seat 1, east for seat 2)', () => {
    const west = CHAIR_SPOTS.find((s) => s.x < 0 && s.z === 0)!;
    const east = CHAIR_SPOTS.find((s) => s.x > 0 && s.z === 0)!;
    expect(CHAIR_SPOTS.filter((s) => isOwnSeatSpot(s, dirOf(1, 3)))).toEqual([west]);
    expect(CHAIR_SPOTS.filter((s) => isOwnSeatSpot(s, dirOf(2, 3)))).toEqual([east]);
  });

  it('no dressing/rail chair is ever the own seat, for any viewer direction', () => {
    for (const n of [3, 4]) {
      for (let seat = 0; seat < n; seat++) {
        const dir = dirOf(seat, n);
        for (const r of LEGENDS_RAIL) expect(isOwnSeatSpot(r, dir)).toBe(false);
      }
    }
  });

  it('the south direction reproduces today\'s isSouthSeat* answers exactly (local play unchanged)', () => {
    const south = dirOf(0, 4);
    for (const s of [...CHAIR_SPOTS, ...LEGENDS_RAIL]) {
      expect(isOwnSeatSpot(s, south)).toBe(isSouthSeatSpot(s));
    }
    for (const s of LOCAL_SPOTS) {
      expect(isOwnSeatPos(s.pos, south)).toBe(isSouthSeatPos(s.pos));
    }
  });
});

describe('vantage wiring — Table -> Scene -> room group + own-chair context', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  it('Table computes roomYaw from the online viewer seat, gated to seated non-story play', () => {
    const table = read('../src/Table.tsx');
    expect(table).toMatch(/roomYaw: !spectating && online != null && online\.viewerSeat != null && !\(storyStopId \?\? online\.storyStopId\) \? roomYawForViewerSeat\(online\.viewerSeat, n\) : 0,/);
    expect(table).toContain("import { actingSeat, localSeatOfServerTurn, roomYawForViewerSeat, turnView, type TurnBadge } from './turnState';");
  });

  it('Scene declares roomYaw, rotates the room layer by it, and keys the own-chair context to it', () => {
    const scene = read('../src/three/Scene.tsx');
    expect(scene).toContain('roomYaw?: number;');
    expect(scene).toContain('rotation={[0, roomYaw, 0]}');
    expect(scene).toContain('<OwnChairHiddenContext.Provider value={ownSeatView}>');
    expect(scene).toContain('ownSeatDirForYaw(roomYaw)');
    // the scene-global backdrop/environment turn by the same yaw
    expect(scene).toContain('<RoomYawEnv yaw={roomYaw} />');
    expect(scene).toContain('scene.backgroundRotation.set(0, yaw, 0)');
    expect(scene).toContain('scene.environmentRotation.set(0, yaw, 0)');
  });

  it('ownChair exposes the per-seat direction hook and keeps an all-chairs default', () => {
    const mod = read('../src/three/ownChair.ts');
    expect(mod).toContain('export function useOwnSeatDir(');
    expect(mod).toContain('export function isOwnSeatSpot(');
    expect(mod).toContain('export function isOwnSeatPos(');
    expect(mod).toContain('hidden: false');
  });
});
