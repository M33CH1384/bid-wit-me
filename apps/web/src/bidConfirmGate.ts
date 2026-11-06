import { isShortLandscape } from './viewport';

/**
 * W1 select-then-confirm gate (responsive audit 2026-11-05, Finding A) —
 * PROVISIONAL, pending owner review. This module is the SINGLE gate for
 * the whole feature: delete this file, the `bidConfirmGate` state and
 * the confirm row in Table.tsx, and bidding is one-tap everywhere again.
 *
 * Why it exists: even at the reduced 5-column portrait grid, a 320px
 * phone renders numeric bid buttons ~40px wide (below the 44px floor),
 * and a mistap submits a real bid immediately — the engine has no
 * retract. Where (and only where) the rendered numeric buttons would be
 * <44px wide, a tap SELECTS the bid and a >=44px confirm control commits
 * it. Everywhere else the buttons call `apply` directly, exactly as
 * before.
 *
 * The condition is pure geometry, derived from the shipped CSS reserves
 * — never a device name:
 *   .me padding while the bid panel is up (portrait, not .short):
 *     left 10px + inset-left, right 60px + inset-right (styles.css .me:has)
 *   .bid-panel padding: 12px each side
 *   .bid-grid: 5 columns, 6px gaps (styles.css, W1 Phase 2)
 * button width = (vw - left - right - 24 - 4*6) / 5
 * At zero insets that is <44px exactly when vw < 338px (320px -> 40.4px;
 * 360px -> 48.4px, gate off). Short landscape is excluded: its panel is
 * a different layout (auto-fit strip) and stays one-tap.
 */
export const BID_GRID_COLUMNS = 5;

export function bidButtonWidthForViewport(viewportWidth: number, safeLeft = 0, safeRight = 0): number {
  const meLeft = 10 + safeLeft;
  const meRight = 60 + safeRight;
  const panelPadding = 24;
  const gaps = (BID_GRID_COLUMNS - 1) * 6;
  return (viewportWidth - meLeft - meRight - panelPadding - gaps) / BID_GRID_COLUMNS;
}

export function bidNeedsConfirmForViewport(viewportWidth: number, viewportHeight: number, safeLeft = 0, safeRight = 0): boolean {
  if (isShortLandscape(viewportWidth, viewportHeight)) return false;
  return bidButtonWidthForViewport(viewportWidth, safeLeft, safeRight) < 44;
}

/**
 * The rendered refinement (Table.tsx's layout effect): while the bid
 * panel is up, the first grid button's rendered width may overrule the
 * formula — it sees safe-area insets and panel narrowing the formula
 * cannot. Returns the gate verdict for a real measurement, or null to
 * abstain. A NON-POSITIVE width is not a measurement: the button has not
 * been laid out yet, or the environment has no layout at all (the DOM
 * test harness, where every rect reads 0). Abstaining there keeps the
 * formula's verdict; reading 0 as "narrower than 44px" would engage the
 * gate on its own and turn a bid tap into a mere selection (audit gap
 * G3 — the misdeal-button-visible regression on the audit base; the
 * owner's 2026-11-05 acceptance sent the fix to this pass).
 */
export function gateForRenderedWidth(renderedWidth: number): boolean | null {
  if (!(renderedWidth > 0)) return null;
  return renderedWidth < 44;
}
