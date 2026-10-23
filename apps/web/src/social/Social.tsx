/**
 * Release 9 social UI: the Social button (with unread badge), the Social panel (players online, global chat, DMs,
 * friends, profiles, settings), invite toasts and notices. Mounted once at the root so invites reach you anywhere.
 */
import { Fragment, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DmLine, type InviteMsg, type OpenTable, type PresenceEntry, type PresenceStatus, REACT_PALETTE_EXTRA, SOCIAL_LIMITS, statusLabel } from '@spades/protocol';
import { storyStopById } from '@spades/bots';
import { useAccount } from '../account/api';
import { AvatarCircle, socialUidOf, useAvatar } from '../avatar';
import { createTable } from '../online/connection';
import { inviteLink, serverUrl } from '../online/config';
import { navigate } from '../online/nav';
import { loadSettings } from '../settings';
import { shownPlayers, friendPresenceView } from './presence';
import { type PlayerTableAction, playerTableAction } from './tableActions';
import { type MyTable, type SocialTab, type Toast, NOT_FRIENDS_TEXT, badgeCount, globalUnread, isMuted, social, useSocial } from './store';
import { applyMention, mentionQueryAt, rankMentionCandidates, splitMentionText } from './mentions';
import { openPlayerProfile, profileTargetOf } from '../profileTap';
import { Leaderboards, Tournaments } from './Compete';
import { LeagueTicker } from './LeagueTicker';
import { WagerChallenges } from './Wager';
import { UnlockPopups } from './UnlockPopups';
import { chatStickToBottom } from '../chatScroll';
import { chatGroupInfo, chatTimeLabel } from './chatTime';
import { POPOVER_H, POPOVER_H_PALETTE, POPOVER_H_REPLY, popoverPos, useMsgPress, type AnchorRect } from './msgPress';
import { ReactionChips, ReactionPicker } from '../reactions';
import GearIcon from '../GearIcon';
import { ProfileView } from '../profile/ProfileView';
import './social.css';

export const MODE_NAME: Record<string, string> = { joker: 'Joker Spades', aceDown: 'Ace Down', cutthroat: 'Cutthroat' };
const modeName = (m: string) => MODE_NAME[m] ?? m;

