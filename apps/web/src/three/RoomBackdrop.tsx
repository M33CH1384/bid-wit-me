/**
 * A venue's room, path-traced in Blender (tools/blender/build_room.py) from the player's eye and shown as a cube
 * map behind the table. Six 1024px faces instead of one panorama: about four times the detail per degree for the
 * same memory, and no single texture past a phone's size limit. The table never waits for it.
 */
import { useThree } from '@react-three/fiber';
import { useEffect, useSyncExternalStore } from 'react';
import { CubeTextureLoader, SRGBColorSpace } from 'three';

export function roomFaceUrls(id: string): string[] {
  return ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((f) => `/assets/rooms/${id}/${f}.jpg`);
}

export function roomEnvUrl(id: string): string {
  return `/assets/rooms/${id}/env.hdr`;
}

/**
 * Whether a rendered room is on screen. A tiny store rather than props: the studio shell, the table's ground plane
 * and the seat-vantage turn all stand down while it is up, and they sit in different branches of the scene.
 */
let shownNow = false;
let failedNow = false;
const listeners = new Set<() => void>();
function setShown(v: boolean): void { if (shownNow !== v) { shownNow = v; listeners.forEach((fn) => fn()); } }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useRoomShown(): boolean {
  return useSyncExternalStore(subscribe, () => shownNow, () => false);
}
/** The room's files could not be fetched: the venue's built-in room should show instead. */
export function useRoomFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failedNow, () => false);
}
function setFailed(v: boolean): void { if (failedNow !== v) { failedNow = v; listeners.forEach((fn) => fn()); } }

export default function RoomBackdrop({ id, active, onShown }: { id: string; active: boolean; onShown?: () => void }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const prev = { bg: scene.background, blur: scene.backgroundBlurriness, k: scene.backgroundIntensity };
    let shown = false;
    const tex = new CubeTextureLoader().load(roomFaceUrls(id), () => {
      if (!alive) { tex.dispose(); return; }
      tex.colorSpace = SRGBColorSpace;
      scene.background = tex;
      scene.backgroundBlurriness = 0;
      scene.backgroundIntensity = 1;
      shown = true;
      setShown(true);
      (window as unknown as { __bwmRoomAt?: number }).__bwmRoomAt ??= performance.now();
      onShown?.();
      invalidate();
    }, undefined, () => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      setShown(false);
      setFailed(false);
      if (shown && scene.background === tex) { scene.background = prev.bg; scene.backgroundBlurriness = prev.blur; scene.backgroundIntensity = prev.k; }
      tex.dispose();
      invalidate();
    };
  }, [id, active, scene, invalidate, onShown]);
  return null;
}
