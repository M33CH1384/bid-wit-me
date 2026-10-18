/** Vision-Pro-safe WebXR session helpers for the throwaway XR prototype.
 *
 * Why this exists (first real-headset test, Oct 2026: visionOS Safari = black screen):
 * the @react-three/xr defaults are hostile to visionOS Safari —
 *  - `buildXRSessionInit` puts 'local-floor' in requiredFeatures (plus a DOM-overlay root),
 *    and three's WebXRManager then does `await session.requestReferenceSpace('local-floor')`
 *    with no catch: if that one space is unavailable the session is already immersive,
 *    nothing is ever presented, and the user stares at a black void with no error anywhere.
 *  - the store also defaults to frameRate:'high', whose updateTargetFrameRate rejection
 *    can reject the whole enterVR() promise via Promise.all.
 * So: request NOTHING as required, offer the reference-space chain as optional, pick the
 * best space the granted session actually enabled at runtime, and log every step so a
 * failure is visible on the 2D page after exiting instead of being a silent black void.
 */

export const XR_REFERENCE_SPACE_CHAIN = ['local-floor', 'local', 'viewer'] as const;
export type XrReferenceSpaceType = (typeof XR_REFERENCE_SPACE_CHAIN)[number];

/** Session init for visionOS Safari: no required features, no domOverlay, no layers/anchors. */
export function buildVisionSafeSessionInit(): XRSessionInit {
  return {
    optionalFeatures: [...XR_REFERENCE_SPACE_CHAIN, 'hand-tracking'],
  };
}

/** True when the space is floor-anchored (real eye height comes from the pose itself). */
export function isFloorSpace(type: string | null | undefined): boolean {
  return type === 'local-floor' || type === 'bounded-floor';
}

/**
 * XROrigin Y offset for a granted space. With a floor space the pose already carries the
 * user's real eye height, so no offset. With 'local'/'viewer' the pose is at/near the
 * origin, so lift the origin to a plausible seated eye height or the table (y=0.72 in
 * world units) would sit above the user's eyes. Estimate only — device test confirms.
 */
export function originYOffset(type: string | null | undefined): number {
  return isFloorSpace(type) ? 0 : 1.25;
}

export interface XrSessionLike {
  enabledFeatures?: Iterable<string> | null;
  requestReferenceSpace(type: string): Promise<unknown>;
}

/**
 * Walk the fallback chain and apply the first reference space the session grants.
 * Spaces the session did not enable are skipped without requesting them (requesting an
 * ungranted feature throws on some browsers). Returns the granted type, or null when
 * every space failed — the caller then keeps three's own internal space and logs it.
 */
export async function pickReferenceSpace(
  session: XrSessionLike,
  apply: (space: unknown, type: XrReferenceSpaceType) => void,
  onSkip?: (type: XrReferenceSpaceType, reason: string) => void,
): Promise<XrReferenceSpaceType | null> {
  const enabled = session.enabledFeatures ? new Set(session.enabledFeatures) : null;
  for (const type of XR_REFERENCE_SPACE_CHAIN) {
    if (enabled && !enabled.has(type)) { onSkip?.(type, 'not in session.enabledFeatures'); continue; }
    try {
      const space = await session.requestReferenceSpace(type);
      apply(space, type);
      return type;
    } catch (e) {
      onSkip?.(type, describeXrError(e));
    }
  }
  return null;
}

export function describeXrError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'object' && e !== null) {
    const o = e as { name?: unknown; message?: unknown };
    if (typeof o.name === 'string' || typeof o.message === 'string') return `${String(o.name ?? 'Error')}: ${String(o.message ?? '')}`.trim();
  }
  return String(e);
}

export type XrPhase =
  | 'boot' | 'checking' | 'no-xr' | 'unsupported' | 'ready' | 'requesting'
  | 'presenting' | 'first-frame' | 'ended' | 'error';

export const XR_LOG_CAP = 60;

/** Append one timestamped line, keeping only the most recent XR_LOG_CAP lines. */
export function appendXrLog(lines: readonly string[], line: string, now = Date.now()): string[] {
  const stamp = new Date(now).toLocaleTimeString('en-US', { hour12: false });
  return [...lines.slice(-(XR_LOG_CAP - 1)), `${stamp} ${line}`];
}

