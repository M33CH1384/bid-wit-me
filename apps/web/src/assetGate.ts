/**
 * Asset gate (owner, 2026-10-28: "The loading screen should stay up until all
 * assets for a room are loaded including the cards").
 *
 * The table loader used to dismiss on two conditions — the cloth dressed and
 * the effects warmed — while the room around the table (backdrop, lighting
 * environment, the 3D rooms' models and textures) and the deck's art were
 * still streaming in, so the player landed at a table that popped in around
 * them. This module is the readiness registry the dismissal now also waits on:
 *
 *  - Table registers what it can enumerate up front: the venue's files
 *    (venues.ts `venueAssetUrls`), the street rooms' sedan GLB, the deck in
 *    use (every art face + the back, via decks.ts), and the seated faces the
 *    table presents (story portraits / persona portraits).
 *  - The three layer's own warm-up passes (preloadVenueAssets, the cube-room
 *    preloads, Classic Studio, the Barbershop) NOTE their file lists into the
 *    ledger below as they run, and Table folds its venue's ledger into the
 *    same gate — one list, no second copy to drift.
 *
 * Failure semantics: an asset that errors SETTLES the gate (the game's own
 * fallbacks engage — Suspense flat colour / static backdrop path, the
 * painted card face) and is named on the probe. An asset that never answers
 * is bounded by ASSET_GATE_CAP_MS: the gate settles anyway, flagged
 * `cappedOut`. Nothing here changes WHAT loads — only when the loader
 * lets go. A fully cached room settles in microtasks and adds no delay
 * beyond the loader's existing floors.
 *
 * three-free by construction: Table (entry graph) imports this module, so
 * nothing here may reach three.js. The three layer imports the ledger
 * helpers from inside the Scene chunk, which is the allowed direction.
 */
import { tableStillLoading } from './effects/warm';

/**
 * The bounded wait. Chosen to sit well under the loader's existing 40 s
 * give-up (which stays as the outer bound) and well above a cold load of
 * the heaviest room on a slow connection: the Pj's street set (sedan GLB
 * ~1.2 MB + backdrop + the deck's art) is a few seconds even throttled.
 * Past this, holding the player costs more than the pop-in it prevents,
 * and the fallback paths are already on screen behind the loader.
 */
export const ASSET_GATE_CAP_MS = 20_000;

/** The Forge sedan the Pj's street and the story Corner both park at the kerb.
 *  PjsStreetRoom owns the loader-facing copy (SEDAN_URL); a pin test keeps the
 *  two strings equal so the gate can name the file without importing three. */
export const SEDAN_GLB_URL = '/assets/venues/blockAfterDark/sedan.glb';

/**
 * The Porch pilot's cast (character phase step 2, owner go 2026-10-28):
 * the three rigged figures seated at the solo Porch story table.
 * three/PorchFigures.tsx imports this same list for its id -> URL map —
 * one copy, no drift. The production GLBs are the sandbox graft batch's
 * deliverables (Dee and Pat carry grafted hands; Ray is his 2-chain
 * partial rig), renamed to their character ids.
 */
export const PORCH_FIGURE_GLBS: readonly { id: string; label: string; url: string }[] = [
  { id: 'dee', label: 'glb figure (Porch Dee)', url: '/assets/figures/dee.glb' },
  { id: 'uncleRay', label: 'glb figure (Porch Uncle Ray)', url: '/assets/figures/uncleRay.glb' },
  { id: 'pat', label: 'glb figure (Porch Pat)', url: '/assets/figures/pat.glb' },
];

/**
 * GLB files a room presents that are NOT in its venue asset set: the
 * shared street sedan — the Pj's own room at High, and the story Corner
 * (venue `speakeasy`, stop `corner`) which reuses the same car — and, at
 * the Porch story seam, the pilot's three seated figures (the Porch
 * deck ROOM is procedural, but the figures the table presents are
 * downloads, and the gate's promise covers what the table shows). The
 * king stop parks no sedan (the King's Lounge replaces the street room
 * there); its GLBs are the studio set, which rides the classic ledger
 * instead. Low quality never mounts the 3D street rooms or the
 * figures, so it never fetches these files.
 */
