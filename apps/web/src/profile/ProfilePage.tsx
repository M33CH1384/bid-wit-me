import { useEffect, useState } from 'react';

/** Rep profile page: Rank / Challenges / Stats / Achievements / Unlocks tabs. */

type Division = 'stoop' | 'corner' | 'block' | 'avenue' | 'boulevard' | 'legend';
const DIVISION_LABEL: Record<Division, string> = {
  stoop: 'Stoop', corner: 'Corner', block: 'Block',
  avenue: 'Avenue', boulevard: 'Boulevard', legend: 'Legend',
};
const DIVISION_CLASS: Record<Division, string> = {
  stoop: 'div-stoop', corner: 'div-corner', block: 'div-block',
  avenue: 'div-avenue', boulevard: 'div-boulevard', legend: 'div-legend',
};

interface SeasonRank { division: Division; elo: number; games: number; wins: number; losses: number; peak: number; rank: number; of: number }
interface Challenge { id: string; title: string; metric: string; target: number; progress: number; xp: number; coins: number; claimed: boolean }
interface Achievement { id: string; title: string; hint: string; xp: number; coins: number; unlockedAt: number | null }
interface Unlock { itemId: string; source: string; unlockedAt: number; slot: string | null; equipped: boolean }
interface Profile {
  user: { id: string; name: string };
  level: { level: number; xp: number; title: string; xpForNext: number; xpIntoLevel: number };
  season: { id: string; name: string; endsAt: number };
  rank: { team: SeasonRank; cutthroat: SeasonRank };
  stats: { team: Record<string, number | string | null>; cutthroat: Record<string, number | string | null> };
  challenges: { daily: Challenge[]; weekly: Challenge[] };
  achievements: Achievement[];
  unlocks: Unlock[];
  coins: { balance: number };
}