/** report what you're doing (Online / In lobby / At a table / In tournament) while this component is mounted */
export function usePresence(status: PresenceStatus | null): void {
  const key = JSON.stringify(status);
  useEffect(() => {
    if (!status) return;
    social.setStatus(status);
    return () => social.setStatus({ kind: 'online' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function SocialButton({ className = '', label = true }: { className?: string; label?: boolean }) {
  const s = useSocial();
  const n = badgeCount(s);
  const dot = !n && globalUnread(s) > 0;
  return (
    <button type="button" className={`social-btn ${className}`} data-testid="social-btn" aria-label={`Social${n ? ` (${n} new)` : ''}`} onClick={() => social.open()}>
      <span className="social-ico" aria-hidden>👥</span>{label && <span className="social-lbl">Social</span>}
      {n > 0 && <span className="social-badge" data-testid="social-badge">{n > 99 ? '99+' : n}</span>}
      {dot && <span className="social-dot" aria-hidden />}
    </button>
  );
}

export function SocialRoot() {
  const s = useSocial();
  useEffect(() => { social.start(); }, []);
  return (
    <>
      {s.open && <SocialPanel />}
      <UnlockPopups />
      <div className={`soc-toasts${s.open ? ' over-panel' : ''}`} aria-live="polite">
        {s.invites.map((inv) => <InviteToast key={inv.id} inv={inv} />)}
        {s.notices.map((n) => (
          <div key={n.id} className="soc-invite soc-notice" data-testid="soc-notice">
            <div className="soc-invite-txt">🏆 {n.text}</div>
            <div className="soc-invite-acts">
              {n.code ? <button type="button" className="primary" data-testid="notice-go" onClick={() => { social.dismissNotice(n.id); social.close(); navigate(`/t/${n.code}${n.seat !== undefined ? `?seat=${n.seat}` : ''}`); }}>Go</button>
                : n.tid ? <button type="button" className="primary" onClick={() => { social.dismissNotice(n.id); social.showTour(n.tid!); }}>View</button>
                : n.cid ? <button type="button" className="primary" data-testid="notice-challenge" onClick={() => { social.dismissNotice(n.id); social.showChallenge(n.cid!); }}>View</button> : null}
              <button type="button" onClick={() => social.dismissNotice(n.id)} aria-label="Dismiss">✕</button>
            </div>
          </div>
        ))}
        {s.toasts.map((t) => (t.action
          ? <ActionToast key={t.id} t={t} />
          : <div key={t.id} className={`soc-toast ${t.kind}`} data-testid="soc-toast" onClick={() => social.dismissToast(t.id)}>{t.text}</div>))}
      </div>
    </>
  );
}

/**
 * A toast with somewhere to go (friend request → Friends tab): the whole card is the tap
 * target; the ✕ only dismisses (stopPropagation, so the two never double-fire). Stays up
 * longer than a plain toast (see store.ts) so there's time to actually tap it.
 * Friend-request toasts (action.friendId set) also get inline Accept/Decline buttons,
 * like the game InviteToast: answer the request right in the popup, no Social trip needed.
 */
function ActionToast({ t }: { t: Toast }) {
  const action = t.action;
  if (!action) return null;
  const go = () => {
    social.showProfile(null);
    social.open(action.tab);
    social.dismissToast(t.id);
  };
  // Only the card itself is keyboard-activatable: Enter/Space on a button inside must
  // run that button, not also navigate (keydown bubbles up from the focused button).
  const onCardKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  };
  const dismiss = (e: React.SyntheticEvent) => { e.stopPropagation(); social.dismissToast(t.id); };
  if (action.friendId) {
    const reply = (accept: boolean) => (e: React.SyntheticEvent) => {
      e.stopPropagation();
      social.friend(accept ? 'accept' : 'decline', action.friendId!);
      social.dismissToast(t.id);
    };
    return (
      <div className={`soc-toast action friend ${t.kind}`} role="button" tabIndex={0} data-testid="soc-toast-action"
        aria-label={`${t.text} Accept or decline this friend request, or tap to view requests.`} onClick={go} onKeyDown={onCardKey}>
        <div className="fr-head">
          <span className="fr-txt">{t.text}</span>
          <button type="button" className="fr-x" aria-label="Dismiss" data-testid="soc-toast-x" onClick={dismiss}>✕</button>
        </div>
        <div className="fr-btns">
          <button type="button" data-testid="soc-toast-decline" onClick={reply(false)}>Decline</button>
          <button type="button" className="primary" data-testid="soc-toast-accept" onClick={reply(true)}>Accept</button>
        </div>
      </div>
    );
  }
  return (
    <div className={`soc-toast action ${t.kind}`} role="button" tabIndex={0} data-testid="soc-toast-action"
      aria-label={`${t.text} ${action.label}.`} onClick={go} onKeyDown={onCardKey}>
      <span className="fr-txt">{t.text}</span>
      <span className="fr-view" aria-hidden>{action.label} →</span>
      <button type="button" className="fr-x" aria-label="Dismiss" data-testid="soc-toast-x" onClick={dismiss}>✕</button>
    </div>
  );
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function InviteToast({ inv }: { inv: InviteMsg }) {
  const now = useNow();
  const left = Math.max(0, Math.ceil((inv.expiresAt - now) / 1000));
  useEffect(() => { if (left <= 0) social.replyInvite(inv, false); }, [left, inv]);
  const story = inv.kind === 'story-coop';
  const accept = () => {
    social.replyInvite(inv, true);
    social.close();
    // A story invite lands on the story route, which binds the account to
    // the room (and so fixes the pair track) before showing the table.
    if (story) navigate(`/story?coop=${inv.code}`);
    else navigate(`/t/${inv.code}${inv.seat !== undefined ? `?seat=${inv.seat}` : ''}`);
  };
  return (
    <div className="soc-invite glass slant" role="alertdialog" aria-label={`Invite from ${inv.fromName}`} data-testid={story ? 'invite-toast-story' : 'invite-toast'}>
      <div className="soc-invite-txt"><b>{inv.fromName}</b> {story
        ? <>invited you to run <b>Story Mode</b> together{inv.stopId ? <> — starting at {storyStopById(inv.stopId)?.name ?? 'the Porch'}</> : ''}<small>Story table {inv.code} · {left}s</small></>
        : <>invited you to {inv.mode ? modeName(inv.mode) : 'a table'}<small>Table {inv.code} · {left}s</small></>}
      </div>
      <div className="soc-invite-btns">
        <button type="button" onClick={() => social.replyInvite(inv, false)} data-testid="invite-decline">Decline</button>
        <button type="button" className="primary" onClick={accept} data-testid="invite-accept">Accept</button>
      </div>
      <i className="soc-invite-bar" style={{ width: `${(left / 60) * 100}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

const TABS: [SocialTab, string][] = [['players', 'Players'], ['chat', 'Chat'], ['friends', 'Friends'], ['leaders', 'Ranks']];
/** share a link: native share sheet when there is one, else copy */
async function shareLink(url: string, text: string) {
  if (navigator.share) { try { await navigator.share({ title: 'Bid Wit Me', text, url }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(url); social.toast('Link copied', 'info'); } catch { social.toast(url, 'info'); }
}

function SocialPanel() {
  const s = useSocial();
  const acct = useAccount();
  const signedIn = !!acct.user?.username;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') social.close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const unreadDm = Object.values(s.unread).reduce((a, b) => a + b, 0);
  const counts: Partial<Record<SocialTab, number>> = { chat: globalUnread(s) + unreadDm, friends: s.friends?.incoming.length ?? 0 };
  // Neon Royale: the tab indicator glides — measure the active tab button and
  // park --tab-x/--tab-w on the nav; CSS (Neon-scoped) animates the move.
  // Classic never reads the vars, and the glide span is display:none there.
  const tabsRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const measure = () => {
      const nav = tabsRef.current;
      if (!nav) return;
      const on = nav.querySelector<HTMLElement>('button.on');
      nav.style.setProperty('--tab-x', `${on?.offsetLeft ?? 0}px`);
      nav.style.setProperty('--tab-w', `${on?.offsetWidth ?? 0}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
  const [gear, setGear] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const tabOn = (k: SocialTab) => !s.profile && (s.tab === k || (k === 'chat' && s.tab === 'messages'));
  const grab = {
    onPointerDown: (e: React.PointerEvent) => { if ((e.target as HTMLElement).closest('button')) return; start.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); },
    onPointerMove: (e: React.PointerEvent) => { if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current)); },
    onPointerUp: () => { if (start.current !== null && drag > 90) social.close(); start.current = null; setDrag(0); },
    onPointerCancel: () => { start.current = null; setDrag(0); },
  };
  return (
    <div className="modal-backdrop soc-backdrop" onClick={() => social.close()} data-testid="social-backdrop">
      <aside className="soc-panel" role="dialog" aria-label="Social" data-testid="social-panel" onClick={(e) => e.stopPropagation()}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}>
        <div className="soc-grab" {...grab}><span className="soc-handle" aria-hidden /></div>
        <header className="soc-head" {...grab}>
          <span className="panel-title">SOCIAL</span>
          <span className={`soc-conn ${s.status}`} title={s.status}>{s.status === 'open' ? `${Object.keys(s.users).length} online` : s.status === 'off' ? '' : 'connecting…'}</span>
          <span className="soc-gear-wrap">
            <button type="button" className={`icon-btn ${s.tab === 'tournaments' || s.tab === 'challenges' || s.tab === 'settings' ? 'on' : ''}`} aria-label="Events and settings" aria-expanded={gear} data-testid="social-gear" onClick={() => setGear(!gear)}><GearIcon /></button>
            {gear && (
              <span className="soc-gear-menu" role="menu">
                <button type="button" role="menuitem" data-testid="soc-tab-tournaments" onClick={() => { social.tab('tournaments'); setGear(false); }}>🏆 Events &amp; tournaments</button>
                <button type="button" role="menuitem" data-testid="soc-tab-challenges" onClick={() => { social.tab('challenges'); setGear(false); }}>🏦 Big Bank challenges</button>
                <button type="button" role="menuitem" data-testid="soc-tab-settings" onClick={() => { social.tab('settings'); setGear(false); }}><GearIcon size={15} /> Social settings</button>
              </span>
            )}
          </span>
          <button type="button" className="sheet-close" aria-label="Close" data-testid="social-close" onClick={() => social.close()}>CLOSE</button>
        </header>
        <nav className="soc-tabs" role="tablist" ref={tabsRef}>
          <span className="soc-tab-glide" aria-hidden="true" />
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tabOn(k)} className={tabOn(k) ? 'on' : ''} data-testid={`soc-tab-${k}`} onClick={() => social.tab(k)}>
              {label}{!!counts[k] && <i className="soc-count">{counts[k]}</i>}
            </button>
          ))}
        </nav>
        {(s.tab === 'chat' || s.tab === 'messages') && !s.profile && (
          <div className="soc-seg" role="tablist" aria-label="Chat">
            <button type="button" role="tab" aria-selected={s.tab === 'chat'} className={s.tab === 'chat' ? 'on' : ''} data-testid="chat-seg-global" onClick={() => social.tab('chat')}>🌍 Global{globalUnread(s) > 0 && <i className="soc-count">{globalUnread(s)}</i>}</button>
            <button type="button" role="tab" aria-selected={s.tab === 'messages'} className={s.tab === 'messages' ? 'on' : ''} data-testid="soc-tab-messages" onClick={() => social.tab('messages')}>✉ Messages{unreadDm > 0 && <i className="soc-count">{unreadDm}</i>}</button>
          </div>
        )}
        <div className="soc-body">
          {s.profile ? <ProfileView host="panel" name={s.profile} id={s.profileId ?? undefined} /> :
            s.tab === 'players' ? <Players signedIn={signedIn} /> :
            s.tab === 'chat' ? <GlobalChat signedIn={signedIn} /> :
            s.tab === 'messages' ? <Messages signedIn={signedIn} /> :
            s.tab === 'friends' ? <Friends signedIn={signedIn} /> :
            s.tab === 'leaders' ? <Leaderboards /> :
            s.tab === 'tournaments' ? <Tournaments signedIn={signedIn} /> :
            s.tab === 'challenges' ? <WagerChallenges signedIn={signedIn} /> :
            <SettingsTab signedIn={signedIn} />}
        </div>
        {/* The BottomLine as the panel's own footer (league data wave 6a):
            the same shared component as the app-wide root bar, in flow so
            it reserves its height. Hidden while a composer owns the panel's
            bottom (global chat / DM tabs) — the one surface rule. */}
        {(s.profile || (s.tab !== 'chat' && s.tab !== 'messages')) && <LeagueTicker variant="panel" />}
      </aside>
    </div>
  );
}

