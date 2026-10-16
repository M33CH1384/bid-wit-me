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
 * Faces that are on screen this frame. The trick and a Run it! slam are public the moment they
 * land: a bot's claimed cards were never in this viewer's hand, and a human claimer's cards have
 * already left it, so the one-per-frame hand painter would otherwise leave both on the card back.
 * Trick ids are kept even when a resize rebuilds the painter with only the hand still in the set.
 */
export function visibleFaceIds(prev: ReadonlySet<string>, painted: readonly string[], hand: readonly string[], trick: readonly string[], slam: readonly string[]): Set<string> {
  const instant = [...trick, ...slam];
  return trickFacesShown(prev, painted, new Set<string>([...hand, ...instant]), instant);
}

/**
 * Whether the camera-facing side is the painted face.
 * Trick cards, and a Run it! slam, stay face-up even when the painter set was cleared by a rebuild.
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
 *
 * `latched` means this hand's 3D fan has already been shown. A later painter restart
 * (a tap, a trick change, the face key resetting) must keep those meshes. Hiding them
 * again, while the felt fan is already gone, is a blank hand: the reload that never
 * draws, and the frame on your own turn where the fan disappears.
 */
export function showResumeHand3D(resume: boolean, handCount: number, facesReady: number, latched = false): boolean {
  if (!resume || handCount <= 0) return true;
  if (latched) return true;
  return facesReady >= handCount;
}

/** Hand number whose 3D fan is already on screen. Survives a remount of the card group. */
let latchedHandNo = -1;

export function handLatched(handNo: number): boolean {
  return latchedHandNo === handNo;
}

export function latchHand(handNo: number): void {
  latchedHandNo = handNo;
}

export function resetHandLatch(): void {
  latchedHandNo = -1;
}

/**
 * The flat fan covers whenever the 3D hand is not up. This does not depend on a saved
 * offline game: an online reload has cards in state and no save prop, and it still
 * has to show a hand on the first paint.
 */
export function feltHandVisible(cardCount: number, sceneResume: boolean, webglLive: boolean): boolean {
  return cardCount > 0 && sceneResume && !webglLive;
}

/**
 * Cards in state are on exactly one fan. Visible is the state count whenever that count
 * is positive: texture readiness may choose felt instead of WebGL, and it never chooses neither.
 */
export function presentHand(opts: {
  cardCount: number;
  /** introHand !== handNo. A live deal (intro) is already the 3D fan. */
  resume: boolean;
  latched: boolean;
  facesReady: number;
}): { webgl: boolean; felt: boolean; visible: number } {
  const { cardCount, resume, latched, facesReady } = opts;
  if (cardCount <= 0) return { webgl: false, felt: false, visible: 0 };
  const webgl = showResumeHand3D(resume, cardCount, facesReady, latched);
  return { webgl, felt: !webgl, visible: cardCount };
}

/**
 * Texture on the camera-facing side. Null means "not painted yet" and the mesh shows the back.
 * Once a face has been shown, a later null (painter reset, selection rerender) keeps that face.
 */
export function retainFrontTexture<T>(incoming: T | null, retained: T | null): T | null {
  return incoming ?? retained;
}
