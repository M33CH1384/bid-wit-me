/**
 * The in-game profile modal (Demetrius 2026-10-20): tapping a player's picture at a
 * table opens their profile IN PLACE — a solid, opaque card over the table (no blur,
 * no transparency; the owner killed the see-through rewards overlay for this exact
 * reason) that closes when you tap outside it. The game keeps running underneath.
 *
 * Content mirrors the Social profile view (same two endpoints: /api/social/profile/:name
 * for the public record + /api/profile/:id for Rep — fetched by the RAW account id, see
 * profileTap.ts / the ea064aa normalization fix), in a compact card: big picture, name,
 * tagline, Rep level/title, division/Elo chips, coin balance, record, social links,
 * achievements/badges and the standard actions (incl. friend request with its states). Messaging is a QUICK-SEND box on the card itself (owner's
 * correction, 2026-10-20): tap Message, type, Send — one DM through the normal
 * social.dm path (it lands in the real DM thread for later, like any DM). The modal
 * never shows a thread and nothing navigates away from the table.
 */
import { type FormEvent, useEffect, useState } from 'react';
import { SOCIAL_LIMITS, statusLabel } from '@spades/protocol';
import { AvatarCircle, useAvatar } from '../avatar';
import { closeTableProfile, useTableProfileTarget, type ProfileTarget } from '../profileTap';
import { TaglineText } from '../tagline';
import { SocialLinksChips, type SocialLinks } from '../socialLinks';
import { RepBlock } from '../RepBlock';
import { useEscapeClose } from '../useEscapeClose';
import { MODE_NAME, } from './Social';
import { social, useSocial } from './store';
import { ChallengeButton } from './Wager';
import './social.css';

interface ProfileData {
  id?: string; avatar?: string | null;
  username: string; memberSince: number; tagline?: string | null;
  ratings: { team?: number; cutthroat?: number }; totals: { games: number; wins: number };
  champion: number;
}
interface CredPublic {
  user: { id: string; name: string; avatar: string | null; avatarUpdatedAt?: number | null; tagline?: string | null; socialLinks?: SocialLinks };
  level: { level: number; xp: number; xpForNext: number; xpIntoLevel: number; title: string };
  rank: { team: { division: string; elo: number }; cutthroat: { division: string; elo: number } };
  achievements: { id: string; title: string; unlockedAt: number | null }[];
  coins?: { balance: number };
}
const modeName = (m: string) => MODE_NAME[m] ?? m;

/** Mounted once inside the Table screen; renders nothing until a face tap opens it. */
export function TableProfileModal() {
  const target = useTableProfileTarget();
  const escRef = useEscapeClose(closeTableProfile);
  if (!target) return null;
  return (
    <div className="modal-backdrop profile-modal-backdrop" ref={escRef} data-testid="profile-modal-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) closeTableProfile(); }}>
      <div className="profile-modal-card" role="dialog" aria-modal="true" aria-label={`${target.name}'s profile`} data-testid="profile-modal"
        onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="profile-modal-x" aria-label="Close profile" data-testid="profile-modal-close" onClick={closeTableProfile}>✕</button>
        <ProfileCard key={target.pid} target={target} />
      </div>
    </div>
  );
}