function AloneEmpty() {
  const s = useSocial();
  const shareCode = async () => {
    if (s.myTable) await shareLink(inviteLink(s.myTable.code), `Pull up to my Spades table on Bid Wit Me 🃏 Code ${s.myTable.code}`);
  };
  return (
    <div className="soc-alone" data-testid="soc-alone">
      <span className="soc-alone-ic" aria-hidden>🃏</span>
      <p><b>It's just you right now.</b><br />Bring your people to the table.</p>
      {s.myTable
        ? <button type="button" className="primary" data-testid="alone-share-code" onClick={() => void shareCode()}>Share table code {s.myTable.code}</button>
        : <button type="button" className="primary" data-testid="alone-invite" onClick={() => void shareLink(location.origin, 'Come play Spades with me on Bid Wit Me 🃏')}>Invite friends</button>}
    </div>
  );
}

function SignInNote({ what }: { what: string }) {
  return <p className="soc-note" data-testid="soc-signin-note">Sign in (top-left on the start screen) to {what}. Guests can watch the players list and read the global chat.</p>;
}

/** invite: to the table you're at, or a new table with your current settings.
 *  Exported for the unified profile view (profile/ProfileView.tsx), whose
 *  action row offers the same Invite as the player rows here. */
export async function inviteTo(pid: string, mine: MyTable | null) {
  if (mine) { social.invite(pid, mine); return; }
  try {
    const st = loadSettings();
    const code = await createTable(serverUrl());
    sessionStorage.setItem(`bwm.created.${code}`, '1');
    const mode = st.mode === 'joker' ? 'joker' : st.mode === 'aceDown' ? 'aceDown' : 'cutthroat';
    social.invite(pid, { code, mode, seat: st.mode === 'joker' || st.mode === 'aceDown' ? 2 : 1, open: 3 });
    social.close();
    navigate(`/t/${code}`);
  } catch { social.toast("Couldn't create a table. Try again.", 'error'); }
}

function Players({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const [q, setQ] = useState('');
  const friendIds = useMemo(() => new Set((s.friends?.friends ?? []).map((f) => f.id)), [s.friends]);
  const outgoing = useMemo(() => new Set((s.friends?.outgoing ?? []).map((f) => f.id)), [s.friends]);
  const mutedIds = useMemo(() => new Set((s.friends?.muted ?? []).map((f) => f.id)), [s.friends]);
  const list = shownPlayers(Object.values(s.users), s.tables, Object.keys(s.ended), Date.now())
    .filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.id === s.you?.id ? -1 : b.id === s.you?.id ? 1 : 0) || (+friendIds.has(b.id) - +friendIds.has(a.id)) || (+a.guest - +b.guest) || a.name.localeCompare(b.name));
  return (
    <div className="soc-players">
      <input className="soc-search" type="search" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" data-testid="soc-search" />
      {!signedIn && <SignInNote what="chat, add friends and invite players" />}
      {s.myTable && <p className="soc-mytable">Your table <b>{s.myTable.code}</b> · {s.myTable.open} seat{s.myTable.open === 1 ? '' : 's'} open</p>}
      <ul className="soc-list" data-testid="players-list">
        {list.map((u) => <PlayerRow key={u.id} u={u} me={u.id === s.you?.id} friend={friendIds.has(u.id)} pending={outgoing.has(u.id)} muted={mutedIds.has(u.id)} signedIn={signedIn} myTable={s.myTable} tables={s.tables} />)}
        {!list.length && q && <li className="soc-empty">Nobody by that name is online.</li>}
      </ul>
      {!q && s.status === 'open' && list.filter((u) => u.id !== s.you?.id).length === 0 && <AloneEmpty />}
    </div>
  );
}

function Rating({ r }: { r?: PresenceEntry['rating'] }) {
  if (!r || (!r.team && !r.cutthroat)) return null;
  return <span className="soc-rating" title="Rating (2v2 / Cutthroat)">{r.team ? `⚔ ${r.team}` : ''}{r.team && r.cutthroat ? ' · ' : ''}{r.cutthroat ? `🔪 ${r.cutthroat}` : ''}</span>;
}

/**
 * A social face circle: the player's uploaded picture when they have one, else the initial.
 * Faces are tappable (Demetrius 2026-10-20): a tap opens that player's profile — the panel
 * view here, the over-table modal when a game is up (profileTap decides). Guests and
 * id-less faces stay plain. `tap={false}` for faces already inside a profile-opening
 * control (the DM header), where a nested button would be invalid.
 */
function SocFace({ id, name, className, tap = true }: { id?: string; name: string; className?: string; tap?: boolean }) {
  const pic = useAvatar(socialUidOf(id));
  const target = tap ? profileTargetOf({ id, name }) : null;
  return <AvatarCircle pic={pic} name={name} className={className} onTap={target ? () => openPlayerProfile({ id, name }) : undefined} />;
}

