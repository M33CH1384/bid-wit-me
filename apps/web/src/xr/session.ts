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
