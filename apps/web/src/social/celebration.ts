/**
 * BWM Central Phase 3 — the shared celebration queue for hub surfaces.
 *
 * One queue discipline for every hub celebration (the owner's animation
 * law): priority-ordered (promotion > personal best > rivalry event >
 * generic), deduped by key for the whole session (the same key never
 * shows twice, even across host remounts — the seen-set is injectable so
 * the singleton below owns the session's), cancelled wholesale when its
 * host unmounts / the route changes, and skippable (a tap dismisses the
 * current item). Reconnects never replay history because nothing here
 * persists across a reload except the promotion high-water mark (its own
 * rule, below) — the queue itself is memory-only.
 *
 * Presentation is gated honestly:
 *  - reduced motion (the app's Reduce-effects setting or the OS setting,
 *    read by the host) → 'instant': the final state, no animation;
 *  - the perf governor (three/perfGovernor.ts — a pure singleton whose
 *    level the table Scene drives while a table is active) at its
 *    deepest trim, MAX_LEVEL → 'static': a static badge, no motion.
 *    The hub only READS `perfGovernor.level`; the governor's single
 *    onLevelChange slot belongs to the Scene and is never touched here.
 *  - otherwise → 'motion'.
 * Cosmetics never gate progression or timers: this module owns no game
 * state and nothing waits on it.
 */
import { MAX_LEVEL } from '../three/perfGovernor';

export type CelebrationKind = 'promotion' | 'personal-best' | 'rivalry' | 'generic';

export const CELEBRATION_PRIORITY: Record<CelebrationKind, number> = {
  promotion: 40,
  'personal-best': 30,
  rivalry: 20,
  generic: 10,
};

export interface CelebrationItem {
  /** session dedupe key — the same key never shows twice */
  key: string;
  kind: CelebrationKind;
  title: string;
  text?: string;
  /** promotion emblem transition: the old value the emblem rises from */
  from?: number;
  /** promotion emblem transition: the new value */
  to?: number;
}

export type CelebrationPresentation = 'motion' | 'static' | 'instant';

export function celebrationPresentation(
  _item: Pick<CelebrationItem, 'kind'>,
  opts: { governorLevel: number; reducedMotion: boolean },
): CelebrationPresentation {
  if (opts.reducedMotion) return 'instant';
  if (opts.governorLevel >= MAX_LEVEL) return 'static';
  return 'motion';
}

/**
 * The queue. Pure ordering/dedupe semantics; rendering (and the
 * auto-advance timer) belongs to CelebrationHost. Listeners are notified
 * on every mutation so a React host can subscribe without owning state.
 */
export class CelebrationQueue {
  private items: CelebrationItem[] = [];
  private seq = 0;
  private order = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor(private seen: Set<string> = new Set()) {}

  /** True when the item was accepted; false when its key already showed
   *  (or is already queued) this session. */
  enqueue(item: CelebrationItem): boolean {
    if (this.seen.has(item.key)) return false;
    this.seen.add(item.key);
    this.order.set(item.key, this.seq++);
    this.items.push(item);
    this.items.sort((a, b) =>
      CELEBRATION_PRIORITY[b.kind] - CELEBRATION_PRIORITY[a.kind]
      || (this.order.get(a.key) ?? 0) - (this.order.get(b.key) ?? 0));
    this.notify();
    return true;
  }

  current(): CelebrationItem | null {
    return this.items[0] ?? null;
  }

  pending(): CelebrationItem[] {
    return [...this.items];
  }

  /** Skip the current celebration (tap-to-dismiss) and advance. */
  dismiss(): void {
    if (!this.items.length) return;
    this.items.shift();
    this.notify();
  }

  /** Leaving a screen cancels its whole queue. The seen-set survives on
   *  purpose: a cancelled celebration does not replay on return. */
  cancelAll(): void {
    if (!this.items.length) return;
    this.items = [];
    this.notify();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private notify(): void {
    this.listeners.forEach((f) => f());
  }
}

/** The hub's one queue + its session seen-set (module-lived, so a host
 *  remount never replays a celebration that already showed). */
export const hubCelebrations = new CelebrationQueue();

/* ------------------------------------------------------ rank promotion */

/** localStorage key for the viewer's last-seen level (the promotion
 *  high-water mark). */
export const PROMOTION_LEVEL_KEY = 'bwm.central.lastSeenLevel.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The promotion check (Rankings / Career): compare the viewer's current
 * level against the persisted last-seen value.
 *  - no (or corrupt) stored value → store silently, return null (a
 *    first-ever view is never a fake promotion);
 *  - current > stored → a real promotion {from, to}; the stored value
 *    updates so it plays exactly once;
 *  - current <= stored → null, and the high-water mark is NOT lowered
 *    (dropping and climbing back to the same level is not re-celebrated;
 *    only passing the mark is).
 */
export function checkRankPromotion(storage: StorageLike, currentLevel: number): { from: number; to: number } | null {
  let raw: string | null = null;
  try { raw = storage.getItem(PROMOTION_LEVEL_KEY); } catch { raw = null; }
  const stored = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(stored)) {
    try { storage.setItem(PROMOTION_LEVEL_KEY, String(currentLevel)); } catch { /* private mode */ }
    return null;
  }
  if (currentLevel > stored) {
    try { storage.setItem(PROMOTION_LEVEL_KEY, String(currentLevel)); } catch { /* private mode */ }
    return { from: stored, to: currentLevel };
  }
  return null;
}
