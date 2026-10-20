import { useState } from 'react';
import GameOverRewards, { type RewardsData } from './GameOverRewards';

/**
 * Dedicated /rewards screen (Demetrius 2026-10-19): after the player chooses to
 * leave a finished match, Table computes the rewards breakdown, stashes it here,
 * and routes to this page — a full opaque screen of its own, NOT a modal overlay
 * (the overlay kept rendering blurry on iOS). The stash survives the page load
 * via sessionStorage; a refresh still shows the same breakdown.
 */
export interface RewardsPayload {
  data: RewardsData;
  /** the finished match was an online table game */
  online: boolean;
  /** where the Home button lands ('/' normally, '/online' after Change mode online) */
  homePath: string;
}

const KEY = 'bwm.rewards.v1';

export function stashRewards(p: RewardsPayload): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: page shows its fallback */ }
}

export function loadRewards(): RewardsPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RewardsPayload;
    return p && p.data ? p : null;
  } catch { return null; }
}

export default function RewardsPage() {
  const [payload] = useState<RewardsPayload | null>(loadRewards);
  if (!payload) {
    return (
      <div className="rewards-page" aria-label="Match rewards">
        <div className="rw-card">
          <div className="rw-head">
            <div className="rw-trophy">♠</div>
            <h2 className="lose">No match yet</h2>
            <p className="rw-sub0">Finish a match and your rewards will land here.</p>
          </div>
          <div className="rw-actions" style={{ animationDelay: '0ms' }}>
            <button type="button" className="primary big" data-testid="rewards-home" onClick={() => { location.href = '/'; }}>Home</button>
          </div>
        </div>
      </div>
    );
  }
  const { data, online, homePath } = payload;
  return (
    <GameOverRewards
      data={data}
      onHome={() => { location.href = homePath; }}
      onRematch={() => { location.href = online ? '/online' : '/?autostart=1'; }}
      onProfile={() => { location.href = '/profile'; }}
      onOpenTables={() => { location.href = '/online'; }}
    />
  );
}
