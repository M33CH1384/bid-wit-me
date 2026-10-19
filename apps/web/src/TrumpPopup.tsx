import { useEffect } from 'react';
import { type TableRules, trumpOrder } from '@spades/rules';
import { TrumpLadder } from './trumpLadder';

/**
 * One-time "Trump Order" popup for Joker modes. Replaces the old persistent
 * trump strip (removed: it pushed player plates into each other).
 * Shows centered, auto-dismisses after 4s, tap to dismiss early.
 * Demetrius 2026-10-19.
 */
export function TrumpPopup({ rules, onDone }: { rules: TableRules; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="trump-popup glass slant" data-testid="trump-popup" role="dialog" aria-label="Trump order" onClick={onDone}>
      <div className="ts-label">TRUMP ORDER</div>
      <TrumpLadder rules={rules} n={5} style="long" />
      <div className="trump-popup-hint">tap to dismiss</div>
    </div>
  );
}

/**
 * localStorage key for the seen-trump-popup flag, per trump variant:
 * `bwm-seen-trumps-joker` (standard: BJ › LJ › 2D › 2S › …) or
 * `bwm-seen-trumps-classic` (classic: BJ › LJ › AS › …).
 * Returns null for non-Joker decks (no popup).
 */
export function trumpSeenKey(rules: TableRules): string | null {
  if (rules.deck !== 'joker54') return null;
  const top = trumpOrder(rules).slice(0, 4).join(',');
  return `bwm-seen-trumps-${top === 'BJ,LJ,2D,2S' ? 'joker' : 'classic'}`;
}

/** True when the popup has already been shown+acked for this trump variant. */
export function trumpPopupSeen(key: string | null): boolean {
  if (!key) return true;
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

/** Mark the popup seen for this trump variant. */
export function ackTrumpPopup(key: string | null): void {
  if (!key) return;
  try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
}
