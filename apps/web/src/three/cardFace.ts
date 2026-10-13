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
 * Cards in the current trick are public and few. They must show their faces on the frame they
 * land, not after the hand's one-per-frame painter walks past them (that walk resets whenever
 * the trick changes, so a centre card can sit on the BWM back for the whole turn).
 */
export function trickFacesShown(prev: ReadonlySet<string>, painted: readonly string[], stillHere: ReadonlySet<string>, trick: readonly string[]): Set<string> {
  const next = shownFaceIds(prev, painted, stillHere);
  // The current trick is public even when a rebuild's "still here" set is only the cards
  // left in the hand (a resize resets the painter, and a played card is no longer in the hand).
  // Gating on stillHere dropped those ids and the front mesh came back as the BWM back.
  for (const id of trick) if (id) next.add(id);
  return next;
}

/**
 * Whether the camera-facing side is the painted face.
 * Trick cards stay face-up even when the painter set was cleared by a rebuild.
 * A card that has left the trick falls through to that set, which drops it once it leaves the hand.
 */
export function cardShowsFace(id: string | null, shown: ReadonlySet<string>, trick: readonly string[]): boolean {
  if (!id) return false;
  for (const played of trick) if (played === id) return true;
  return shown.has(id);
}

/**
 * A resumed hand paints one face per frame. Until that finishes, the flat felt fan is the hand.
 * Drawing the 3D fan in the same slot stacks a face-up fan on a face-down one.
 */
export function showResumeHand3D(resume: boolean, handCount: number, facesReady: number): boolean {
  if (!resume || handCount <= 0) return true;
  return facesReady >= handCount;
}

/**
 * Texture on the camera-facing side. Null means "not painted yet" and the mesh shows the back.
 * Once a face has been shown, a later null (painter reset, selection rerender) keeps that face.
 */
export function retainFrontTexture<T>(incoming: T | null, retained: T | null): T | null {
  return incoming ?? retained;
}
