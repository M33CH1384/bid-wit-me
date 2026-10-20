import { useEffect, useState } from 'react';

/** Minimal profile shape (mirrors /api/profile/me) for reward deltas. */
export interface RewardsProfile {
  level: { level: number; xp: number; title: string; xpForNext: number; xpIntoLevel: number };
  coins: { balance: number };
  rank: {
    team: { elo: number };
    cutthroat: { elo: number };
  };
  achievements: { id: string; title: string; xp: number; coins: number; unlockedAt: number | null }[];
  challenges: {
    daily: { id: string; title: string; xp: number; coins: number; claimed: boolean; progress: number; target: number }[];
    weekly: { id: string; title: string; xp: number; coins: number; claimed: boolean; progress: number; target: number }[];
  };
}

export interface UnlockedItem { id: string; title: string; xp: number; coins: number }

export interface RewardsData {
  won: boolean;
  headline: string;
  sub: string;
  signedIn: boolean;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  levelTitle: string;
  xpIntoLevel: number;
  xpForNext: number;
  coinsGained: number;
  eloBefore: number | null;
  eloAfter: number | null;
  eloKindLabel: string;
  achievements: UnlockedItem[];
  challenges: UnlockedItem[];
}

/** Diff two profile snapshots into a RewardsData. `kind` is 'team' | 'cutthroat'. */
export function computeRewards(
  before: RewardsProfile | null,
  after: RewardsProfile | null,
  opts: { won: boolean; headline: string; sub: string; kind: 'team' | 'cutthroat' },
): RewardsData {
  const base: RewardsData = {
    won: opts.won,
    headline: opts.headline,
    sub: opts.sub,
    signedIn: !!(before && after),
    xpGained: 0,
    levelBefore: before?.level.level ?? 1,
    levelAfter: after?.level.level ?? before?.level.level ?? 1,
    levelTitle: after?.level.title ?? before?.level.title ?? '',
    xpIntoLevel: after?.level.xpIntoLevel ?? 0,
    xpForNext: after?.level.xpForNext ?? 1,
    coinsGained: 0,
    eloBefore: null,
    eloAfter: null,
    eloKindLabel: opts.kind === 'team' ? 'Partnership' : 'Cutthroat',
    achievements: [],
    challenges: [],
  };
  if (!before || !after) return base;
  base.xpGained = Math.max(0, after.level.xp - before.level.xp);
  base.coinsGained = Math.max(0, after.coins.balance - before.coins.balance);
  const rb = opts.kind === 'team' ? before.rank.team.elo : before.rank.cutthroat.elo;
  const ra = opts.kind === 'team' ? after.rank.team.elo : after.rank.cutthroat.elo;
  base.eloBefore = rb;
  base.eloAfter = ra;
  const beforeUnlocked = new Set(before.achievements.filter((a) => a.unlockedAt != null).map((a) => a.id));
  base.achievements = after.achievements
    .filter((a) => a.unlockedAt != null && !beforeUnlocked.has(a.id))
    .map((a) => ({ id: a.id, title: a.title, xp: a.xp, coins: a.coins }));
  const beforeClaimed = new Set([
    ...before.challenges.daily.filter((c) => c.claimed).map((c) => c.id),
    ...before.challenges.weekly.filter((c) => c.claimed).map((c) => c.id),
  ]);
  const newly = [
    ...after.challenges.daily.filter((c) => c.claimed && !beforeClaimed.has(c.id)),
    ...after.challenges.weekly.filter((c) => c.claimed && !beforeClaimed.has(c.id)),
  ];
  base.challenges = newly.map((c) => ({ id: c.id, title: c.title, xp: c.xp, coins: c.coins }));
  return base;
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export function fetchRewardsProfile(): Promise<RewardsProfile | null> {
  return api<RewardsProfile>('/api/profile/me').catch(() => null);
}

/** Ease-out cubic count-up. */
function useCountUp(target: number, duration = 900, delay = 0): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const t = window.setTimeout(() => {
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { window.clearTimeout(t); cancelAnimationFrame(raf); };
  }, [target, duration, delay]);
  return val;
}

function XpRow({ d, index }: { d: RewardsData; index: number }) {
  const xp = useCountUp(d.xpGained, 1000, 200 + index * 160);
  const pct = Math.min(100, Math.max(0, (d.xpIntoLevel / Math.max(1, d.xpForNext)) * 100));
  const leveled = d.levelAfter > d.levelBefore;
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon">⚡</div>
      <div className="rw-body">
        <div className="rw-top"><span>XP earned</span><b className="rw-num">+{xp.toLocaleString()}</b></div>
        <div className="rw-levelbar"><div className="rw-levelbar-fill" style={{ width: `${pct}%` }} /></div>
        <div className="rw-sub">
          Level {d.levelAfter}{d.levelTitle ? ` · ${d.levelTitle}` : ''} · {d.xpIntoLevel.toLocaleString()}/{d.xpForNext.toLocaleString()} XP
          {leveled && <span className="rw-levelup"> LEVEL UP!</span>}
        </div>
      </div>
    </div>
  );
}

