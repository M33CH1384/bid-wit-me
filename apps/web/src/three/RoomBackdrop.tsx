/**
 * A venue's room, path-traced in Blender (tools/blender/build_room.py) from the player's eye as a cube map.
 *
 * The picture is NOT shown as a sky at infinity. It is projected, from the eye point it was rendered at, onto a
 * box with the room's real dimensions (floor, walls and ceiling where they actually are). So when the camera
 * moves — the player's zoom is a dolly toward the table, and standing/sitting are different eye points — the room
 * shifts and grows the way a room does, instead of standing still while the table grows in front of it (owner,
 * 2026-11-11: "the entire table and characters grow but the room stays the same"). Flat surfaces are exact;
 * furniture is painted onto them, which holds up for the small moves the camera makes.
 *
 * Six 1024–1536px faces instead of one panorama: about four times the detail per degree for the same memory,
 * and no single texture past a phone's size limit. The table never waits for it.
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BackSide, BoxGeometry, type CubeTexture, CubeTextureLoader, ShaderMaterial, SRGBColorSpace, Vector3 } from 'three';

export function roomFaceUrls(id: string): string[] {
  return ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((f) => `/assets/rooms/${id}/${f}.jpg`);
}

export function roomEnvUrl(id: string): string {
  return `/assets/rooms/${id}/env.hdr`;
}

/** The eye point every room is rendered from (build_room.py EYE, in game axes: x, y up, z toward the player). */
export const ROOM_EYE: [number, number, number] = [0, 3.9, 3.55];
const FLOOR_Y = -0.9;

/**
 * The shell each picture is projected onto, in game axes: half-width, far wall z, near wall z, ceiling y.
 * Indoor rooms use the walls build_room.py built (its X, -Y1, -Y0, TOP). Outdoor venues have no walls: the ground
 * is exact and the surroundings sit on a wide shell kept inside the camera's far plane.
 */
const OPEN: [number, number, number, number] = [34, -34, 34, 30];
export const ROOM_SHELL: Record<string, [number, number, number, number]> = {
  classic: [10, -10.5, 10, 7.4],
  mansion: [11, -11, 10, 9.0],
  barbershop: [10, -10, 10, 7.2],
  church: [12, -11.5, 10, 6.6],
  speakeasy: [9.5, -10, 10, 6.6],
  vegas: [12, -11.5, 10, 7.8],
  grandma: [9.5, -9.5, 10, 6.6],
  backyard: OPEN, rooftop: OPEN, beach: OPEN, yacht: OPEN,
};

/**
 * Whether a rendered room is on screen. A tiny store rather than props: the studio shell, the table's ground plane
 * and the seat-vantage turn all stand down while it is up, and they sit in different branches of the scene.
 */
let shownNow = false;
let failedNow = false;
const listeners = new Set<() => void>();
function setShown(v: boolean): void { if (shownNow !== v) { shownNow = v; listeners.forEach((fn) => fn()); } }
function setFailed(v: boolean): void { if (failedNow !== v) { failedNow = v; listeners.forEach((fn) => fn()); } }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useRoomShown(): boolean {
  return useSyncExternalStore(subscribe, () => shownNow, () => false);
}
/** The room's files could not be fetched: the venue's built-in room should show instead. */
export function useRoomFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failedNow, () => false);
}

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// Look the picture up along the ray from the render eye to this point of the shell. three.js samples a cube map
// with x flipped (the faces are stored the way build_room.py's FACES table documents), so the same flip is here.
const FRAG = /* glsl */ `
uniform samplerCube room;
uniform vec3 eye;
varying vec3 vWorld;
void main() {
  vec3 d = vWorld - eye;
  gl_FragColor = textureCube(room, vec3(-d.x, d.y, d.z));
  #include <colorspace_fragment>
}`;

export default function RoomBackdrop({ id, active, onShown }: { id: string; active: boolean; onShown?: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const [tex, setTex] = useState<CubeTexture | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const t = new CubeTextureLoader().load(roomFaceUrls(id), () => {
      if (!alive) { t.dispose(); return; }
      t.colorSpace = SRGBColorSpace;
      setTex(t);
      setShown(true);
      (window as unknown as { __bwmRoomAt?: number }).__bwmRoomAt ??= performance.now();
      onShown?.();
      invalidate();
    }, undefined, () => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      setShown(false);
      setFailed(false);
      setTex(null);
      t.dispose();
      invalidate();
    };
  }, [id, active, invalidate, onShown]);

  const shell = ROOM_SHELL[id] ?? OPEN;
  const geometry = useMemo(() => {
    const [hx, zFar, zNear, top] = shell;
    const g = new BoxGeometry(hx * 2, top - FLOOR_Y, zNear - zFar);
    g.translate(0, (top + FLOOR_Y) / 2, (zNear + zFar) / 2);
    return g;
  }, [shell]);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { room: { value: null }, eye: { value: new Vector3(...ROOM_EYE) } },
    vertexShader: VERT, fragmentShader: FRAG, side: BackSide, depthWrite: false, toneMapped: false, fog: false,
  }), []);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { material.dispose(); }, [material]);
  if (!tex) return null;
  material.uniforms.room!.value = tex;
  // Drawn first and without writing depth: everything in the scene is inside the shell, so it is always behind.
  return <mesh geometry={geometry} material={material} renderOrder={-1000} frustumCulled={false} />;
}