function ProfileCard({ target }: { target: ProfileTarget }) {
  const s = useSocial();
  const [p, setP] = useState<ProfileData | null | 'missing'>(null);
  const [cred, setCred] = useState<CredPublic | null>(null);
  /** quick-send DM box: open state, draft, and the brief "Sent" confirmation */
  const [msgOpen, setMsgOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { if (!sent) return; const t = window.setTimeout(() => setSent(false), 2200); return () => window.clearTimeout(t); }, [sent]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/social/profile/${encodeURIComponent(target.name)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : 'missing')).then((j) => { if (alive) setP(j as ProfileData | 'missing'); }).catch(() => { if (alive) setP('missing'); });
    fetch(`/api/profile/${encodeURIComponent(target.uid)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setCred(j as CredPublic | null); }).catch(() => { if (alive) setCred(null); });
    return () => { alive = false; };
  }, [target.name, target.uid]);
  // the picture resolves exactly like chat faces do (useAvatar, cached), seeded by
  // whichever payload already carries it
  const pic = useAvatar(target.uid, cred?.user.avatar ?? (p && p !== 'missing' ? p.avatar : undefined), cred?.user.avatarUpdatedAt ?? undefined);
  const pid = target.pid;
  const me = s.you?.id === pid;
  const friend = (s.friends?.friends ?? []).some((f) => f.id === pid);
  const pending = (s.friends?.outgoing ?? []).some((f) => f.id === pid);
  const incoming = (s.friends?.incoming ?? []).some((f) => f.id === pid);
  const blocked = (s.friends?.blocked ?? []).some((f) => f.id === pid);
  const onlineEntry = s.users[pid];
  const unlocked = (cred?.achievements ?? []).filter((a) => a.unlockedAt);
  /** quick-send one DM through the normal store path — same thread, same delivery,
   *  same recipient toast/unread behavior as a DM sent from the Social panel. A dead
   *  socket makes social.dm raise its "Not connected" toast instead: keep the draft
   *  and the box open then, and only claim "Sent" when the hub is actually open.
   *  Server-side rejections (e.g. they blocked you) come back as store error toasts. */
  const sendDm = (e: FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    if (s.status !== 'open') { social.dm(pid, t); return; }
    social.dm(pid, t);
    setDraft('');
    setMsgOpen(false);
    setSent(true);
  };
  return (
    <div className="profile-modal-body">
      <div className="soc-prof-head">
        <AvatarCircle pic={pic} name={target.name} className="soc-av big" />
        <div>
          <h3 data-testid="profile-modal-name">{p && p !== 'missing' ? p.username : target.name}{p && p !== 'missing' && p.champion > 0 && <span className="soc-champ" title="Tournament champion">🏆×{p.champion}</span>}</h3>
          {p && p !== 'missing' && <p className="soc-muted">Member since {new Date(p.memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>}
          <TaglineText text={(p && p !== 'missing' ? p.tagline : undefined) ?? cred?.user.tagline} className="soc-tagline" />
          <p className={`soc-online-status ${onlineEntry ? 'on' : 'off'}`}>
            <i className="soc-dot" aria-hidden />{onlineEntry ? `Online — ${statusLabel(onlineEntry.status, modeName)}` : 'Offline'}
          </p>
        </div>
        {!me && (
          <div className="soc-prof-acts">
            {!blocked && <button type="button" aria-expanded={msgOpen} data-testid="profile-modal-message" onClick={() => setMsgOpen(!msgOpen)}>💬 Message</button>}
            {!blocked && onlineEntry && s.myTable && <button type="button" data-testid="profile-modal-invite" onClick={() => { social.invite(pid, s.myTable!); closeTableProfile(); }}>➕ Invite</button>}
            {!blocked && <ChallengeButton name={target.name} testid="profile-modal-challenge" onChallenge={() => { closeTableProfile(); social.startChallenge(target.name); }} />}
            {friend && <span className="soc-friend-tag" data-testid="profile-modal-friends">★ Friends</span>}
            {incoming && !friend && !blocked && <button type="button" className="primary" data-testid="profile-modal-accept" onClick={() => social.friend('accept', pid)}>Accept request</button>}
            {incoming && !friend && !blocked && <button type="button" className="ghost" data-testid="profile-modal-decline" onClick={() => social.friend('decline', pid)}>Decline</button>}
            {!friend && !incoming && !blocked && <button type="button" disabled={pending} data-testid="profile-modal-add" onClick={() => social.friend('request', pid)}>{pending ? 'Requested' : '👋 Add friend'}</button>}
            {blocked
              ? <button type="button" onClick={() => social.friend('unblock', pid)}>Unblock</button>
              : <button type="button" className="ghost" data-testid="profile-modal-block" onClick={() => { if (confirm(`Block ${target.name}? They won't see you online, can't message or invite you, and their chat is hidden.`)) { social.friend('block', pid); closeTableProfile(); } }}>Block</button>}
            <button type="button" className="ghost" data-testid="profile-modal-report" onClick={() => social.report('user', { user: pid })}>Report</button>
          </div>
        )}
        {!me && blocked && <p className="soc-note">You blocked {target.name}. Unblock them to message.</p>}
        {!me && !blocked && msgOpen && (
          <form className="soc-compose profile-modal-compose" onSubmit={sendDm}>
            <input ref={(el) => { if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }}
              value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={SOCIAL_LIMITS.chatMax}
              placeholder={`Message ${target.name}…`} aria-label={`Message ${target.name}`} data-testid="profile-modal-dm-input" />
            <button type="submit" className="primary" disabled={!draft.trim()} data-testid="profile-modal-dm-send">Send</button>
          </form>
        )}
        {sent && <p className="profile-modal-sent" role="status" data-testid="profile-modal-dm-sent">✓ Sent to {target.name}</p>}
        {cred && p && p !== 'missing' && (
          <RepBlock testid="profile-modal-rep" coinsTestid="profile-modal-coins"
            level={cred.level} team={cred.rank.team} cutthroat={cred.rank.cutthroat} coins={cred.coins?.balance} />
        )}
      </div>
      {p === null ? <p className="soc-empty">Loading…</p> : p === 'missing' ? <p className="soc-empty">No profile for {target.name}.</p> : (
        <>
          <SocialLinksChips links={cred?.user.socialLinks} testid="profile-modal-links" />
          <div className="soc-stats">
            <div><b>{p.totals.games}</b><small>online games</small></div>
            <div><b>{p.totals.games ? Math.round((p.totals.wins / p.totals.games) * 100) : 0}%</b><small>wins</small></div>
          </div>
          {cred && unlocked.length > 0 && (
            <>
              <h4>Achievements</h4>
              <div className="soc-badges">{unlocked.slice(0, 10).map((a) => <span key={a.id} className="soc-badge-chip">🏅 {a.title}</span>)}{unlocked.length > 10 && <span className="soc-badge-chip">+{unlocked.length - 10} more</span>}</div>
            </>
          )}
          {me && <p className="soc-muted">This is you.</p>}
        </>
      )}
    </div>
  );
}
