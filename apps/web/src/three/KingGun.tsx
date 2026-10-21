/**
 * The King's revolver (double or nothing, leg 2) — a period revolver lying
 * flat on the felt in front of his seat, in the game's firearm register
 * (the Pj's Iron deck's vintage steel): blued steel, a walnut grip, no
 * ornament beyond a brass cylinder pin. Placed, never pointed at a seat,
 * never touched during play, never fired — a threat display, not an
 * action. It is on the table for exactly the matches the double is live
 * (Scene's kingGunSeat prop, keyed to the double-pending state in Table),
 * and nowhere else.
 *
 * Built muzzle-along-+X in plan (the side profile faces up): barrel and
 * rib toward +X, the grip sweeping back toward -X and down-profile (+Z).
 * The group takes the kingGunSpot transform; the inner offset centres the
 * model's bounding box on the spot, matching KING_GUN_FOOTPRINT.
 */
import { useMemo } from 'react';
import { Quaternion } from 'three';
import type { Xform } from './layout';

const STEEL = { color: '#3b3e44', metalness: 0.88, roughness: 0.38 } as const;
const STEEL_DARK = { color: '#232529', metalness: 0.8, roughness: 0.5 } as const;
const WOOD = { color: '#4b3018', metalness: 0.05, roughness: 0.78 } as const;
const BRASS = { color: '#8a6d3b', metalness: 0.9, roughness: 0.35 } as const;

export default function KingGun({ spot, quality }: { spot: Xform; quality: 'high' | 'low' }) {
  const q = useMemo(() => new Quaternion(...spot.q), [spot]);
  const shadow = quality === 'high';
  return (
    <group position={spot.p} quaternion={q} name="king-gun">
      <group position={[-0.06, 0, -0.087]}>
        {/* the cylinder (drum): a circle in plan, banded, brass centre pin */}
        <mesh position={[0, 0.021, 0.002]} castShadow={shadow}>
          <cylinderGeometry args={[0.036, 0.036, 0.042, 28]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[0, 0.021, 0.002]} castShadow={shadow}>
          <cylinderGeometry args={[0.0375, 0.0375, 0.012, 28]} />
          <meshStandardMaterial {...STEEL_DARK} />
        </mesh>
        <mesh position={[0, 0.021, 0.002]}>
          <cylinderGeometry args={[0.007, 0.007, 0.046, 12]} />
          <meshStandardMaterial {...BRASS} />
        </mesh>
        {/* barrel + top rib + muzzle + front sight */}
        <mesh position={[0.185, 0.023, -0.007]} castShadow={shadow}>
          <boxGeometry args={[0.31, 0.026, 0.02]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[0.185, 0.023, -0.0195]}>
          <boxGeometry args={[0.31, 0.026, 0.005]} />
          <meshStandardMaterial {...STEEL_DARK} />
        </mesh>
        <mesh position={[0.342, 0.023, -0.007]} castShadow={shadow}>
          <boxGeometry args={[0.008, 0.028, 0.022]} />
          <meshStandardMaterial {...STEEL_DARK} />
        </mesh>
        <mesh position={[0.328, 0.023, -0.019]}>
          <boxGeometry args={[0.014, 0.024, 0.012]} />
          <meshStandardMaterial {...STEEL_DARK} />
        </mesh>
        {/* underlug beneath the barrel */}
        <mesh position={[0.135, 0.021, 0.006]} castShadow={shadow}>
          <boxGeometry args={[0.19, 0.02, 0.015]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        {/* frame over and behind the drum, hammer at the rear */}
        <mesh position={[-0.015, 0.021, 0.002]} castShadow={shadow}>
          <boxGeometry args={[0.16, 0.03, 0.03]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[-0.105, 0.021, 0.008]} castShadow={shadow}>
          <boxGeometry args={[0.09, 0.028, 0.024]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[-0.152, 0.023, -0.008]} rotation={[0, 0.5, 0]}>
          <boxGeometry args={[0.03, 0.02, 0.013]} />
          <meshStandardMaterial {...STEEL_DARK} />
        </mesh>
        {/* trigger + guard, under the frame */}
        <mesh position={[-0.038, 0.018, 0.026]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.021, 0.0035, 8, 20]} />
          <meshStandardMaterial {...STEEL_DARK} />
        </mesh>
        <mesh position={[-0.038, 0.018, 0.02]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[0.006, 0.016, 0.02]} />
          <meshStandardMaterial {...STEEL_DARK} />
        </mesh>
        {/* walnut grip sweeping back, rounded butt */}
        <mesh position={[-0.148, 0.02, 0.082]} rotation={[0, -0.42, 0]} castShadow={shadow}>
          <boxGeometry args={[0.052, 0.03, 0.165]} />
          <meshStandardMaterial {...WOOD} />
        </mesh>
        <mesh position={[-0.186, 0.019, 0.163]} scale={[1, 0.55, 1.25]} castShadow={shadow}>
          <sphereGeometry args={[0.033, 18, 12]} />
          <meshStandardMaterial {...WOOD} />
        </mesh>
      </group>
    </group>
  );
}