export function roomGlbUrls(
  venue: string,
  quality: 'high' | 'low',
  storyStopId: string | null,
): { label: string; url: string }[] {
  if (quality !== 'high') return [];
  if (venue === 'blockAfterDark') {
    // The King's Lounge replaces the street room at the king stop (High):
    // no sedan is parked there, so the gate must not wait on it.
    if (storyStopId === 'king') return [];
    return [{ label: 'glb sedan (Pj\'s street)', url: SEDAN_GLB_URL }];
  }
  if (venue === 'speakeasy' && storyStopId === 'corner') return [{ label: 'glb sedan (Corner street)', url: SEDAN_GLB_URL }];
  if (venue === 'grandma' && storyStopId === 'porch') return PORCH_FIGURE_GLBS.map((f) => ({ label: f.label, url: f.url }));
  return [];
}

/**
 * Story seams: at High quality a story table's venue room never mounts — the
 * Scene swaps in a bespoke story room for the stop (Scene.tsx's seam
 * branches; Venue3D carries one: at the king stop the King's Lounge
 * replaces the Pj's street room, which IS its venue room everywhere else).
 * Seam rooms download nothing, so the venue ledger folded into the gate
 * would be pure dead weight: at the Rec Center the gate waited on the
 * Classic Studio's chair/lamp/floor set (~678 KB) that nothing at the table
 * would ever request, could not settle inside the cap on a cold pipe, and
 * released the loader into a room still arriving piecemeal (owner device
 * report, 2026-10-28: "Rec center is having a hard time loading all the
 * assets" / "Some pieces never show up"). Table therefore skips the ledger
 * fold-in exactly when a seam mounts — with one exception: the King's
 * Lounge is the Classic Studio's cube dressed plum-and-gold, so it loads
 * the studio set; at the king seam the gate folds the CLASSIC ledger in
 * place of the street's (gateLedgerVenue below).
 * Low quality mounts the venue fallback room — its files ARE used, so the
 * ledger stays gated there, as it does at every non-story table.
 *
 * These tables mirror Scene.tsx's seam conditions one-for-one (High only);
 * a pin in asset-gate.test.ts holds the two in sync. The Scene's `textured`
 * term is not a term here: it times WHEN a room mounts, never WHICH room
 * mounts.
 *
 * Two seam shapes exist. STORY_SEAMS is stop-keyed: the bespoke room mounts
 * only on a table carrying its story stop. VENUE_WIDE_SEAMS is venue-keyed:
 * the venue's own bespoke room (built for its story stop, same place, no
 * story-specific dressing) now mounts for EVERY High table at the venue —
 * the Batch A un-scope of the venues rollout (owner, 2026-10-28: "Now all
 * the other venues need to be updated the same way"). For those venues the
 * skip follows the room, not the story flag: a regular High table mounts
 * the all-code room exactly as the story table does, so folding the venue
 * ledger in there would re-create the Rec defect at regular tables. Low
 * still mounts the venue fallback at every venue, so the ledger stays
 * gated there. Mansion joined the venue-wide set in Batch B under the
 * owner's identity call for the adjacent penthouse ("the penthouse is
 * the mansion fantasy done properly").
 *
 * Batch C1 (speakeasy + grandma) is the second venue-wide shape: the
 * story room at those venues is a DIFFERENT place (the Corner street,
 * the Porch deck) and stays stop-keyed — its STORY_SEAMS row remains
 * and its Scene branch keeps priority — while a NEW bespoke room
 * built for the venue itself (the Speakeasy Lounge, Grandma's
 * Kitchen) mounts for every NON-story High table. Both High branches
 * are all-code and download nothing, so the ledger skip holds
 * venue-wide at High exactly as it does for the un-scoped rooms; the
 * set membership records that Scene mounts a bespoke room for every
 * High table at the venue, whichever branch serves it.
 *
 * Batch C2 (yacht + beach) is the third venue-wide shape: neither
 * venue hosts a story stop at all, so there is no stop-keyed row
 * and no story branch in Scene — a NEW bespoke room built for the
 * venue itself (the Yacht Deck, the Beach Cabana) mounts for every
 * High table, all-code like the others, so the ledger skip holds
 * venue-wide at High and Low keeps the ledger for its cube room.
 *
 * Batch C3 (rooftop + vegas) returns to the Batch C1 shape: both
 * venues host story stops whose rooms are DIFFERENT rooms and
 * stay stop-keyed with Scene priority — RooftopDuskRoom (stop
 * `rooftop`, pinned dusk) and LegendsTableRoom (stop `legends`)
 * — their STORY_SEAMS rows remain. A NEW bespoke room built for
 * each venue itself (the Rooftop Skyline, carrying the cube
 * room's local-clock time of day; the Vegas Casino Floor)
 * mounts for every NON-story High table. Both High branches
 * are all-code and download nothing, so the ledger skip holds
 * venue-wide at High exactly as in C1; Low keeps the ledger.
 */