/* ---- Round 2 (after #234 still black on a real Vision Pro) ---- */

/**
 * The reference-space type three's WebXRManager will request inside
 * setSession(). three (r180) does `await session.requestReferenceSpace(type)`
 * with NO catch: if that type was not granted, setSession rejects after the
 * headset is already immersive, the XR animation loop never starts, and the
 * user gets a permanent black void. So the type handed to three must be one
 * we have already verified against the granted session — never a guess the
 * library re-asserts behind our back (@react-three/xr re-set 'local-floor').
 */
export function chooseGrantedReferenceType(enabled: Iterable<string> | null | undefined): XrReferenceSpaceType | null {
  if (!enabled) return null;
  const set = new Set(enabled);
  return XR_REFERENCE_SPACE_CHAIN.find((t) => set.has(t)) ?? null;
}

/** Human line describing the session's base layer (framebuffer proof in the log). */
export function describeBaseLayer(session: { renderState?: { baseLayer?: { framebufferWidth?: number; framebufferHeight?: number } | null; layers?: unknown[] } } | null | undefined): string {
  const rs = session?.renderState;
  if (!rs) return 'renderState not available';
  if (rs.baseLayer) return `XRWebGLLayer ${rs.baseLayer.framebufferWidth ?? '?'}x${rs.baseLayer.framebufferHeight ?? '?'}`;
  if (rs.layers?.length) return `XR layers (${rs.layers.length} projection layer(s))`;
  return 'no baseLayer/layers in renderState yet';
}

export type SupportOutcome = 'supported' | 'unsupported' | 'timeout' | 'error';

/**
 * isSessionSupported with a deadline. On the Vision Pro the check was seen
 * stuck at "Checking..." — a hung support promise must not brick the page:
 * after the timeout the caller enables Enter VR anyway and lets the actual
 * requestSession (inside the tap) decide.
 */
export async function checkImmersiveSupport(
  xr: { isSessionSupported(mode: string): Promise<boolean> },
  timeoutMs = 3500,
): Promise<SupportOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timed = new Promise<'timeout'>((res) => { timer = setTimeout(() => res('timeout'), timeoutMs); });
    const result = await Promise.race([
      xr.isSessionSupported('immersive-vr').then((ok) => (ok ? 'supported' as const : 'unsupported' as const)),
      timed,
    ]);
    return result;
  } catch {
    return 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* Status-log persistence: the last session's log survives exit/reload and sits
 * at the TOP of the 2D page, so one ordinary screenshot captures the outcome. */
export const XR_LOG_STORAGE_KEY = 'bwm-xr-log-v2';

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function loadPersistedXrLog(storage: StorageLike | null | undefined): string[] {
  try {
    const raw = storage?.getItem(XR_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string').slice(-XR_LOG_CAP) : [];
  } catch { return []; }
}

export function savePersistedXrLog(storage: StorageLike | null | undefined, lines: readonly string[]): void {
  try { storage?.setItem(XR_LOG_STORAGE_KEY, JSON.stringify(lines.slice(-XR_LOG_CAP))); } catch { /* private mode etc: panel still works in-page */ }
}

/* Forgiving first-frame composition: the room is anchored to the FIRST real
 * XR eye pose, so the table sits in front of the user whatever reference
 * space was granted (local-floor / local / viewer, seated or standing). */

/** The viewer's designed seat in room-local coords (matches the 2D camera). */
export const XR_VIEWER_LOCAL = { x: 0, y: 1.25, z: 0.95 } as const;

/** Yaw (around Y) that turns room-local -Z onto the given world forward. */
export function yawFromForward(forwardX: number, forwardZ: number): number {
  return Math.atan2(-forwardX, -forwardZ);
}

/**
 * Room-group position for a given eye position + yaw: the eye lands exactly
 * on XR_VIEWER_LOCAL inside the room. Pure math, unit-tested.
 */
export function anchorGroupForEye(
  eye: { x: number; y: number; z: number },
  yaw: number,
): { x: number; y: number; z: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const vx = XR_VIEWER_LOCAL.x * c + XR_VIEWER_LOCAL.z * s;
  const vz = -XR_VIEWER_LOCAL.x * s + XR_VIEWER_LOCAL.z * c;
  return { x: eye.x - vx, y: eye.y - XR_VIEWER_LOCAL.y, z: eye.z - vz };
}
