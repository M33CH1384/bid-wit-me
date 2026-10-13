/**
 * Card ids whose front has already been painted this hand.
 * The painter walks the hand one card per frame and starts over when its key changes.
 * A selection rerender must keep every card that already resolved to its face: the front
 * mesh is rebuilt on the BWM back the moment the id drops out.
 */
export function shownFaceIds(prev: ReadonlySet<string>, painted: readonly string[], stillHere: ReadonlySet<string>): Set<string> {
  const next = new Set<string>();
  for (const id of prev) if (stillHere.has(id)) next.add(id);
  for (const id of painted) if (stillHere.has(id)) next.add(id);
  return next;
}

/**
 * Texture on the camera-facing side. Null means "not painted yet" and the mesh shows the back.
 * Once a face has been shown, a later null (painter reset, selection rerender) keeps that face.
 */
export function retainFrontTexture<T>(incoming: T | null, retained: T | null): T | null {
  return incoming ?? retained;
}