const STORY_SEAMS: Readonly<Record<string, string>> = {
  classic: 'rec-center',
  rooftop: 'rooftop',
  vegas: 'legends',
  speakeasy: 'corner',
  grandma: 'porch',
  blockAfterDark: 'king',
};

const VENUE_WIDE_SEAMS: ReadonlySet<string> = new Set([
  'barbershop',
  'backyard',
  'beach',
  'church',
  'grandma',
  'mansion',
  'rooftop',
  'speakeasy',
  'vegas',
  'yacht',
]);

export function storySeamMounts(
  venue: string,
  quality: 'high' | 'low',
  storyStopId: string | null,
): boolean {
  if (quality !== 'high') return false;
  if (VENUE_WIDE_SEAMS.has(venue)) return true;
  return storyStopId !== null && STORY_SEAMS[venue] === storyStopId;
}

/**
 * Whose asset ledger the gate folds in for a table: the venue's own at
 * ordinary tables; NO ledger at a seam (the seam rooms download nothing —
 * the king's lounge excepted); the CLASSIC ledger at the king seam, whose
 * lounge loads exactly the studio files (chair/lamp GLBs + floor set) and
 * none of the street's. Low tables mount the venue/fallback rooms, so their
 * own ledger folds in.
 */
export function gateLedgerVenue(
  venue: string,
  quality: 'high' | 'low',
  storyStopId: string | null,
): string | null {
  if (!storySeamMounts(venue, quality, storyStopId)) return venue;
  return venue === 'blockAfterDark' && storyStopId === 'king' ? 'classic' : null;
}

/** The loader's full dismissal condition: the original dressed + effects-warm
 *  gate, AND the asset gate settled. The 40 s give-up still overrides all. */
export function loaderStillUp(o: { dressed: boolean; effectsWarm: boolean; assetsSettled: boolean; giveUp: boolean }): boolean {
  return tableStillLoading(o.dressed, o.effectsWarm, o.giveUp) || (!o.assetsSettled && !o.giveUp);
}

/** Settle promise for one file: images resolve on load + decode (so the first
 *  paint from them does not hitch), everything else (GLB, HDR, video) resolves
 *  once its bytes have arrived. Errors resolve false — never a rejection. */
export function imageSettled(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(false); return; }
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(() => finish(true), () => finish(true));
      else finish(true);
    };
    img.onerror = () => finish(false);
    img.src = url;
    if (img.complete && img.naturalWidth) finish(true);
  });
}

export function fetchSettled(url: string): Promise<boolean> {
  return fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer().then(() => true, () => false) : false))
    .catch(() => false);
}

/** Pick the settle strategy by file kind: pictures decode, the rest just arrive. */
export function assetSettled(url: string): Promise<boolean> {
  return /\.(?:jpe?g|png|webp|gif|avif)(?:\?.*)?$/i.test(url) ? imageSettled(url) : fetchSettled(url);
}

export interface AssetGateResult {
  key: string;
  total: number;
  settled: number;
  /** labels of assets that errored (their fallbacks engage; the gate still released) */
  failed: string[];
  /** labels still pending when the cap released the gate */
  pendingAtCap: string[];
  cappedOut: boolean;
  ms: number;
}