function CoinsRow({ d, index }: { d: RewardsData; index: number }) {
  const coins = useCountUp(d.coinsGained, 1000, 200 + index * 160);
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon">🪙</div>
      <div className="rw-body">
        <div className="rw-top"><span>Coins earned</span><b className="rw-num gold">+{coins.toLocaleString()}</b></div>
        <div className="rw-sub">Spend them at the stake tables</div>
      </div>
    </div>
  );
}

function EloRow({ d, index }: { d: RewardsData; index: number }) {
  if (d.eloBefore == null || d.eloAfter == null) return null;
  const delta = d.eloAfter - d.eloBefore;
  // Plain-language labels (Demetrius 2026-10-19): "Partnership rating / 1,000 → 1,000 Elo"
  // meant nothing to players. Say what it is and what happened, in words.
  const label = d.eloKindLabel === 'Partnership' ? 'Team rating' : 'Cutthroat rating';
  if (delta === 0) {
    return (
      <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
        <div className="rw-icon">➖</div>
        <div className="rw-body">
          <div className="rw-top">
            <span>{label}</span>
            <b className="rw-num">{d.eloAfter.toLocaleString()}</b>
          </div>
          <div className="rw-sub">No change — ratings only move in rated games vs. real opponents</div>
        </div>
      </div>
    );
  }
  const up = delta > 0;
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon">{up ? '📈' : '📉'}</div>
      <div className="rw-body">
        <div className="rw-top">
          <span>{label}</span>
          <b className={`rw-num ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(delta)}</b>
        </div>
        <div className="rw-sub">{d.eloBefore.toLocaleString()} → {d.eloAfter.toLocaleString()} · Went {up ? 'up' : 'down'} {Math.abs(delta)} after this {d.won ? 'win' : 'loss'}</div>
      </div>
    </div>
  );
}

export default function GameOverRewards({
  data,
  onHome,
  onRematch,
  onProfile,
  onOpenTables,
}: {
  data: RewardsData;
  onHome: () => void;
  onRematch: () => void;
  onProfile: () => void;
  onOpenTables: () => void;
}) {
  let row = 0;
  const rows: React.ReactNode[] = [];
  if (data.signedIn) {
    rows.push(<XpRow key="xp" d={data} index={row++} />);
    if (data.coinsGained > 0) rows.push(<CoinsRow key="coins" d={data} index={row++} />);
    rows.push(<EloRow key="elo" d={data} index={row++} />);
    for (const a of data.achievements) {
      const i = row++;
      rows.push(
        <div key={`a-${a.id}`} className="rw-row" style={{ animationDelay: `${i * 160}ms` }}>
          <div className="rw-icon">🏆</div>
          <div className="rw-body">
            <div className="rw-top"><span>Achievement: {a.title}</span><b className="rw-num small">+{a.xp} XP{a.coins ? ` · +${a.coins}` : ''}</b></div>
          </div>
        </div>,
      );
    }
    for (const c of data.challenges) {
      const i = row++;
      rows.push(
        <div key={`c-${c.id}`} className="rw-row" style={{ animationDelay: `${i * 160}ms` }}>
          <div className="rw-icon">✅</div>
          <div className="rw-body">
            <div className="rw-top"><span>Challenge: {c.title}</span><b className="rw-num small">+{c.xp} XP{c.coins ? ` · +${c.coins}` : ''}</b></div>
          </div>
        </div>,
      );
    }
  }
  return (
    <div className="rewards-page" aria-label="Match rewards" data-testid="rewards">
      <div className="rw-card">
        <div className="rw-head" style={{ animationDelay: '0ms' }}>
          <div className="rw-trophy">{data.won ? '🏆' : '♠'}</div>
          <h2 className={data.won ? 'win' : 'lose'}>{data.headline}</h2>
          <p className="rw-sub0">{data.sub}</p>
        </div>
        <div className="rw-rows">
          {data.signedIn ? rows : (
            <div className="rw-row" style={{ animationDelay: '160ms' }}>
              <div className="rw-icon">👤</div>
              <div className="rw-body">
                <div className="rw-top"><span>Sign in to earn Rep rewards</span></div>
                <div className="rw-sub">XP, coins, and achievements are tracked on your account</div>
              </div>
            </div>
          )}
        </div>
        <div className="rw-actions" style={{ animationDelay: `${(row + 1) * 160}ms` }}>
          <button type="button" className="primary big" data-testid="rewards-home" onClick={onHome}>Home</button>
          <button type="button" className="ghost-btn rw-rematch-btn" data-testid="rewards-rematch" onClick={onRematch}>Rematch</button>
          <div className="rw-actions-row">
            <button type="button" className="ghost-btn" data-testid="rewards-profile" onClick={onProfile}>Profile</button>
            <button type="button" className="ghost-btn" data-testid="rewards-tables" onClick={onOpenTables}>Open Tables</button>
          </div>
        </div>
      </div>
    </div>
  );
}
