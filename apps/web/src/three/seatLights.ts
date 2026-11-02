/**
 * Seated-player lighting (Desi's table-players SPEC §1, 2026-11-02; owner: "player lighting needs drastic
 * improvement"). Pure rig math + per-venue tuning — PersonaFigures mounts the lights, tests pin the numbers.
 *
 * Per opponent seat, aimed at the HEAD (never the felt):
 *  - KEY: warm spot, 35° off the seat's camera bisector on the camera-facing side (camera left on a tie), ~30° up.
 *  - RIM: venue-tinted spot behind/above, opposite the key — side seats (west/east) only: they are the
 *    profile-to-camera seats that sat in silhouette; north faces the camera and the felt bounce.
 *  - FILL: not a light — one cool hemisphere bias for all seats (key:fill ≈ 3:1, 2:1 on dark venues).
 * Phone budget (SPEC §1d): with the felt spot + the hand fill this is ≤ 7 real lights (3 keys + 2 rims + 2), no
 * per-seat shadow maps (the felt spot keeps the only one). Figures exist only at High, so Low has no per-seat
 * lights by construction; no device is downgraded.
 */
import { Color, Vector3 } from 'three';

export interface SeatLightTune {
  /** key intensity multiplier */ key: number;
  /** key colour (colour temperature) */ keyColor: string;
  /** fill (hemisphere bias) multiplier */ fill: number;
  /** rim colour before desaturation, and how far toward warm white it is pulled (0..1) */ rim: string; rimWhite: number;
  /** rim multiplier on the base rim */ rimK: number;
  /** extra key elevation (deg) for overhead practicals (chandelier, streetlight) */ steep: number;
}

/** SPEC §1c, all 12 venues. Kelvin → sRGB hex (Tanner Helland approximation, rounded). */
export const SEAT_LIGHT_TUNE: Record<string, SeatLightTune> = {
  classic: { key: 1.0, keyColor: '#ffd6aa', fill: 1.0, rim: '#9b5cff', rimWhite: 0.5, rimK: 1, steep: 0 },     // 4300 K
  backyard: { key: 0.9, keyColor: '#ffd1a3', fill: 1.2, rim: '#ffb35c', rimWhite: 0.5, rimK: 1, steep: 0 },     // 4000 K
  mansion: { key: 1.0, keyColor: '#ffdab3', fill: 1.1, rim: '#ffd27a', rimWhite: 0.5, rimK: 1, steep: 10 },     // 4500 K
  barbershop: { key: 1.0, keyColor: '#ffe4ce', fill: 1.0, rim: '#ff2e55', rimWhite: 0.7, rimK: 1, steep: 0 },   // 5000 K, pole neon at 30%
  church: { key: 0.95, keyColor: '#ffe8d7', fill: 1.3, rim: '#bcd7ff', rimWhite: 0.5, rimK: 1, steep: 0 },      // 5200 K
  rooftop: { key: 1.1, keyColor: '#ffd1a3', fill: 0.8, rim: '#ff4fd8', rimWhite: 0.4, rimK: 1.4, steep: 0 },   // 4000 K, night: rim strongest
  speakeasy: { key: 1.15, keyColor: '#ffbb7b', fill: 0.7, rim: '#ff8a3d', rimWhite: 0.5, rimK: 1.2, steep: 0 }, // 3200 K, low-key
  vegas: { key: 1.0, keyColor: '#ffcb98', fill: 1.0, rim: '#ffcc33', rimWhite: 0.5, rimK: 1, steep: 0 },        // 3800 K
  beach: { key: 0.9, keyColor: '#ffc287', fill: 1.2, rim: '#ff7a3d', rimWhite: 0.5, rimK: 1, steep: 0 },        // 3400 K
  grandma: { key: 0.95, keyColor: '#ffd4a6', fill: 1.2, rim: '#ffd9a0', rimWhite: 0.5, rimK: 1, steep: 0 },     // 4200 K
  yacht: { key: 0.9, keyColor: '#fff0e9', fill: 1.3, rim: '#7fd0ff', rimWhite: 0.5, rimK: 1, steep: 0 },        // 5600 K
  blockAfterDark: { key: 1.15, keyColor: '#ffb46b', fill: 0.7, rim: '#7fa8ff', rimWhite: 0.5, rimK: 1.2, steep: 15 }, // 3000 K sodium
};
export const tuneFor = (venue: string): SeatLightTune => SEAT_LIGHT_TUNE[venue] ?? SEAT_LIGHT_TUNE.classic!;