export interface AssetGate {
  readonly key: string;
  /** Register one asset. `task` resolves true (loaded) or false (failed);
   *  a rejection is treated as a failure. Duplicate labels are ignored. */
  add(label: string, task: Promise<boolean>): void;
  /** Register a bundle (e.g. the whole deck) as ONE progress unit whose
   *  failure detail is a list of labels; resolves true iff nothing failed. */
  addGroup(label: string, task: Promise<{ failed: string[] }>): void;
  /** No more assets will be added: `done` may resolve once all settle. */
  seal(): void;
  progress(): { settled: number; total: number; fraction: number };
  failed(): string[];
  onProgress(fn: () => void): () => void;
  readonly done: Promise<AssetGateResult>;
}

export function createAssetGate(key: string, capMs: number = ASSET_GATE_CAP_MS): AssetGate {
  const started = Date.now();
  const tasks = new Map<string, 'pending' | 'ok' | 'failed'>();
  const failedLabels: string[] = [];
  const listeners = new Set<() => void>();
  let sealed = false;
  let finished = false;
  let resolveDone!: (r: AssetGateResult) => void;
  const done = new Promise<AssetGateResult>((res) => { resolveDone = res; });

  const notify = () => { listeners.forEach((f) => { try { f(); } catch { /* a listener never breaks the gate */ } }); };
  const finish = (cappedOut: boolean) => {
    if (finished) return;
    finished = true;
    clearTimeout(capTimer);
    const pendingAtCap = cappedOut ? [...tasks.entries()].filter(([, s]) => s === 'pending').map(([l]) => l) : [];
    resolveDone({
      key,
      total: tasks.size,
      settled: [...tasks.values()].filter((s) => s !== 'pending').length,
      failed: [...failedLabels],
      pendingAtCap,
      cappedOut,
      ms: Date.now() - started,
    });
    notify();
  };
  const maybeFinish = () => {
    if (finished) return;
    if (sealed && [...tasks.values()].every((s) => s !== 'pending')) finish(false);
  };
  const capTimer = setTimeout(() => finish(true), capMs);

  const track = (label: string, task: Promise<boolean>) => {
    if (finished || tasks.has(label)) return;
    tasks.set(label, 'pending');
    notify();
    task.then(
      (good) => {
        if (tasks.get(label) !== 'pending') return;
        tasks.set(label, good ? 'ok' : 'failed');
        if (!good) failedLabels.push(label);
        notify();
        maybeFinish();
      },
      () => {
        if (tasks.get(label) !== 'pending') return;
        tasks.set(label, 'failed');
        failedLabels.push(label);
        notify();
        maybeFinish();
      },
    );
  };

  return {
    key,
    done,
    add(label, task) { track(label, task); },
    addGroup(label, task) {
      // The bundle counts as one progress unit; its failed files are named
      // individually on the failure list alongside the bundle label.
      track(label, task.then((r) => {
        if (r.failed.length) failedLabels.push(...r.failed);
        return r.failed.length === 0;
      }));
    },
    seal() { sealed = true; maybeFinish(); },
    progress() {
      const total = tasks.size;
      const settled = [...tasks.values()].filter((s) => s !== 'pending').length;
      return { settled, total, fraction: total ? settled / total : 1 };
    },
    failed: () => [...failedLabels],
    onProgress(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

/* ------------------------------------------------------------------ ledger */

/**
 * Room-file ledger: the three layer's warm-up passes note the files they
 * fetch, keyed by venue, and Table folds its venue's list into the gate.
 * Noting is idempotent and never starts a load by itself — the warm pass
 * that noted the file is already fetching it, and the gate's own tracked
 * load of the same URL rides the HTTP cache behind it.
 */
const roomLedger = new Map<string, Set<string>>();

export function noteRoomAssets(venue: string, urls: readonly string[]): void {
  let set = roomLedger.get(venue);
  if (!set) { set = new Set(); roomLedger.set(venue, set); }
  for (const u of urls) if (u) set.add(u);
}

export function notedRoomAssets(venue: string): string[] {
  return [...(roomLedger.get(venue) ?? [])];
}

/** For checks: the whole ledger as plain data. */
export function roomLedgerSnapshot(): Record<string, string[]> {
  return Object.fromEntries([...roomLedger.entries()].map(([k, v]) => [k, [...v]]));
}