function PlayerRow({ u, me, friend, pending, muted, signedIn, myTable, tables }: {
  u: PresenceEntry; me: boolean; friend: boolean; pending: boolean; muted: boolean; signedIn: boolean; myTable: MyTable | null;
  tables: Record<string, OpenTable>;
}) {
  const canInvite = signedIn && !me && !(myTable && myTable.open < 1);
  const table = me ? null : playerTableAction(u.status, tables, myTable?.code ?? null);
  return (
    <li className={`soc-player ${friend ? 'friend' : ''}`} data-testid={`player-${u.name}`}>
      <div className="soc-pl-main">
        <SocFace id={u.id} name={u.name} className={`soc-av ${u.guest ? 'guest' : ''}`} />
        <span className="soc-pl-txt">
          {!u.guest
            ? <button type="button" className="soc-pl-name link" onClick={() => social.showProfile(u.name, u.id)} data-testid={`pl-name-${u.name}`}>{u.name}{me && <em> (you)</em>}{u.guest && <i className="soc-tag">Guest</i>}{friend && <i className="soc-tag friend" title="Friend">★ Friend</i>}{muted && <i className="soc-tag muted" title="You muted this player (they don't know)">Muted</i>}</button>
            : <span className="soc-pl-name">{u.name}{me && <em> (you)</em>}{u.guest && <i className="soc-tag">Guest</i>}{friend && <i className="soc-tag friend" title="Friend">★ Friend</i>}{muted && <i className="soc-tag muted" title="You muted this player (they don't know)">Muted</i>}</span>}
          <span className={`soc-pl-status ${u.status.kind}`}>{statusLabel(u.status, modeName)}</span>
        </span>
        <Rating r={u.rating} />
      </div>
      {!me && (
        <div className="soc-pl-acts">
          {table && <TableActs name={u.name} act={table} />}
          {!u.guest && <button type="button" disabled={!signedIn} onClick={() => social.openDm(u.id)} data-testid={`pl-chat-${u.name}`}>💬 Chat</button>}
          <button type="button" disabled={!canInvite} onClick={() => void inviteTo(u.id, myTable)} data-testid={`pl-invite-${u.name}`}>➕ Invite{myTable ? '' : ' (new table)'}</button>
          {!u.guest && !friend && <button type="button" disabled={!signedIn || pending} onClick={() => social.friend('request', u.id)} data-testid={`pl-add-${u.name}`}>{pending ? 'Requested' : '👋 Add friend'}</button>}
          {!u.guest && <button type="button" disabled={!signedIn} onClick={() => social.mute(u.id, !muted)} data-testid={`pl-mute-${u.name}`} title={muted ? `Unmute ${u.name}` : `Mute ${u.name} (they won't know)`}>{muted ? '🔊 Unmute' : '🔇 Mute'}</button>}
          {!u.guest && <button type="button" onClick={() => social.showProfile(u.name, u.id)} data-testid={`pl-profile-${u.name}`}>👤 Profile</button>}
        </div>
      )}
    </li>
  );
}

function goTable(code: string, query: string) {
  social.close();
  navigate(`/t/${code}${query}`);
}

function TableActs({ name, act }: { name: string; act: PlayerTableAction }) {
  // Local vs-bots game: no dead buttons. Show a clear indicator instead (Demetrius 2026-10-19).
  if (act.local) {
    return <span className="soc-pl-local" data-testid={`pl-local-${name}`} title="Playing on their own device — not an online table">🎮 Local game</span>;
  }
  const reason = act.spectateReason;
  return (
    <>
      <button type="button" disabled={!!act.spectateReason} title={act.spectateReason}
        data-testid={`pl-spectate-${name}`}
        onClick={() => { if (act.code && !act.spectateReason) goTable(act.code, '?watch=1'); }}>👁 Spectate</button>
      {act.join && act.code ? (
        <button type="button" className="primary" data-testid={`pl-join-${name}`}
          onClick={() => goTable(act.code!, act.seat !== undefined ? `?seat=${act.seat}` : '')}>{act.joinLabel}</button>
      ) : null}
      {reason && <span className="soc-pl-why" data-testid={`pl-why-${name}`}>{reason}</span>}
    </>
  );
}

function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(at).toLocaleDateString();
}

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => { stick.current = chatStickToBottom(el); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [dep]);
  return ref;
}

/**
 * Chat text with its server-resolved @mentions highlighted. Only tokens
 * the server actually resolved (the line's `mentions`, mapped pid → known
 * name) light up; an @name that resolved to nobody stays plain text.
 */
function MentionText({ text, mentions, namesByPid }: { text: string; mentions?: string[]; namesByPid: Map<string, string> }) {
  if (!mentions?.length) return <>{text}</>;
  const keys = new Set<string>();
  for (const pid of mentions) { const n = namesByPid.get(pid); if (n) keys.add(n.toLowerCase()); }
  if (!keys.size) return <>{text}</>;
  const segs = splitMentionText(text, (k) => keys.has(k));
  return <>{segs.map((sg, i) => (sg.mention ? <b key={i} className="soc-mention">{sg.text}</b> : <Fragment key={i}>{sg.text}</Fragment>))}</>;
}

function Composer({ onSend, placeholder, disabled, testid, mentionFrom }: {
  onSend: (t: string) => void; placeholder: string; disabled?: boolean; testid: string;
  /** @ completion candidates, best-first (friends → online players → table roster). Omit = no completion (DM threads: out of scope by design). */
  mentionFrom?: readonly { name: string }[];
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = mentionFrom && !disabled ? mentionQueryAt(text, caret) : null;
  const options = query && query.start !== dismissedAt ? rankMentionCandidates(mentionFrom!, query.query) : [];
  const open = options.length > 0;
  useEffect(() => { setPick(0); }, [query?.query, query?.start]);
  const choose = (name: string) => {
    if (!query) return;
    const r = applyMention(text, query, caret, name);
    setText(r.text);
    setCaret(r.caret);
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret); } });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); const t = text.trim(); if (!t) return; onSend(t); setText(''); setCaret(0); };
  return (
    <form className="soc-compose" onSubmit={submit}>
      {open && (
        <ul className="soc-mention-pop" role="listbox" aria-label="Mention a player" data-testid={`${testid}-mention-pop`}>
          {options.map((o, i) => (
            <li key={o.name}>
              <button type="button" role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''}
                data-testid={`${testid}-mention-${o.name}`}
                onMouseDown={(e) => { e.preventDefault(); choose(o.name); }}
                onMouseEnter={() => setPick(i)}>@{o.name}</button>
            </li>
          ))}
        </ul>
      )}
      <input ref={inputRef} value={text}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setDismissedAt(-1); }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setPick((p) => (p + 1) % options.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => (p - 1 + options.length) % options.length); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(options[pick]!.name); }
          else if (e.key === 'Escape') { e.preventDefault(); setDismissedAt(query!.start); }
        }}
        maxLength={SOCIAL_LIMITS.chatMax} placeholder={placeholder} disabled={disabled} aria-label={placeholder} data-testid={`${testid}-input`} />
      <button type="submit" className="primary" disabled={disabled || !text.trim()} data-testid={`${testid}-send`}>Send</button>
    </form>
  );
}

/**
 * The iMessage-style action popover for a long-pressed message (see msgPress.ts):
 * a fixed backdrop that eats outside taps, the six-emoji reaction strip on top (with
 * a "+" that expands a palette of extra reaction emojis) and a plain Reply row below,
 * anchored to the pressed bubble. Picking an emoji acts and closes; a backdrop tap
 * just closes (and arms the click swallow, since the tap's click lands on the lines
 * once the backdrop is gone). Reply expands the popover IN PLACE into a mini composer
 * — quote snippet on top, autofocused input + Send below — and sends through the
 * chat's normal reply path; dismissing it discards the draft.
 */
