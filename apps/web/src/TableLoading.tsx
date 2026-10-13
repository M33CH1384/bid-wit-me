import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Copy that rotates while the table is still coming up. The first line is the one tests and the first paint use. */
export const LOADING_LINES = ['Shuffling the deck…', 'Setting the table…', 'Warming the felt…', 'Dealing you in…'];

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
    <div className={`bwm-loading${leaving ? ' leaving' : ''}`} role="status" aria-live="polite" data-testid="table-loading">
      <div className="bwm-loading-card">
        <img className="bwm-loading-mark" src="/assets/bwm-wordmark-white.svg" alt="Bid Wit Me" />
        <span className="beta-tag">BETA</span>
        <p className="bwm-loading-line" data-testid="table-loading-line">{LOADING_LINES[line]}</p>
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
        {onBack && <button type="button" className="link bwm-loading-back" onClick={onBack}>← Back</button>}
      </div>
    </div>
  );
  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}
