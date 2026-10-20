/**
 * Release 9 social UI: the Social button (with unread badge), the Social panel (players online, global chat, DMs,
 * friends, profiles, settings), invite toasts and notices. Mounted once at the root so invites reach you anywhere.
 */
import { Fragment, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type InviteMsg, type OpenTable, type PresenceEntry, type PresenceStatus, type SocialChatLine, SOCIAL_LIMITS, statusLabel } from '@spades/protocol';
import { useAccount } from '../account/api';
import { AvatarCircle, socialUidOf, useAvatar } from '../avatar';
import { BADGES } from '../badges';
import { createTable } from '../online/connection';
import { inviteLink, serverUrl } from '../online/config';
import { navigate } from '../online/nav';
import { loadSettings } from '../settings';
import { shownPlayers } from './presence';
import { type PlayerTableAction, playerTableAction } from './tableActions';
import { type MyTable, type SocialTab, type Toast, badgeCount, globalUnread, social, useSocial } from './store';
import { Leaderboards, Tournaments } from './Compete';
import { offlineStats } from '../offlineStats';
import { chatStickToBottom } from '../chatScroll';
import { chatGroupInfo, chatTimeLabel } from './chatTime';
import { ReactionChips, ReactionPicker } from '../reactions';
import { TaglineText } from '../tagline';
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
      <div className={`soc-toasts${s.open ? ' over-panel' : ''}`} aria-live="polite">
        {s.invites.map((inv) => <InviteToast key={inv.id} inv={inv} />)}
        {s.notices.map((n) => (
          <div key={n.id} className="soc-invite soc-notice" data-testid="soc-notice">
            <div className="soc-invite-txt">🏆 {n.text}</div>
            <div className="soc-invite-acts">
              {n.code ? <button type="button" className="primary" data-testid="notice-go" onClick={() => { social.dismissNotice(n.id); social.close(); navigate(`/t/${n.code}${n.seat !== undefined ? `?seat=${n.seat}` : ''}`); }}>Go</button>
                : n.tid ? <button type="button" className="primary" onClick={() => { social.dismissNotice(n.id); social.showTour(n.tid!); }}>View</button> : null}
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
  const accept = () => {
    social.replyInvite(inv, true);
    social.close();
    navigate(`/t/${inv.code}${inv.seat !== undefined ? `?seat=${inv.seat}` : ''}`);
  };
  return (
    <div className="soc-invite glass slant" role="alertdialog" aria-label={`Invite from ${inv.fromName}`} data-testid="invite-toast">
      <div className="soc-invite-txt"><b>{inv.fromName}</b> invited you to {inv.mode ? modeName(inv.mode) : 'a table'}<small>Table {inv.code} · {left}s</small></div>
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
            <button type="button" className={`icon-btn ${s.tab === 'tournaments' || s.tab === 'settings' ? 'on' : ''}`} aria-label="Events and settings" aria-expanded={gear} data-testid="social-gear" onClick={() => setGear(!gear)}>⚙</button>
            {gear && (
              <span className="soc-gear-menu" role="menu">
                <button type="button" role="menuitem" data-testid="soc-tab-tournaments" onClick={() => { social.tab('tournaments'); setGear(false); }}>🏆 Events &amp; tournaments</button>
                <button type="button" role="menuitem" data-testid="soc-tab-settings" onClick={() => { social.tab('settings'); setGear(false); }}>⚙ Social settings</button>
              </span>
            )}
          </span>
          <button type="button" className="sheet-close" aria-label="Close" data-testid="social-close" onClick={() => social.close()}>CLOSE</button>
        </header>
        <nav className="soc-tabs" role="tablist">
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
          {s.profile ? <Profile name={s.profile} id={s.profileId ?? undefined} /> :
            s.tab === 'players' ? <Players signedIn={signedIn} /> :
            s.tab === 'chat' ? <GlobalChat signedIn={signedIn} /> :
            s.tab === 'messages' ? <Messages signedIn={signedIn} /> :
            s.tab === 'friends' ? <Friends signedIn={signedIn} /> :
            s.tab === 'leaders' ? <Leaderboards /> :
            s.tab === 'tournaments' ? <Tournaments signedIn={signedIn} /> :
            <SettingsTab signedIn={signedIn} />}
        </div>
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

/** invite: to the table you're at, or a new table with your current settings */
async function inviteTo(pid: string, mine: MyTable | null) {
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
  const list = shownPlayers(Object.values(s.users), s.tables, Object.keys(s.ended), Date.now())
    .filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.id === s.you?.id ? -1 : b.id === s.you?.id ? 1 : 0) || (+friendIds.has(b.id) - +friendIds.has(a.id)) || (+a.guest - +b.guest) || a.name.localeCompare(b.name));
  return (
    <div className="soc-players">
      <input className="soc-search" type="search" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" data-testid="soc-search" />
      {!signedIn && <SignInNote what="chat, add friends and invite players" />}
      {s.myTable && <p className="soc-mytable">Your table <b>{s.myTable.code}</b> · {s.myTable.open} seat{s.myTable.open === 1 ? '' : 's'} open</p>}
      <ul className="soc-list" data-testid="players-list">
        {list.map((u) => <PlayerRow key={u.id} u={u} me={u.id === s.you?.id} friend={friendIds.has(u.id)} pending={outgoing.has(u.id)} signedIn={signedIn} myTable={s.myTable} tables={s.tables} />)}
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

/** A social face circle: the player's uploaded picture when they have one, else the initial. */
function SocFace({ id, name, className }: { id?: string; name: string; className?: string }) {
  const pic = useAvatar(socialUidOf(id));
  return <AvatarCircle pic={pic} name={name} className={className} />;
}

function PlayerRow({ u, me, friend, pending, signedIn, myTable, tables }: {
  u: PresenceEntry; me: boolean; friend: boolean; pending: boolean; signedIn: boolean; myTable: MyTable | null;
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
            ? <button type="button" className="soc-pl-name link" onClick={() => social.showProfile(u.name, u.id)} data-testid={`pl-name-${u.name}`}>{u.name}{me && <em> (you)</em>}{u.guest && <i className="soc-tag">Guest</i>}{friend && <i className="soc-tag friend" title="Friend">★ Friend</i>}</button>
            : <span className="soc-pl-name">{u.name}{me && <em> (you)</em>}{u.guest && <i className="soc-tag">Guest</i>}{friend && <i className="soc-tag friend" title="Friend">★ Friend</i>}</span>}
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

function Composer({ onSend, placeholder, disabled, testid }: { onSend: (t: string) => void; placeholder: string; disabled?: boolean; testid: string }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const t = text.trim(); if (!t) return; onSend(t); setText(''); };
  return (
    <form className="soc-compose" onSubmit={submit}>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={SOCIAL_LIMITS.chatMax} placeholder={placeholder} disabled={disabled} aria-label={placeholder} data-testid={`${testid}-input`} />
      <button type="submit" className="primary" disabled={disabled || !text.trim()} data-testid={`${testid}-send`}>Send</button>
    </form>
  );
}

function GlobalChat({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const ref = useStickToBottom(s.global.length);
  const [menu, setMenu] = useState<number | null>(null);
  /** which line's emoji picker is open (one at a time) */
  const [pickFor, setPickFor] = useState<number | null>(null);
  /** the line the composer is replying to (its snapshot ships with the sent message) */
  const [replyTo, setReplyTo] = useState<SocialChatLine | null>(null);
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
  return (
    <div className="soc-chat">
      <div className="soc-lines" ref={ref} data-testid="global-lines">
        {!s.global.length && <p className="soc-empty">No messages yet. Say hi 👋</p>}
        {s.global.map((l, i) => {
          const mine = l.from === s.you?.id;
          const g = chatGroupInfo(s.global, i);
          return (
            <Fragment key={l.id}>
              {g.separator && <div className="soc-time-sep">{chatTimeLabel(l.at)}</div>}
              <div data-line-id={l.id} className={`soc-line ${mine ? 'mine' : ''} ${g.groupStart ? 'g-start' : 'cont'}${flashId === l.id ? ' flash' : ''}`} data-testid="global-line">
                {!mine && (g.groupEnd
                  ? <SocFace id={l.from} name={l.name} className={`soc-av msg ${l.from.startsWith('g:') ? 'guest' : ''}`} />
                  : <span className="soc-av msg blank" aria-hidden="true" />)}
                <div className="soc-msg-col">
                  {!mine && g.groupStart && (
                    <button type="button" className="soc-line-name" onClick={() => !l.from.startsWith('g:') && social.showProfile(l.name, l.from.startsWith('u:') ? l.from.slice(2) : undefined)}>{l.name}{l.admin && <i className="soc-tag mod">MOD</i>}</button>
                  )}
                  <div className="soc-bubble-row">
                    <div className={`soc-bubble ${g.groupEnd ? 'tail' : ''}`}>
                      {l.reply && (
                        <button type="button" className="soc-quote" data-testid={`quote-${l.id}`} onClick={() => jumpTo(l.reply!.id)} aria-label={`Quoted message by ${l.reply.from}: ${l.reply.text}`}>
                          <b>{l.reply.from}</b> {l.reply.text}
                        </button>
                      )}
                      <span className="soc-line-text">{l.text}</span>
                    </div>
                    <span className="soc-line-acts">
                      {!mine && (signedIn || s.admin) && <button type="button" className="soc-more" aria-label="Message actions" data-testid={`line-more-${l.id}`} onClick={() => setMenu(menu === l.id ? null : l.id)}>⋯</button>}
                      {s.admin && mine && <button type="button" className="soc-more" aria-label="Delete" data-testid={`line-del-${l.id}`} onClick={() => social.del(l.id)}>🗑</button>}
                      {signedIn && <button type="button" className="soc-reply-add" aria-label={`Reply to ${l.name}'s message`} data-testid={`soc-reply-${l.id}`} onClick={() => setReplyTo(replyTo?.id === l.id ? null : l)}>↩</button>}
                      {signedIn && <button type="button" className="soc-rx-add" aria-label={`React to ${l.name}'s message`} aria-expanded={pickFor === l.id} data-testid={`soc-rx-add-${l.id}`} onClick={() => setPickFor(pickFor === l.id ? null : l.id)}>☺</button>}
                    </span>
                  </div>
                  {menu === l.id && (
                    <span className="soc-line-menu">
                      <button type="button" data-testid="line-report" onClick={() => { social.report('global', { id: l.id }); setMenu(null); }}>Report</button>
                      {l.from.startsWith('u:') && <button type="button" data-testid="line-block" onClick={() => { social.friend('block', l.from); setMenu(null); }}>Block {l.name}</button>}
                      {s.admin && <button type="button" className="danger" data-testid="line-delete" onClick={() => { social.del(l.id); setMenu(null); }}>Delete</button>}
                    </span>
                  )}
                  {pickFor === l.id && <ReactionPicker onPick={(e) => { social.react(l.id, e); setPickFor(null); }} />}
                  <ReactionChips reactions={l.reactions} myId={s.you?.id ?? null} onToggle={(e) => { if (signedIn) social.react(l.id, e); }} />
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {signedIn && replyTo && (
        <div className="soc-replybar" data-testid="reply-bar">
          <span className="soc-replybar-txt">Replying to <b>{replyTo.name}</b>: {replyTo.text}</span>
          <button type="button" className="soc-replybar-x" aria-label="Cancel reply" data-testid="reply-cancel" onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}
      {signedIn ? <Composer onSend={(t) => { social.chat(t, replyTo?.id); setReplyTo(null); }} placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Message everyone…'} testid="global" /> : <SignInNote what="post in the global chat" />}
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
  const rows = [...threads].map((pid) => ({ pid, last: s.dms[pid]?.[s.dms[pid]!.length - 1], unread: s.unread[pid] ?? 0 }))
    .sort((a, b) => (b.unread - a.unread) || ((b.last?.at ?? 0) - (a.last?.at ?? 0)));
  return (
    <ul className="soc-list" data-testid="dm-threads">
      {rows.map((r) => (
        <li key={r.pid}>
          <button type="button" className="soc-thread" onClick={() => social.openDm(r.pid)} data-testid={`thread-${nameOf(s, r.pid)}`}>
            <SocFace id={r.pid} name={nameOf(s, r.pid)} className="soc-av" />
            <span className="soc-pl-txt"><span className="soc-pl-name">{nameOf(s, r.pid)}{s.users[r.pid] && <i className="soc-online" title="Online" />}</span>
              <span className="soc-pl-status">{r.last ? r.last.text : 'Say hi'}</span></span>
            {r.unread > 0 && <i className="soc-count">{r.unread}</i>}
          </button>
        </li>
      ))}
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
  /** which line's emoji picker is open (one at a time) */
  const [pickFor, setPickFor] = useState<number | null>(null);
  return (
    <div className="soc-chat">
      <div className="soc-dm-head">
        <button type="button" className="link" onClick={() => social.closeDm()} data-testid="dm-back">← All messages</button>
        <button type="button" className="soc-dm-name" onClick={() => social.showProfile(name, pid)}>
          <SocFace id={pid} name={name} className="soc-av dm-head" />
          <span className="soc-dm-who">
            <span className="soc-dm-title">{name}</span>
            <span className={`soc-dm-pres ${s.users[pid] ? 'on' : ''}`}>{s.users[pid] ? <><i className="soc-online" title="Online" />Online</> : 'Offline'}</span>
          </span>
        </button>
        {s.users[pid] && <button type="button" onClick={() => void inviteTo(pid, s.myTable)} data-testid="dm-invite">➕ Invite</button>}
      </div>
      <div className="soc-lines" ref={ref} data-testid="dm-lines">
        {lines.map((l, i) => {
          const mine = l.from === s.you?.id;
          const g = chatGroupInfo(lines, i);
          return (
            <Fragment key={l.id}>
              {g.separator && <div className="soc-time-sep">{chatTimeLabel(l.at)}</div>}
              <div className={`soc-line dm ${mine ? 'mine' : ''} ${g.groupStart ? 'g-start' : 'cont'}`} data-testid="dm-line">
                {!mine && (g.groupEnd
                  ? <SocFace id={pid} name={name} className="soc-av msg" />
                  : <span className="soc-av msg blank" aria-hidden="true" />)}
                <div className="soc-msg-col">
                  <div className="soc-bubble-row">
                    <div className={`soc-bubble ${g.groupEnd ? 'tail' : ''}`}>
                      <span className="soc-line-text">{l.text}</span>
                    </div>
                    <span className="soc-line-acts">
                      {!mine && <button type="button" className="soc-more" aria-label="Report message" title="Report" onClick={() => social.report('dm', { id: l.id })}>⚑</button>}
                      <button type="button" className="soc-rx-add" aria-label={mine ? 'React to your message' : `React to ${name}'s message`} aria-expanded={pickFor === l.id} data-testid={`dm-rx-add-${l.id}`} onClick={() => setPickFor(pickFor === l.id ? null : l.id)}>☺</button>
                    </span>
                  </div>
                  {pickFor === l.id && <ReactionPicker onPick={(e) => { social.dmReact(l.id, e); setPickFor(null); }} />}
                  <ReactionChips reactions={l.reactions} myId={s.you?.id ?? null} onToggle={(e) => social.dmReact(l.id, e)} />
                </div>
              </div>
            </Fragment>
          );
        })}
        {!lines.length && <p className="soc-empty">Start the conversation with {name}.</p>}
      </div>
      {blocked ? <p className="soc-note">You blocked {name}. Unblock them in Friends to message.</p> : <Composer onSend={(t) => social.dm(pid, t)} placeholder={`Message ${name}…`} testid="dm" />}
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
        {f?.friends.map((r) => (
          <div key={r.id} className="soc-frow" data-testid={`friend-${r.name}`}>
            <button type="button" className="soc-frow-name link" onClick={() => social.showProfile(r.name, r.id)} data-testid={`friend-name-${r.name}`}>{online(r.id) && <i className="soc-online" title="Online" />}{r.name}<small>{online(r.id) ? statusLabel(s.users[r.id]!.status, modeName) : 'Offline'}</small></button>
            <button type="button" onClick={() => social.openDm(r.id)}>💬</button>
            {online(r.id) && <button type="button" onClick={() => void inviteTo(r.id, s.myTable)} data-testid={`finvite-${r.name}`}>➕</button>}
            <button type="button" onClick={() => social.showProfile(r.name, r.id)}>👤</button>
            <button type="button" className="ghost" onClick={() => { if (confirm(`Remove ${r.name} from friends?`)) social.friend('remove', r.id); }} data-testid={`remove-${r.name}`}>Remove</button>
          </div>
        ))}
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
    </div>
  );
}

interface ProfileData {
  username: string; memberSince: number; tagline?: string | null; badges: { id: string; earnedAt: number }[]; teamNames: string[];
  ratings: { team?: number; cutthroat?: number }; totals: { games: number; wins: number };
  h2h: { id: string; name: string; games: number; wins: number; losses: number }[]; vsYou?: { games: number; wins: number; losses: number }; champion: number;
  stats?: { games: number; wins: number; streak: number; bestStreak: number; accuracy: number | null; booksPerHand: number | null; nil: string; shotsGiven: number; shotsTaken: number; wheels: number; bjWins: number; bidSec: number | null; playSec: number | null };
  awards?: { label: string; ref: string; at: number }[];
}

interface CredPublic {
  user: { id: string; name: string; avatar: string | null; tagline?: string | null };
  level: { level: number; xp: number; xpForNext: number; xpIntoLevel: number; title: string };
  rank: { team: { division: string; elo: number }; cutthroat: { division: string; elo: number } };
  achievements: { id: string; title: string; hint: string; xp: number; coins: number; unlockedAt: number | null }[];
}
const DIV_LABEL: Record<string, string> = { stoop: 'Stoop', corner: 'Corner', block: 'Block', avenue: 'Avenue', boulevard: 'Boulevard', legend: 'Legend' };
const divLabel = (d: string) => DIV_LABEL[d] ?? d;

function Profile({ name, id }: { name: string; id?: string }) {
  const s = useSocial();
  const acct = useAccount();
  const [p, setP] = useState<ProfileData | null | 'missing'>(null);
  const [cred, setCred] = useState<CredPublic | null>(null);
  useEffect(() => {
    setP(null);
    fetch(`/api/social/profile/${encodeURIComponent(name)}`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : 'missing')).then(setP).catch(() => setP('missing'));
  }, [name]);
  const pid = id ?? (p && p !== 'missing'
    ? Object.values(s.users).find((u) => !u.guest && u.name === p.username)?.id
      ?? [...(s.friends?.friends ?? []), ...(s.friends?.incoming ?? []), ...(s.friends?.outgoing ?? []), ...(s.friends?.blocked ?? [])].find((f) => f.name === p.username)?.id
    : undefined);
  // Rep data (level/title, season divisions, unlocked achievements) comes straight from the
  // server DB via /api/profile/:id — no presence involved, so offline players show it too.
  useEffect(() => {
    setCred(null);
    if (!pid) return;
    fetch(`/api/profile/${encodeURIComponent(pid)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => setCred(j as CredPublic)).catch(() => setCred(null));
  }, [pid]);
  const me = acct.user?.username === name;
  const friend = !!pid && (s.friends?.friends ?? []).some((f) => f.id === pid);
  const blocked = !!pid && (s.friends?.blocked ?? []).some((f) => f.id === pid);
  return (
    <div className="soc-profile" data-testid="profile">
      <button type="button" className="link" onClick={() => social.showProfile(null)} data-testid="profile-back">← Back</button>
      {p === null ? <p className="soc-empty">Loading…</p> : p === 'missing' ? <p className="soc-empty">No profile for {name}.</p> : (
        <>
          <div className="soc-prof-head">
            <AvatarCircle pic={cred?.user.avatar} name={p.username} className="soc-av big" />
            <div>
              <h3 data-testid="profile-name">{p.username}{p.champion > 0 && <span className="soc-champ" title="Tournament champion">🏆×{p.champion}</span>}</h3>
              <p className="soc-muted">Member since {new Date(p.memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
              <TaglineText text={p.tagline ?? cred?.user.tagline} className="soc-tagline" />
              <p className={`soc-online-status ${s.users[pid ?? ''] ? 'on' : 'off'}`} data-testid="profile-online">
                <i className="soc-dot" aria-hidden />{s.users[pid ?? ''] ? `Online — ${statusLabel(s.users[pid ?? '']!.status, modeName)}` : 'Offline'}
              </p>
            </div>
          </div>
          <div className="soc-stats">
            <div><b>{p.totals.games}</b><small>online games</small></div>
            <div><b>{p.totals.games ? Math.round((p.totals.wins / p.totals.games) * 100) : 0}%</b><small>wins</small></div>
            <div><b>{p.ratings.team ?? '—'}</b><small>2v2 rating</small></div>
            <div><b>{p.ratings.cutthroat ?? '—'}</b><small>Cutthroat</small></div>
          </div>
          {cred && (
            <div data-testid="profile-rep">
              <h4>Rep</h4>
              <div className="soc-rep">
                <div className="soc-rep-level"><b>Level {cred.level.level}</b><span>{cred.level.title}</span></div>
                <div className="soc-rep-ranks">
                  <span className="soc-div-chip" title="Partnership season division">⚔ {divLabel(cred.rank.team.division)} · {cred.rank.team.elo}</span>
                  <span className="soc-div-chip" title="Cutthroat season division">🔪 {divLabel(cred.rank.cutthroat.division)} · {cred.rank.cutthroat.elo}</span>
                </div>
              </div>
              {cred.achievements.some((a) => a.unlockedAt) && (
                <>
                  <h4>Achievements</h4>
                  <div className="soc-badges">{cred.achievements.filter((a) => a.unlockedAt).map((a) => <span key={a.id} className="soc-badge-chip" title={`+${a.xp} XP${a.coins ? ` · +${a.coins} coins` : ''}`}>🏅 {a.title}</span>)}</div>
                </>
              )}
            </div>
          )}
          {p.vsYou && <p className="soc-vs" data-testid="profile-vs">You vs {p.username}: <b>{p.vsYou.wins}–{p.vsYou.losses}</b> in {p.vsYou.games} game{p.vsYou.games === 1 ? '' : 's'}</p>}
          {!me && pid && (
            <div className="soc-prof-acts">
              {!blocked && <button type="button" onClick={() => social.openDm(pid)}>💬 Chat</button>}
              {!blocked && s.users[pid] && <button type="button" onClick={() => void inviteTo(pid, s.myTable)}>➕ Invite</button>}
              {!friend && !blocked && <button type="button" onClick={() => social.friend('request', pid)} data-testid="profile-add">👋 Add friend</button>}
              {blocked ? <button type="button" onClick={() => social.friend('unblock', pid)}>Unblock</button> : <button type="button" className="ghost" onClick={() => { if (confirm(`Block ${p.username}? They won't see you online, can't message or invite you, and their chat is hidden.`)) social.friend('block', pid); }} data-testid="profile-block">Block</button>}
              <button type="button" className="ghost" onClick={() => social.report('user', { user: pid })}>Report</button>
            </div>
          )}
          {p.awards && p.awards.length > 0 && <><h4>Champion</h4><div className="soc-badges" data-testid="profile-awards">{p.awards.map((a) => <button type="button" key={a.ref} className="soc-badge-chip champ" onClick={() => social.showTour(a.ref)}>🏆 {a.label}</button>)}</div></>}
          {p.stats && p.stats.games > 0 && (
            <>
              <h4>Stats</h4>
              <div className="soc-stats small" data-testid="profile-stats">
                <div><b>{p.stats.streak}</b><small>win streak (best {p.stats.bestStreak})</small></div>
                <div><b>{p.stats.accuracy ?? '—'}{p.stats.accuracy !== null ? '%' : ''}</b><small>bid accuracy</small></div>
                <div><b>{p.stats.booksPerHand ?? '—'}</b><small>books / hand</small></div>
                <div><b>{p.stats.nil}</b><small>nils made</small></div>
                <div><b>{p.stats.shotsGiven}</b><small>shots given</small></div>
                <div><b>{p.stats.shotsTaken}</b><small>shot</small></div>
                <div><b>{p.stats.wheels}</b><small>Wheels</small></div>
                <div><b>{p.stats.bjWins}</b><small>Big Joker wins</small></div>
                <div><b>{p.stats.bidSec ?? '—'}s</b><small>avg bid</small></div>
                <div><b>{p.stats.playSec ?? '—'}s</b><small>avg play</small></div>
              </div>
            </>
          )}
          {me && (() => { const o = offlineStats(); return o.games > 0 ? <p className="soc-muted" data-testid="profile-offline">On this device vs bots: {o.wins}/{o.games} wins · streak {o.streak} (best {o.bestStreak})</p> : null; })()}
          <h4>Badges</h4>
          <div className="soc-badges">{p.badges.length ? p.badges.map((b) => <span key={b.id} className="soc-badge-chip" title={BADGES[b.id]?.desc}>{BADGES[b.id]?.icon ?? '🏅'} {BADGES[b.id]?.name ?? b.id}</span>) : <span className="soc-muted">None yet</span>}</div>
          <h4>Team names</h4>
          <div className="soc-badges">{p.teamNames.length ? p.teamNames.map((t) => <span key={t} className="soc-badge-chip">{t}</span>) : <span className="soc-muted">None yet</span>}</div>
          <h4>Head-to-head</h4>
          {p.h2h.length ? (
            <table className="soc-h2h" data-testid="profile-h2h"><tbody>
              {p.h2h.map((r) => <tr key={r.id}><td><button type="button" className="link" onClick={() => social.showProfile(r.name, r.id)}>{r.name}</button></td><td>{r.wins}–{r.losses}</td><td className="soc-muted">{r.games} game{r.games === 1 ? '' : 's'}</td></tr>)}
            </tbody></table>
          ) : <p className="soc-muted">No series against signed-in players yet.</p>}
        </>
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
    </div>
  );
}