function MsgPopover({ rect, mine, quote, onReact, onSendReply, onClose, onBackdrop, onEditingChange }: {
  rect: AnchorRect; mine: boolean;
  /** the pressed line as a quote (author + text) for the in-popover reply editor */
  quote: { from: string; text: string };
  onReact: (emoji: string) => void;
  /** post the reply text through the chat's normal reply send path */
  onSendReply: (text: string) => void;
  onClose: () => void; onBackdrop: () => void;
  /** reports whether the reply editor is open — while it is, the parent suspends
   *  scroll/resize dismissal (the iOS keyboard opening must not kill the editor) */
  onEditingChange: (editing: boolean) => void;
}) {
  const [mode, setMode] = useState<'menu' | 'palette' | 'reply'>('menu');
  const [draft, setDraft] = useState('');
  useEffect(() => { onEditingChange(mode === 'reply'); }, [mode, onEditingChange]);
  useEffect(() => () => onEditingChange(false), [onEditingChange]);
  const h = mode === 'palette' ? POPOVER_H_PALETTE : mode === 'reply' ? POPOVER_H_REPLY : POPOVER_H;
  const pos = popoverPos(rect, window.innerWidth, window.innerHeight, mine, h);
  const sendReply = (e: FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    onSendReply(t);
    onClose();
  };
  return (
    <>
      <div className="soc-pop-backdrop" data-testid="msg-pop-backdrop" onPointerDown={onBackdrop}
        onContextMenu={(e) => { e.preventDefault(); onBackdrop(); }} />
      <div className="soc-pop" data-testid="msg-actions" role="menu" aria-label="Message actions" style={{ left: pos.left, top: pos.top }}>
        {mode === 'reply' ? (
          <form className="soc-pop-replybox" onSubmit={sendReply}>
            <div className="soc-pop-quote">
              <span className="soc-pop-quote-txt"><b>{quote.from}</b> {quote.text}</span>
              <button type="button" className="soc-pop-x" aria-label="Cancel reply" data-testid="msg-pop-reply-cancel" onClick={onClose}>✕</button>
            </div>
            <div className="soc-pop-replyrow">
              <input ref={(el) => { if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }}
                value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={SOCIAL_LIMITS.chatMax}
                placeholder={`Reply to ${quote.from}…`} aria-label={`Reply to ${quote.from}`} data-testid="msg-pop-reply-input" />
              <button type="submit" className="primary" disabled={!draft.trim()} data-testid="msg-pop-reply-send">Send</button>
            </div>
          </form>
        ) : (
          <>
            <div className="soc-pop-strip">
              <ReactionPicker onPick={(e) => { onReact(e); onClose(); }} />
              <button type="button" className="rx-pick soc-pop-more" aria-label="More reactions" aria-expanded={mode === 'palette'}
                data-testid="msg-pop-more" onClick={() => setMode(mode === 'palette' ? 'menu' : 'palette')}>+</button>
            </div>
            {mode === 'palette' && (
              <div className="soc-pop-palette" role="group" aria-label="More reactions">
                {REACT_PALETTE_EXTRA.map((e) => (
                  <button key={e} type="button" className="rx-pick soc-pop-pal" aria-label={`React with ${e}`} data-testid="msg-pop-palette-pick" onClick={() => { onReact(e); onClose(); }}>{e}</button>
                ))}
              </div>
            )}
            <button type="button" className="soc-pop-reply" data-testid="msg-pop-reply" onClick={() => setMode('reply')}>Reply</button>
          </>
        )}
      </div>
    </>
  );
}

/** scroll (or a viewport resize) dismisses an open message popover — nothing stays armed.
 *  Suspended while the popover's reply editor is open: the on-screen keyboard resizes
 *  the viewport (and can nudge scroll) and must not dismiss the editor mid-type. */
function usePopoverDismiss(open: unknown, ref: React.RefObject<HTMLDivElement | null>, close: () => void, suspendRef?: { current: boolean }) {
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const onScroll = () => { if (!suspendRef?.current) close(); };
    el?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { el?.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [open, ref, close, suspendRef]);
}