/** Base intensities (physical, decay 2). Desi's proof at KEY 14 only lifted a side face ~12 → ~22/255, so the
 *  base starts hotter and is tuned against real 390x844 / 844x390 captures (see the PR's luma table). */
export const SEAT_KEY_INTENSITY = 34;
export const SEAT_RIM_INTENSITY = 16;
/** Fill: a cool hemisphere bias (sky, ground) added while figures are seated; ×tune.fill. */
export const SEAT_FILL_INTENSITY = 0.55;
export const SEAT_FILL_SKY = '#dfe8ff';   // 5600 K
export const SEAT_FILL_GROUND = '#3a3026';
/** The felt spot while figures are seated (×def.keyK): 70 → 45, so the felt stops out-shining the faces. */
export const FELT_KEY_SEATED = 45;
/** Head line above the table top (the gaze anchors' head line + a little: aim at the face, not the chin). */
export const SEAT_HEAD_Y = 0.46;

const KEY_YAW = (35 * Math.PI) / 180;
const KEY_DIST = 1.0, KEY_UP = 0.55, RIM_BACK = 0.8, RIM_SIDE = 0.35, RIM_UP = 0.55;

export interface SeatRig { head: Vector3; key: Vector3; rim: Vector3 }

const rotY = (v: Vector3, a: number) => new Vector3(v.x * Math.cos(a) + v.z * Math.sin(a), 0, -v.x * Math.sin(a) + v.z * Math.cos(a));

/**
 * World positions for one seat's key and rim. `outward` = seatDir (table centre → seat, flat); `cam` = camera
 * world position; `camRight` = the camera's right vector (flat). Key: the bisector of (seat→table, seat→camera)
 * turned 35° toward the camera's left, 1 m out, 0.55 m up (+steep). Rim: behind the head from the camera, on the
 * side opposite the key, 0.55 m up.
 */
export function seatRig(chair: { x: number; z: number }, outward: Vector3, cam: Vector3, camRight: Vector3, steepDeg = 0): SeatRig {
  const head = new Vector3(chair.x, SEAT_HEAD_Y, chair.z);
  const F = new Vector3(-outward.x, 0, -outward.z).normalize();
  const C = new Vector3(cam.x - head.x, 0, cam.z - head.z).normalize();
  const B = F.clone().add(C);
  if (B.lengthSq() < 1e-6) B.copy(F); else B.normalize();
  const r = new Vector3(camRight.x, 0, camRight.z).normalize();
  const a = rotY(B, KEY_YAW), b = rotY(B, -KEY_YAW);
  // The side of the bisector that faces the camera more (the cheek the camera actually sees: side seats sit in
  // profile, and the table-side choice left their visible face in shadow on real captures); ties → camera left.
  const da = a.dot(C), db = b.dot(C);
  const keyDir = Math.abs(da - db) > 0.05 ? (da > db ? a : b) : (a.dot(r) <= b.dot(r) ? a : b);
  const up = KEY_UP + Math.tan((steepDeg * Math.PI) / 180) * KEY_DIST;
  const key = head.clone().addScaledVector(keyDir, KEY_DIST).add(new Vector3(0, up, 0));
  const side = keyDir.dot(r) < 0 ? r : r.clone().negate(); // opposite the key
  const rim = head.clone().addScaledVector(C, -RIM_BACK).addScaledVector(side, RIM_SIDE).add(new Vector3(0, RIM_UP, 0));
  return { head, key, rim };
}

/** The venue rim colour pulled `t` toward warm white (SPEC: "desaturated toward warm white"). */
export function rimColor(tune: SeatLightTune): string {
  return '#' + new Color(tune.rim).lerp(new Color('#fff1e0'), tune.rimWhite).getHexString();
}
