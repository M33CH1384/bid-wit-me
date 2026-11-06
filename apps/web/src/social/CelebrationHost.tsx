/**
 * BWM Central Phase 3 — the celebration host: renders the hub queue's
 * current item (celebration.ts) as a small badge over the Social panel.
 *
 * Owner's animation law, host side:
 *  - skippable: tapping the badge dismisses the current item;
 *  - auto-advance: an item holds for its beat, then the next in priority
 *    order shows — nothing ever waits on a celebration;
 *  - leaving the screen cancels the queue: the host's unmount calls
 *    cancelAll (SocialPanel mounts it for the panel's lifetime; closing
 *    the panel is the route change);
 *  - reduced motion → the badge renders its final state instantly
 *    (presentation 'instant', no CSS animation); the perf governor at
 *    its deepest trim → a static badge (presentation 'static').
 * The governor is read, never subscribed: perfGovernor.onLevelChange is
 * the table Scene's single slot. The snapshot is taken when an item
 * becomes current — the level the last table session drove it to.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { fx, useReduceEffects } from '../fx';
import { perfGovernor } from '../three/perfGovernor';
import {
  checkRankPromotion, celebrationPresentation, hubCelebrations,
  type CelebrationItem,
} from './celebration';

const HOLD_MS = 4200;

export function CelebrationHost() {
  const reduceFx = useReduceEffects();
  const reduced = reduceFx || fx.osReducedMotion;
  const current = useSyncExternalStore(
    hubCelebrations.subscribe,
    () => hubCelebrations.current(),
    () => hubCelebrations.current(),
  );
  /* leaving the screen cancels the queue (+ any audio an item might own
   * — hub celebrations are silent by design today, so there is none) */
  useEffect(() => () => { hubCelebrations.cancelAll(); }, []);
  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(() => hubCelebrations.dismiss(), HOLD_MS);
    return () => window.clearTimeout(t);
  }, [current]);
  if (!current) return null;
  const mode = celebrationPresentation(current, { governorLevel: perfGovernor.level, reducedMotion: reduced });
  return (
    <button
      type="button"
      className={`celebration-badge ${current.kind} mode-${mode}`}
      data-testid="celebration-host"
      data-celebration-key={current.key}
      data-presentation={mode}
      onClick={() => hubCelebrations.dismiss()}
      aria-label={`${current.title}. Tap to dismiss.`}
    >
      {current.kind === 'promotion' && current.from !== undefined && current.to !== undefined ? (
        <span className="celebration-emblem" data-testid="celebration-promotion">
          <span className="emblem-old">Level {current.from}</span>
          <span className="emblem-arrow" aria-hidden>→</span>
          <span className="emblem-new">Level {current.to}</span>
        </span>
      ) : (
        <span className="celebration-title">{current.title}</span>
      )}
      {current.text && <span className="celebration-text">{current.text}</span>}
    </button>
  );
}

/**
 * The rank-promotion watch (Rankings + Career): when the viewer's level
 * is HIGHER than the persisted last-seen value, enqueue the promotion
 * celebration (emblem old → new) exactly once and update the stored
 * value. A first-ever view stores silently — checkRankPromotion owns
 * that rule; the queue's session dedupe is the second latch. `level`
 * is null until the caller's payload lands.
 */
export function useRankPromotion(level: number | null): void {
  useEffect(() => {
    if (level === null || !Number.isFinite(level)) return;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    if (!storage) return;
    const promo = checkRankPromotion(storage, level);
    if (!promo) return;
    hubCelebrations.enqueue({
      key: `promotion:level:${promo.to}`,
      kind: 'promotion',
      title: `Level up — ${promo.from} → ${promo.to}`,
      from: promo.from,
      to: promo.to,
    } satisfies CelebrationItem);
  }, [level]);
}