function GlobalChat({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const ref = useStickToBottom(s.global.length);
  const [menu, setMenu] = useState<number | null>(null);
  /** long-press / right-click message actions (reaction strip + Reply popover) */
  const press = useMsgPress();
  /** true while the popover's in-place reply editor is open (suspends its dismissal) */
  const popEditingRef = useRef(false);
  const setPopEditing = useCallback((b: boolean) => { popEditingRef.current = b; }, []);
  usePopoverDismiss(press.open, ref, press.close, popEditingRef);
  useEffect(() => { if (press.open) setMenu(null); }, [press.open]);
  /** a line briefly highlighted after tapping a quote that points at it */
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => { social.markGlobalSeen(); }, [s.global.length]);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  /** tap a quote: scroll to the original (when it's rendered) and flash it */
  const jumpTo = (id: number) => {
    const el = ref.current?.querySelector(`[data-line-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setFlashId(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), 1600);
  };
  /** pid → display name, for lighting up resolved @mention tokens */
  const namesByPid = useMemo(() => {
    const m = new Map<string, string>();
    for (const [pid, name] of Object.entries(s.names)) m.set(pid, name);
    for (const f of [...(s.friends?.friends ?? []), ...(s.friends?.incoming ?? []), ...(s.friends?.outgoing ?? []), ...(s.friends?.muted ?? [])]) m.set(f.id, f.name);
    for (const u of Object.values(s.users)) m.set(u.id, u.name);
    return m;
  }, [s.names, s.friends, s.users]);
  /** @ completion candidates: friends first, then everyone online (accounts only) */
  const mentionCandidates = useMemo(() => {
    const out: { name: string }[] = [];
    for (const f of s.friends?.friends ?? []) out.push({ name: f.name });
    for (const u of Object.values(s.users)) if (!u.guest && u.id !== s.you?.id) out.push({ name: u.name });
    return out;
  }, [s.friends, s.users, s.you]);
  return (
    <div className="soc-chat">
      <div className="soc-lines" ref={ref} data-testid="global-lines">
        {!s.global.length && <p className="soc-empty">No messages yet. Say hi 👋</p>}
        {s.global.map((l, i) => {
          const mine = l.from === s.you?.id;
          const g = chatGroupInfo(s.global, i);
          // League Wire (item 7): a system line, rendered as a wire block —
          // no avatar, no profile, no press menu, no reactions. The byline
          // is the stored line name ("BWM LEAGUE WIRE").
          if (l.wire) {
            return (
              <Fragment key={l.id}>
                {g.separator && <div className="soc-time-sep">{chatTimeLabel(l.at)}</div>}
                <div className="soc-wire" data-testid="wire-line" data-line-id={l.id} role="note">
                  <span className="soc-wire-byline">🚨 {l.name}</span>
                  <span className="soc-wire-text">{l.text}</span>
                </div>
              </Fragment>
            );
          }
          return (
            <Fragment key={l.id}>
              {g.separator && <div className="soc-time-sep">{chatTimeLabel(l.at)}</div>}
              <div data-line-id={l.id} onClickCapture={press.onClickCapture} className={`soc-line ${mine ? 'mine' : ''} ${g.groupStart ? 'g-start' : 'cont'}${flashId === l.id ? ' flash' : ''}${press.open?.id === l.id ? ' armed' : ''}`} data-testid="global-line">
                {!mine && (g.groupEnd
                  ? <SocFace id={l.from} name={l.name} className={`soc-av msg ${l.from.startsWith('g:') ? 'guest' : ''}`} />
                  : <span className="soc-av msg blank" aria-hidden="true" />)}
                <div className="soc-msg-col">
                  {!mine && g.groupStart && (
                    <button type="button" className="soc-line-name" onClick={() => !l.from.startsWith('g:') && social.showProfile(l.name, l.from.startsWith('u:') ? l.from.slice(2) : undefined)}>{l.name}{l.admin && <i className="soc-tag mod">MOD</i>}</button>
                  )}
                  <div className="soc-bubble-row">
                    <div className={`soc-bubble ${g.groupEnd ? 'tail' : ''}${l.mentions?.includes(s.you?.id ?? '') ? ' mentions-me' : ''}`} {...(signedIn ? press.bind(l.id) : {})}>
                      {l.reply && (
                        <button type="button" className="soc-quote" data-testid={`quote-${l.id}`} onClick={() => jumpTo(l.reply!.id)} aria-label={`Quoted message by ${l.reply.from}: ${l.reply.text}`}>
                          <b>{l.reply.from}</b> {l.reply.text}
                        </button>
                      )}
                      <span className="soc-line-text"><MentionText text={l.text} mentions={l.mentions} namesByPid={namesByPid} /></span>
                    </div>
                    <span className="soc-line-acts">
                      {!mine && (signedIn || s.admin) && <button type="button" className="soc-more" aria-label="Message actions" data-testid={`line-more-${l.id}`} onClick={() => setMenu(menu === l.id ? null : l.id)}>⋯</button>}
                      {s.admin && mine && <button type="button" className="soc-more" aria-label="Delete" data-testid={`line-del-${l.id}`} onClick={() => social.del(l.id)}>🗑</button>}
                    </span>
                  </div>
                  {menu === l.id && (
                    <span className="soc-line-menu">
                      <button type="button" data-testid="line-report" onClick={() => { social.report('global', { id: l.id }); setMenu(null); }}>Report</button>
                      {l.from.startsWith('u:') && <button type="button" data-testid="line-mute" onClick={() => { social.mute(l.from, !isMuted(s, l.from)); setMenu(null); }}>{isMuted(s, l.from) ? `Unmute ${l.name}` : `Mute ${l.name}`}</button>}
                      {l.from.startsWith('u:') && <button type="button" data-testid="line-block" onClick={() => { social.friend('block', l.from); setMenu(null); }}>Block {l.name}</button>}
                      {s.admin && <button type="button" className="danger" data-testid="line-delete" onClick={() => { social.del(l.id); setMenu(null); }}>Delete</button>}
                    </span>
                  )}
                  <ReactionChips reactions={l.reactions} myId={s.you?.id ?? null} onToggle={(e) => { if (signedIn) social.react(l.id, e); }} />
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {press.open && (() => { const l = s.global.find((x) => x.id === press.open!.id); return l ? (
        <MsgPopover rect={press.open.rect} mine={l.from === s.you?.id} quote={{ from: l.name, text: l.text }}
          onReact={(e) => social.react(l.id, e)} onSendReply={(t) => social.chat(t, l.id)}
          onClose={press.close} onBackdrop={press.backdropDown} onEditingChange={setPopEditing} />
      ) : null; })()}
      {signedIn ? <Composer onSend={(t) => social.chat(t)} placeholder="Message everyone…" testid="global" mentionFrom={mentionCandidates} /> : <SignInNote what="post in the global chat" />}
    </div>
  );
}

function nameOf(s: ReturnType<typeof useSocial>, pid: string): string {
  return s.users[pid]?.name ?? s.names[pid] ?? [...(s.friends?.friends ?? []), ...(s.friends?.incoming ?? []), ...(s.friends?.outgoing ?? [])].find((f) => f.id === pid)?.name ?? 'Player';
}

function Messages({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  if (!signedIn) return <SignInNote what="send direct messages" />;
  if (s.dmWith) return <DmThread pid={s.dmWith} />;
  const threads = new Set([...Object.keys(s.dms), ...Object.keys(s.unread).filter((k) => s.unread[k]! > 0), ...(s.friends?.friends ?? []).map((f) => f.id)]);
  const friendIds = new Set((s.friends?.friends ?? []).map((f) => f.id));
  // Confirmed friends first (DMs are friends-only now); legacy threads —
  // history with someone no longer a friend — sit below, dimmed, read-only.
  const rows = [...threads].map((pid) => ({ pid, last: s.dms[pid]?.[s.dms[pid]!.length - 1], unread: s.unread[pid] ?? 0, friend: friendIds.has(pid) }))
    .sort((a, b) => (+b.friend - +a.friend) || (b.unread - a.unread) || ((b.last?.at ?? 0) - (a.last?.at ?? 0)));
  return (
    <ul className="soc-list" data-testid="dm-threads">
      {rows.map((r) => {
        // a div (ProfRow pattern), not a <button>: the face inside is itself a
        // profile-opening button, and buttons can't nest in buttons. Legacy
        // (non-friend) threads render the same row dimmed.
        const inner = (
          <>
            <SocFace id={r.pid} name={nameOf(s, r.pid)} className="soc-av" />
            <span className="soc-pl-txt"><span className="soc-pl-name">{nameOf(s, r.pid)}{s.users[r.pid] && <i className="soc-online" title="Online" />}{!r.friend && <i className="soc-tag">Not friends</i>}{isMuted(s, r.pid) && <i className="soc-tag muted">Muted</i>}</span>
              <span className="soc-pl-status">{r.last ? r.last.text : 'Say hi'}</span></span>
            {r.unread > 0 && <i className="soc-count">{r.unread}</i>}
          </>
        );
        const open = () => social.openDm(r.pid);
        const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
        return (
          <li key={r.pid}>
            {r.friend
              ? <div className="soc-thread" role="button" tabIndex={0} onClick={open} data-testid={`thread-${nameOf(s, r.pid)}`} onKeyDown={onKey}>{inner}</div>
              : <div className="soc-thread legacy" role="button" tabIndex={0} onClick={open} data-testid={`thread-${nameOf(s, r.pid)}`} onKeyDown={onKey}>{inner}</div>}
          </li>
        );
      })}
      {!rows.length && <li className="soc-empty">No conversations yet. Open a player and tap 💬 Chat.</li>}
    </ul>
  );
}

function DmThread({ pid }: { pid: string }) {
  const s = useSocial();
  const lines = s.dms[pid] ?? [];
  const ref = useStickToBottom(lines.length);
  const name = nameOf(s, pid);
  const blocked = (s.friends?.blocked ?? []).some((b) => b.id === pid);
  /** DMs are friends-only: a non-friend thread reads in full but cannot be sent to */
  const isFriend = (s.friends?.friends ?? []).some((f) => f.id === pid);
  const requestPending = (s.friends?.outgoing ?? []).some((f) => f.id === pid);
  const muted = isMuted(s, pid);
  /** long-press / right-click message actions (reaction strip + Reply popover) */
  const press = useMsgPress();
  /** true while the popover's in-place reply editor is open (suspends its dismissal) */
  const popEditingRef = useRef(false);
  const setPopEditing = useCallback((b: boolean) => { popEditingRef.current = b; }, []);
  usePopoverDismiss(press.open, ref, press.close, popEditingRef);
  /** a line briefly highlighted after tapping a quote that points at it */
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  // switching threads closes the popover (it belongs to the other conversation)
  useEffect(() => { press.close(); }, [pid, press.close]);
  /** tap a quote: scroll to the original (when it's rendered) and flash it */
  const jumpTo = (id: number) => {
    const el = ref.current?.querySelector(`[data-line-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setFlashId(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), 1600);
  };
  /** display name for a line in this thread: the other player, or "yourself" for your own lines */
  const authorOf = (l: DmLine) => (l.from === s.you?.id ? 'yourself' : name);
  return (
    <div className="soc-chat">
      <div className="soc-dm-head">
        <button type="button" className="link" onClick={() => social.closeDm()} data-testid="dm-back">← All messages</button>
        <button type="button" className="soc-dm-name" onClick={() => social.showProfile(name, pid)}>
          <SocFace id={pid} name={name} className="soc-av dm-head" tap={false} />
          <span className="soc-dm-who">
            <span className="soc-dm-title">{name}</span>
            <span className={`soc-dm-pres ${s.users[pid] ? 'on' : ''}`}>{s.users[pid] ? <><i className="soc-online" title="Online" />Online</> : 'Offline'}</span>
          </span>
        </button>
        {s.users[pid] && <button type="button" onClick={() => void inviteTo(pid, s.myTable)} data-testid="dm-invite">➕ Invite</button>}
        <button type="button" onClick={() => social.mute(pid, !muted)} data-testid="dm-mute" aria-label={muted ? `Unmute ${name}` : `Mute ${name}`} title={muted ? `Unmute ${name}` : `Mute ${name} (they won't know)`}>{muted ? '🔊' : '🔇'}</button>
      </div>
      <div className="soc-lines" ref={ref} data-testid="dm-lines">
        {lines.map((l, i) => {
          const mine = l.from === s.you?.id;
          const g = chatGroupInfo(lines, i);
          return (
            <Fragment key={l.id}>
              {g.separator && <div className="soc-time-sep">{chatTimeLabel(l.at)}</div>}
              <div data-line-id={l.id} onClickCapture={press.onClickCapture} className={`soc-line dm ${mine ? 'mine' : ''} ${g.groupStart ? 'g-start' : 'cont'}${flashId === l.id ? ' flash' : ''}${press.open?.id === l.id ? ' armed' : ''}`} data-testid="dm-line">
                {!mine && (g.groupEnd
                  ? <SocFace id={pid} name={name} className="soc-av msg" />
                  : <span className="soc-av msg blank" aria-hidden="true" />)}
                <div className="soc-msg-col">
                  <div className="soc-bubble-row">
                    <div className={`soc-bubble ${g.groupEnd ? 'tail' : ''}`} {...press.bind(l.id)}>
                      {l.reply && (
                        <button type="button" className="soc-quote" data-testid={`dm-quote-${l.id}`} onClick={() => jumpTo(l.reply!.id)} aria-label={`Quoted message by ${l.reply.from}: ${l.reply.text}`}>
                          <b>{l.reply.from}</b> {l.reply.text}
                        </button>
                      )}
                      <span className="soc-line-text">{l.text}</span>
                    </div>
                    <span className="soc-line-acts">
                      {!mine && <button type="button" className="soc-more" aria-label="Report message" title="Report" onClick={() => social.report('dm', { id: l.id })}>⚑</button>}
                    </span>
                  </div>
                  <ReactionChips reactions={l.reactions} myId={s.you?.id ?? null} onToggle={(e) => social.dmReact(l.id, e)} />
                </div>
              </div>
            </Fragment>
          );
        })}
        {!lines.length && <p className="soc-empty">Start the conversation with {name}.</p>}
      </div>
      {press.open && (() => { const l = lines.find((x) => x.id === press.open!.id); return l ? (
        <MsgPopover rect={press.open.rect} mine={l.from === s.you?.id} quote={{ from: authorOf(l), text: l.text }}
          onReact={(e) => social.dmReact(l.id, e)} onSendReply={(t) => social.dm(pid, t, l.id)}
          onClose={press.close} onBackdrop={press.backdropDown} onEditingChange={setPopEditing} />
      ) : null; })()}
      {blocked ? <p className="soc-note">You blocked {name}. Unblock them in Friends to message.</p> : !isFriend ? (
        <div className="soc-dm-gate" data-testid="dm-gate">
          <p className="soc-note">{NOT_FRIENDS_TEXT}</p>
          {requestPending
            ? <p className="soc-note">Request sent — you can message once {name} accepts.</p>
            : <button type="button" className="primary" onClick={() => social.friend('request', pid)} data-testid="dm-friend-request">Send friend request</button>}
        </div>
      ) : (
        <Composer onSend={(t) => social.dm(pid, t)} placeholder={`Message ${name}…`} testid="dm" />
      )}
    </div>
  );
}

/**
 * A Friends-tab player row that opens the player's profile on tap (Demetrius 2026-10-19:
 * rows under Sent requests / Recent players etc. weren't tappable). The profile comes from
 * the server DB, so this works whether or not the player is online. Action buttons inside
 * the row must stopPropagation so they don't also open the profile.
 */
function ProfRow({ id, name, testid, lead, actions }: { id: string; name: string; testid: string; lead: ReactNode; actions?: ReactNode }) {
  const open = () => social.showProfile(name, id);
  return (
    <div className="soc-frow tappable" role="button" tabIndex={0} aria-label={`View ${name}'s profile`} data-testid={testid} onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
      <SocFace id={id} name={name} className="soc-av frow" />
      <span className="soc-frow-name">{lead}</span>
      {actions}
    </div>
  );
}

interface Recent { id: string; name: string; games: number; last: number; partner: boolean }

function Friends({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const [recent, setRecent] = useState<Recent[] | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    fetch('/api/social/recent', { credentials: 'same-origin' }).then((r) => r.json()).then((j: { players?: Recent[] }) => setRecent(j.players ?? [])).catch(() => setRecent([]));
  }, [signedIn]);
  if (!signedIn) return <SignInNote what="add friends" />;
  const f = s.friends;
  const online = (pid: string) => !!s.users[pid];
  /** A friend's row presence (live activity → fresh persisted activity →
   *  last online / Offline) is composed by friendPresenceView in
   *  ./presence, from the ref's stamps + this session's remembered
   *  activity (s.lastAt: a friend who logged off mid-session was last
   *  active then, not at the older persisted stamp). */
  const Section = ({ title, children, testid }: { title: string; children: ReactNode; testid: string }) => <section className="soc-sec" data-testid={testid}><h4>{title}</h4>{children}</section>;
  return (
    <div className="soc-friends">
      {!!f?.incoming.length && (
        <Section title="Friend requests" testid="friend-requests">
          {f.incoming.map((r) => (
            <ProfRow key={r.id} id={r.id} name={r.name} testid={`req-${r.name}`} lead={r.name} actions={
              <>
                <button type="button" className="primary" onClick={(e) => { e.stopPropagation(); social.friend('accept', r.id); }} data-testid={`accept-${r.name}`}>Accept</button>
                <button type="button" onClick={(e) => { e.stopPropagation(); social.friend('decline', r.id); }} data-testid={`decline-${r.name}`}>Decline</button>
              </>
            } />
          ))}
        </Section>
      )}
      <Section title={`Friends${f?.friends.length ? ` (${f.friends.length})` : ''}`} testid="friends-list">
        {f?.friends.map((r) => {
          const pv = friendPresenceView(r, s.users[r.id], s.lastAt[r.id] ?? 0, modeName);
          const muted = isMuted(s, r.id);
          return (
            <div key={r.id} className="soc-frow" data-testid={`friend-${r.name}`}>
              <button type="button" className="soc-frow-name link" onClick={() => social.showProfile(r.name, r.id)} data-testid={`friend-name-${r.name}`}>{pv.online && <i className="soc-online" title="Online" />}{r.name}<small>{pv.label}</small>{muted && <i className="soc-tag muted" title="You muted this player (they don't know)">Muted</i>}</button>
              <button type="button" onClick={() => social.openDm(r.id)}>💬</button>
              {online(r.id) && <button type="button" onClick={() => void inviteTo(r.id, s.myTable)} data-testid={`finvite-${r.name}`}>➕</button>}
              <button type="button" onClick={() => social.mute(r.id, !muted)} data-testid={`fmute-${r.name}`} aria-label={muted ? `Unmute ${r.name}` : `Mute ${r.name}`} title={muted ? `Unmute ${r.name}` : `Mute ${r.name} (they won't know)`}>{muted ? '🔊' : '🔇'}</button>
              <button type="button" onClick={() => social.showProfile(r.name, r.id)}>👤</button>
              <button type="button" className="ghost" onClick={() => { if (confirm(`Remove ${r.name} from friends?`)) social.friend('remove', r.id); }} data-testid={`remove-${r.name}`}>Remove</button>
            </div>
          );
        })}
        {!f?.friends.length && <p className="soc-empty">No friends yet: add players from the Players tab or from Recent below.</p>}
      </Section>
      {!!f?.outgoing.length && (
        <Section title="Sent requests" testid="friend-outgoing">
          {f.outgoing.map((r) => (
            <ProfRow key={r.id} id={r.id} name={r.name} testid={`sent-${r.name}`} lead={<>{r.name}<small>waiting</small></>} actions={
              <button type="button" className="ghost" onClick={(e) => { e.stopPropagation(); social.friend('remove', r.id); }} data-testid={`cancel-${r.name}`}>Cancel</button>
            } />
          ))}
        </Section>
      )}
      <Section title="Recent players" testid="recent-players">
        {recent === null ? <p className="soc-empty">Loading…</p> : !recent.length ? <p className="soc-empty">Play an online game while signed in and the people you played with show up here.</p> :
          recent.map((r) => (
            <ProfRow key={r.id} id={r.id} name={r.name} testid={`recent-${r.name}`}
              lead={<>{online(r.id) && <i className="soc-online" />}{r.name}<small>{r.games} game{r.games === 1 ? '' : 's'}{r.partner ? ' · partner' : ''} · {timeAgo(r.last)}</small></>}
              actions={
                <>
                  <button type="button" className="primary" disabled={!online(r.id)} title={online(r.id) ? 'Invite to a table' : 'Offline'} onClick={(e) => { e.stopPropagation(); void inviteTo(r.id, s.myTable); }} data-testid={`again-${r.name}`}>Play again</button>
                  {!f?.friends.some((x) => x.id === r.id) && <button type="button" onClick={(e) => { e.stopPropagation(); social.friend('request', r.id); }}>👋</button>}
                </>
              } />
          ))}
      </Section>
      {!!f?.blocked.length && (
        <Section title="Blocked" testid="blocked-list">
          {f.blocked.map((r) => (
            <ProfRow key={r.id} id={r.id} name={r.name} testid={`blocked-${r.name}`} lead={r.name} actions={
              <button type="button" onClick={(e) => { e.stopPropagation(); social.friend('unblock', r.id); }} data-testid={`unblock-${r.name}`}>Unblock</button>
            } />
          ))}
        </Section>
      )}
      {!!f?.muted.length && (
        <Section title="Muted" testid="muted-list">
          {f.muted.map((r) => (
            <ProfRow key={r.id} id={r.id} name={r.name} testid={`muted-${r.name}`} lead={<>{r.name}<small>they don't know</small></>} actions={
              <button type="button" onClick={(e) => { e.stopPropagation(); social.mute(r.id, false); }} data-testid={`unmute-${r.name}`}>Unmute</button>
            } />
          ))}
        </Section>
      )}
    </div>
  );
}

