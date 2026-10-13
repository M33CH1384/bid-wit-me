import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import tips from './data/loading-tips.json';

/** Copy that rotates while the table is still coming up. The first line is the one tests and the first paint use. */
export const LOADING_LINES = ['Shuffling the deck…', 'Setting the table…', 'Warming the felt…', 'Dealing you in…'];

export interface LoadingTip { id: number; text: string }

/**
 * Strategy lines shipped inside this chunk, in file order. Reading them is synchronous, so the
 * list never waits on the network and never holds the 3D scene or the first game state.
 */
export const LOADING_TIPS: LoadingTip[] = tips;

/** A new order each time the loading screen mounts. The JSON file itself stays in its authored order. */
export function shuffleTips<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const next = list.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = next[i]!;
    next[i] = next[j]!;
    next[j] = swap;
  }
  return next;
}

/** One tip at a time. The next fades in on a timer that does not touch the loader's progress. */
function LoadingTips() {
  const [order] = useState(() => shuffleTips(LOADING_TIPS));
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (order.length < 2) return;
    let fade = 0;
    const id = window.setInterval(() => {
      setVisible(false);
      fade = window.setTimeout(() => {
        setIndex((n) => (n + 1) % order.length);
        setVisible(true);
      }, 280);
    }, 3400);
    return () => { window.clearInterval(id); window.clearTimeout(fade); };
  }, [order]);
  const tip = order[index];
  if (!tip?.text) return null;
  return (
    <p className={`bwm-loading-tip${visible ? ' in' : ''}`} data-testid="table-loading-tip" data-tip={tip.id} aria-live="polite">
      <span className="bwm-loading-tip-kicker">Strategy</span>
      <span className="bwm-loading-tip-text">{tip.text}</span>
    </p>
  );
}

/**
 * Full-screen Bid Wit Me hold, from the moment a table is joined or started until the 3D scene
 * and the first game state are both ready. The half-drawn table stays underneath and cannot be tapped.
 */
export function TableLoading({ progress, leaving, onBack }: { progress?: number; leaving?: boolean; onBack?: () => void }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setLine((n) => (n + 1) % LOADING_LINES.length), 1600);
    return () => window.clearInterval(id);
  }, []);
  const known = progress !== undefined && Number.isFinite(progress);
  const pct = known ? Math.max(4, Math.min(100, Math.round(progress * 100))) : undefined;
  const node = (
    <div className={`bwm-loading${leaving ? ' leaving' : ''}`} role="status" data-testid="table-loading">
      <div className="bwm-loading-card">
        <img className="bwm-loading-mark" src="/assets/bwm-wordmark-white.svg" alt="Bid Wit Me" />
        <span className="beta-tag">BETA</span>
        <p className="bwm-loading-line" data-testid="table-loading-line" aria-live="polite">{LOADING_LINES[line]}</p>
        <div
          className={`bwm-loading-track${known ? '' : ' indeterminate'}`}
          role="progressbar"
          aria-label="Loading the table"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={pct !== undefined ? { width: `${pct}%` } : undefined} />
        </div>
        <LoadingTips />
        {onBack && <button type="button" className="link bwm-loading-back" onClick={onBack}>← Back</button>}
      </div>
    </div>
  );
  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}
