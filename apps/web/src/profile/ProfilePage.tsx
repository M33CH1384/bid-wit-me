import { useEffect, useRef, useState } from 'react';
import { AvatarCircle, compressAvatarFile, forgetAvatar, validateAvatarDataUrl } from '../avatar';
import { TaglineText } from '../tagline';
import { SOCIAL_PLATFORMS, SocialLinksChips, type SocialLinks } from '../socialLinks';
import { RepBlock } from '../RepBlock';

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
  user: { id: string; name: string; avatar: string | null; avatarUpdatedAt: number | null; tagline: string | null; socialLinks: SocialLinks };
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

/** Social-links editor: one row per platform; the server normalizes handles to
 *  canonical profile URLs and rejects anything that isn't really on the platform.
 *  Collapsed by default (Demetrius 2026-10-20: "If I'm not actively setting my
 *  social links those text inputs should be hidden") — the saved links already
 *  render as gold chips under the header, so until Edit links is tapped this
 *  section is just the Edit button (plus a muted "No links yet" when empty).
 *  Saving collapses back to that view; Cancel discards the draft. */
function SocialLinksEditor({ initial, onSaved }: { initial: SocialLinks; onSaved: () => void }) {
  const blank = () => {
    const d: Record<string, string> = {};
    for (const p of SOCIAL_PLATFORMS) d[p.id] = initial[p.id] ?? '';
    return d;
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = SOCIAL_PLATFORMS.some((p) => (draft[p.id] ?? '') !== (initial[p.id] ?? ''));
  const hasLinks = SOCIAL_PLATFORMS.some((p) => (initial[p.id] ?? '') !== '');

  const startEdit = () => { setDraft(blank()); setErr(null); setEditing(true); };
  const cancel = () => { setDraft(blank()); setErr(null); setEditing(false); };

  const save = async () => {
    setErr(null); setBusy(true);
    try {
      await api<{ ok: boolean; socialLinks: SocialLinks }>('/api/profile/me/social-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ links: draft }),
      });
      setEditing(false);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <div className="prof-links-edit">
        <span className="prof-pic-note">Social links — these link to your public profiles and show on your profile for other players.</span>
        {!hasLinks && <span className="prof-links-none">No links yet</span>}
        <div className="prof-link-actions">
          <button type="button" className="prof-pic-btn" data-testid="social-edit" onClick={startEdit}>Edit links</button>
        </div>
      </div>
    );
  }

  return (
    <div className="prof-links-edit">
      <span className="prof-pic-note">Social links — these link to your public profiles and show on your profile for other players.</span>
      {SOCIAL_PLATFORMS.map((p) => (
        <label key={p.id} className="prof-link-row">
          <span className="prof-link-name"><span aria-hidden>{p.glyph}</span> {p.label}</span>
          <input type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
            data-testid={`social-input-${p.id}`} placeholder={p.hint} value={draft[p.id] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))} />
        </label>
      ))}
      <div className="prof-link-actions">
        <button type="button" className="prof-pic-btn" data-testid="social-save" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save links'}
        </button>
        <button type="button" className="prof-pic-btn ghost" data-testid="social-cancel" disabled={busy} onClick={cancel}>Cancel</button>
        {err && <span className="prof-pic-err" role="alert">{err}</span>}
      </div>
    </div>
  );
}

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
  // Profile picture (Demetrius 2026-10-19): upload stands in for the camera at the table.
  const [uploading, setUploading] = useState(false);
  const [picBusy, setPicBusy] = useState(false);
  const [picErr, setPicErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Tagline (Demetrius 2026-10-20): null draft = untouched, showing the saved line.
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagErr, setTagErr] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<Profile>('/api/profile/me').then(setProfile).catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setPicErr(null); setUploading(true);
    try {
      const dataUrl = await compressAvatarFile(file);
      const v = validateAvatarDataUrl(dataUrl);
      if (!v.ok) throw new Error(v.error);
      setPicBusy(true);
      await api<{ ok: boolean }>('/api/profile/me/avatar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      load();
    } catch (e) { setPicErr((e as Error).message); } finally { setUploading(false); setPicBusy(false); }
  };

  const onRemovePic = async () => {
    if (!confirm('Remove your profile picture?')) return;
    setPicErr(null); setPicBusy(true);
    try {
      await api<{ ok: boolean }>('/api/profile/me/avatar', { method: 'DELETE' });
      if (profile) forgetAvatar(profile.user.id);
      load();
    } catch (e) { setPicErr((e as Error).message); } finally { setPicBusy(false); }
  };

  const onSaveTagline = async () => {
    if (tagDraft === null) return;
    setTagErr(null); setTagBusy(true);
    try {
      await api<{ ok: boolean; tagline: string | null }>('/api/profile/me/tagline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagline: tagDraft }),
      });
      setTagDraft(null);
      load();
    } catch (e) { setTagErr((e as Error).message); } finally { setTagBusy(false); }
  };

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

  const pendingClaims = [...profile.challenges.daily, ...profile.challenges.weekly].filter((c) => c.progress >= c.target && !c.claimed).length;
  const tagValue = tagDraft ?? profile.user.tagline ?? '';

  return (
    <div className="profile-page">
      <header className="prof-bar">
        <button type="button" className="back-chip" onClick={() => history.back()}>← BACK</button>
        <span className="prof-season">{profile.season.name}</span>
      </header>

      <div className="prof-header glass">
        <AvatarCircle pic={profile.user.avatar} name={profile.user.name} className="prof-avatar" />
        <div className="prof-id">
          <h2>{profile.user.name}</h2>
          <RepBlock testid="prof-rep" level={profile.level} team={profile.rank.team} cutthroat={profile.rank.cutthroat} />
          <TaglineText text={profile.user.tagline} className="prof-tagline" />
        </div>
        <div className="prof-coins">
          <b>{profile.coins.balance.toLocaleString()}</b>
          <span>Coins</span>
        </div>
      </div>

      <SocialLinksChips links={profile.user.socialLinks} testid="profile-social-links" />

      {/* Profile picture: shows at the table when your camera is off (Demetrius 2026-10-19). */}
      <div className="prof-pic-row">
        <span className="prof-pic-note">Profile picture — other players see it when your camera is off.</span>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden
          data-testid="avatar-file" onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="prof-pic-btn" data-testid="avatar-upload" disabled={uploading || picBusy} onClick={() => fileRef.current?.click()}>
          {uploading ? 'Working…' : profile.user.avatar ? 'Change picture' : 'Add a picture'}
        </button>
        {profile.user.avatar && (
          <button type="button" className="prof-pic-btn ghost" data-testid="avatar-remove" disabled={picBusy} onClick={() => void onRemovePic()}>Remove</button>
        )}
        {picErr && <span className="prof-pic-err" role="alert">{picErr}</span>}
      </div>

      {/* Tagline: a short line on your profile — links in it work (Demetrius 2026-10-20). */}
      <div className="prof-tag-row">
        <label className="prof-pic-note" htmlFor="prof-tagline-input">Tagline — shown on your profile. Links work.</label>
        <div className="prof-tag-edit">
          <input id="prof-tagline-input" data-testid="tagline-input" type="text" maxLength={140}
            placeholder="Say something about yourself…" value={tagValue}
            onChange={(e) => { setTagDraft(e.target.value); setTagErr(null); }} />
          <button type="button" className="prof-pic-btn" data-testid="tagline-save"
            disabled={tagBusy || tagDraft === null || tagValue === (profile.user.tagline ?? '')}
            onClick={() => void onSaveTagline()}>
            {tagBusy ? 'Saving…' : 'Save tagline'}
          </button>
        </div>
        <small className="prof-tag-count">{tagValue.length}/140 · clear it and save to remove</small>
        {tagErr && <span className="prof-pic-err" role="alert">{tagErr}</span>}
      </div>

      {/* Social links: public profile links on fixed platforms, server-normalized (Demetrius 2026-10-20). */}
      <SocialLinksEditor key={JSON.stringify(profile.user.socialLinks)} initial={profile.user.socialLinks} onSaved={load} />

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