function SettingsTab({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  if (!signedIn || !s.settings) return <SignInNote what="change your social settings" />;
  const row = (k: 'appearOffline' | 'friendsOnlyInvites' | 'hideLocation', label: string, hint: string) => (
    <label className="row soc-set" key={k}>
      <span className="row-label">{label}<small>{hint}</small></span>
      <span className="row-control">
        <button type="button" className={`toggle ${s.settings![k] ? 'on' : ''}`} role="switch" aria-checked={s.settings![k]} aria-label={label} data-testid={`set-${k}`} onClick={() => social.saveSettings({ [k]: !s.settings![k] })}><span /></button>
      </span>
    </label>
  );
  return (
    <div className="soc-settings">
      {row('appearOffline', 'Appear offline', 'Hidden from the players list; you can still play and chat')}
      {row('friendsOnlyInvites', 'Only friends can invite me', 'Invites from everyone else are blocked')}
      {row('hideLocation', 'Hide my location', 'Leave me off Local leaderboards (region only, never a city)')}
      <p className="soc-note">Blocked players can't see you online, message or invite you, and their global chat is hidden from you. Manage blocks in Friends.</p>
      <p className="soc-note">Muted players are never told: you stay friends, their chat is hidden from you, and their messages and mentions arrive silently (no ding, no badge, no push). Manage mutes in Friends.</p>
    </div>
  );
}