type Tab = 'rank' | 'challenges' | 'stats' | 'achievements' | 'unlocks';
const TABS: { id: Tab; label: string }[] = [
  { id: 'rank', label: 'Rank' },
  { id: 'challenges', label: 'Challenges' },
  { id: 'stats', label: 'Stats' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'unlocks', label: 'Unlocks' },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Same-origin via the Pages Function /api proxy (first-party cookies work in Safari).
  // Do NOT use serverUrl() here — cross-site fetch to workers.dev gets third-party-cookie blocked.
  const r = await fetch(path, { credentials: 'include', ...init });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function DivisionBadge({ division, size }: { division: Division; size?: 'sm' | 'lg' }) {
  return <span className={`div-badge ${DIVISION_CLASS[division]} ${size === 'lg' ? 'lg' : ''}`}>{DIVISION_LABEL[division]}</span>;
}

function RankCard({ title, rank }: { title: string; rank: SeasonRank }) {
  return (
    <div className="rank-card glass">
      <div className="rank-head"><h3>{title}</h3><DivisionBadge division={rank.division} /></div>
      <div className="rank-elo">{rank.elo}<small>ELO</small></div>
      <div className="rank-rows">
        <div><span>Season record</span><b>{rank.wins}W – {rank.losses}L</b></div>
        <div><span>Leaderboard</span><b>#{rank.rank} of {rank.of}</b></div>
        <div><span>Peak rating</span><b>{rank.peak}</b></div>
        <div><span>Games</span><b>{rank.games}</b></div>
      </div>
    </div>
  );
}

function ChallengeRow({ c, onClaim }: { c: Challenge; onClaim: (id: string) => void }) {
  const done = c.progress >= c.target;
  const pct = Math.min(100, Math.round((c.progress / Math.max(1, c.target)) * 100));
  return (
    <div className={`challenge ${done ? 'done' : ''}`}>
      <div className="ch-main">
        <b>{c.title}</b>
        <div className="ch-bar"><i style={{ width: `${pct}%` }} /></div>
        <small>{Math.min(c.progress, c.target)}/{c.target} · +{c.xp} XP{c.coins ? ` · +${c.coins} coins` : ''}</small>
      </div>
      {done && !c.claimed && <button type="button" className="primary small" onClick={() => onClaim(c.id)}>Claim</button>}
      {c.claimed && <span className="ch-claimed">Claimed</span>}
    </div>
  );
}

const STAT_LABELS: Record<string, string> = {
  games: 'Games', wins: 'Wins', streak: 'Win streak', bestStreak: 'Best streak',
  accuracy: 'Bid accuracy', bags: 'Bags', booksPerHand: 'Books/hand', nil: 'Nil made',
  shotsGiven: 'Shots given', shotsTaken: 'Shots taken', wheels: 'Wheels', bjWins: 'Blackjack wins',
  winsVsPlayers: 'Wins vs players', winsVsBots: 'Wins vs bots',
};

function StatsGrid({ stats }: { stats: Record<string, number | string | null> }) {
  const rows = Object.entries(STAT_LABELS).filter(([k]) => stats[k] !== undefined && stats[k] !== null);
  return (
    <div className="stats-grid">
      {rows.map(([k, label]) => (
        <div key={k} className="stat-cell"><b>{String(stats[k])}</b><span>{label}</span></div>
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>('rank');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<Profile>('/api/profile/me').then(setProfile).catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const claim = async (id: string) => {
    setClaiming(id);
    try {
      await api<{ ok: boolean }>('/api/challenges/' + id + '/claim', { method: 'POST' });
      load();
    } catch (e) { setError((e as Error).message); } finally { setClaiming(null); }
  };

  if (error) {
    return (
      <div className="profile-page">
        <header className="prof-bar"><button type="button" className="back-chip" onClick={() => history.back()}>← BACK</button></header>
        <div className="prof-error"><p>{error}</p>{error.includes('sign') || error.includes('auth') ? <p>Sign in to view your Rep profile.</p> : <button type="button" className="primary" onClick={load}>Retry</button>}</div>
      </div>
    );
  }
  if (!profile) return <div className="profile-page"><div className="prof-loading">Loading your Rep…</div></div>;

  const xpPct = Math.min(100, Math.round((profile.level.xpIntoLevel / Math.max(1, profile.level.xpForNext)) * 100));
  const pendingClaims = [...profile.challenges.daily, ...profile.challenges.weekly].filter((c) => c.progress >= c.target && !c.claimed).length;

  return (
    <div className="profile-page">
      <header className="prof-bar">
        <button type="button" className="back-chip" onClick={() => history.back()}>← BACK</button>
        <span className="prof-season">{profile.season.name}</span>
      </header>

      <div className="prof-header glass">
        <div className="prof-avatar">{profile.user.name.charAt(0).toUpperCase()}</div>
        <div className="prof-id">
          <h2>{profile.user.name}</h2>
          <div className="prof-level"><b>Level {profile.level.level}</b><span>{profile.level.title}</span></div>
          <div className="xp-bar"><i style={{ width: `${xpPct}%` }} /><small>{profile.level.xpIntoLevel}/{profile.level.xpForNext} XP</small></div>
        </div>
        <div className="prof-coins">
          <b>{profile.coins.balance.toLocaleString()}</b>
          <span>Coins</span>
        </div>
      </div>

      <nav className="prof-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}{t.id === 'challenges' && pendingClaims > 0 && <i className="tab-dot">{pendingClaims}</i>}
          </button>
        ))}
      </nav>

      <main className="prof-body">
        {tab === 'rank' && (
          <div className="rank-cards">
            <RankCard title="Partnership" rank={profile.rank.team} />
            <RankCard title="Cutthroat" rank={profile.rank.cutthroat} />
          </div>
        )}
        {tab === 'challenges' && (() => {
          const all = [...profile.challenges.daily, ...profile.challenges.weekly];
          const earnedXp = all.filter(c => c.claimed).reduce((s, c) => s + c.xp, 0);
          const earnedCoins = all.filter(c => c.claimed).reduce((s, c) => s + (c.coins ?? 0), 0);
          return (
          <>
            {(earnedXp > 0 || earnedCoins > 0) && (
              <p className="ch-earned" data-testid="challenges-earned">Earned: <b>{earnedXp} XP</b>{earnedCoins > 0 && <> · <b>{earnedCoins} coins</b></>}</p>
            )}
            <h3>Daily</h3>
            {profile.challenges.daily.map((c) => <ChallengeRow key={c.id} c={c} onClaim={claim} />)}
            <h3>Weekly</h3>
            {profile.challenges.weekly.map((c) => <ChallengeRow key={c.id} c={c} onClaim={claim} />)}
            {claiming && <p className="ch-claiming">Claiming…</p>}
          </>
          );
        })()}
        {tab === 'stats' && (
          <>
            <h3>Partnership</h3><StatsGrid stats={profile.stats.team} />
            <h3>Cutthroat</h3><StatsGrid stats={profile.stats.cutthroat} />
          </>
        )}
        {tab === 'achievements' && (
          <div className="ach-grid">
            {profile.achievements.map((a) => (
              <div key={a.id} className={`ach ${a.unlockedAt ? 'unlocked' : 'locked'}`}>
                <b>{a.title}</b><small>{a.unlockedAt ? 'Unlocked' : a.hint}</small><span>+{a.xp} XP{a.coins ? ` · +${a.coins} coins` : ''}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'unlocks' && (
          <div className="unlock-list">
            {profile.unlocks.length === 0 && <p className="muted">No unlocks yet — level up and earn achievements to unlock card backs, venues, and more.</p>}
            {profile.unlocks.map((u) => (
              <div key={u.itemId} className="unlock-row">
                <b>{u.itemId}</b><small>from {u.source}</small>{u.equipped && <span className="equipped-tag">Equipped</span>}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
