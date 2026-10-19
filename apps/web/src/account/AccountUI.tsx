/**
 * Sign in sheet (brand-style provider buttons, passkeys, "keep playing as guest"), username picker on first sign-in,
 * Account screen (username, linked logins, link / unlink, passkeys, Save my progress, sign out, delete account).
 * Mounted on the start screens; guests see a small "Sign in" chip and nothing else changes.
 */
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useEscapeClose } from '../useEscapeClose';
import './account.css';
import {
  type AccountUser, type ProviderId, PROVIDER_LABEL, PROVIDER_ORDER, account, checkUsername, deleteAccount, hasLocalProgress, loadAccount,
  localProgress, passkeyRegister, passkeySignIn, saveProgress, setUsername, signOut, startOAuth, takePendingOpen, unlink, useAccount,
} from './api';
import {
  NOTIF_TYPES, disablePush, enablePush, hasSubscription, loadPrefs, permissionState, pushSupported, savePref, sendTestPush,
  type NotifType, type PermState,
} from '../push/push';

type Sheet = null | 'signin' | 'account' | 'username' | 'passkey-new' | 'delete' | 'security';

export function ProviderIcon({ p }: { p: ProviderId | 'passkey' }) {
  switch (p) {
    case 'google': return (
      <svg viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
    );
    case 'discord': return <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>;
    case 'x': return <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
    case 'facebook': return <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>;
    case 'passkey': return <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12.65 10A6 6 0 1 0 12.65 14H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>;
    default: return <span aria-hidden>🧪</span>;
  }
}

function SheetFrame({ title, label, onClose, children, testId }: { title: string; label: string; onClose?: () => void; children: ReactNode; testId: string }) {
  const esc = useEscapeClose(() => onClose?.());
  return (
    <div className="modal-backdrop sheet-backdrop acct-backdrop" ref={onClose ? esc : undefined} onClick={onClose}>
      <div className="sheet glass slant acct-sheet" role="dialog" aria-label={label} data-testid={testId} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <span className="panel-title">{title}</span>
          {onClose && <button type="button" className="sheet-close" aria-label="Close" data-testid="acct-close" onClick={onClose}>CLOSE</button>}
        </header>
        <div className="scroll sheet-body acct-body">{children}</div>
      </div>
    </div>
  );
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/* ------------------------------------------------------------------ sign in */
function SignInSheet({ onClose, onPasskeyNew }: { onClose: () => void; onPasskeyNew: () => void }) {
  const a = useAccount();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const providers = PROVIDER_ORDER.filter((p) => a.providers.includes(p));
  const passkey = async () => {
    setBusy(true); setErr('');
    const e = await passkeySignIn();
    setBusy(false);
    if (e) setErr(e); else onClose();
  };
  return (
    <SheetFrame title="SIGN IN" label="Sign in" onClose={onClose} testId="signin-sheet">
      <p className="acct-lede">Keep your badges, series and name on every device. Optional: guests can play everything.</p>
      <div className="acct-providers">
        {providers.map((p) => (
          <button key={p} type="button" className={`brand-btn brand-${p}`} data-testid={`signin-${p}`} disabled={busy} onClick={() => startOAuth(p, 'login')}>
            <ProviderIcon p={p} /><span>Continue with {PROVIDER_LABEL[p]}</span>
          </button>
        ))}
      </div>
      {a.passkeys && (
        <>
          {providers.length > 0 && <div className="acct-or"><span>or use a passkey</span></div>}
          <div className="acct-providers">
            <button type="button" className="brand-btn brand-passkey" data-testid="signin-passkey" disabled={busy} onClick={passkey}>
              <ProviderIcon p="passkey" /><span>Sign in with a passkey</span>
            </button>
            <button type="button" className="brand-btn brand-passkey ghost" data-testid="create-passkey" disabled={busy} onClick={onPasskeyNew}>
              <span className="pk-plus" aria-hidden>＋</span><span>Create an account with a passkey</span>
            </button>
          </div>
          <p className="acct-fine">Passkeys use Face ID, Touch ID, your fingerprint or your phone's screen lock. No password.</p>
        </>
      )}
      {!providers.length && !a.passkeys && <p className="acct-fine">Sign-in isn't available right now.</p>}
      {err && <p className="err acct-err" role="alert">{err}</p>}
      <button type="button" className="acct-guest" data-testid="keep-guest" onClick={onClose}>Keep playing as guest</button>
      <p className="acct-fine">By signing in you agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
    </SheetFrame>
  );
}

/* ------------------------------------------------------------------ username */
function UsernamePicker({ mode, initial, onDone, onClose }: { mode: 'first' | 'change' | 'passkey-new'; initial: string; onDone: () => void; onClose?: () => void }) {
  const [u, setU] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const v = u.trim();
    if (!v) { setMsg(null); return; }
    const n = ++seq.current;
    const t = window.setTimeout(async () => {
      const r = await checkUsername(v);
      if (n === seq.current) setMsg(r.ok ? { ok: true, text: `${v} is available` } : { ok: false, text: r.reason ?? 'Not available' });
    }, 300);
    return () => window.clearTimeout(t);
  }, [u]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = mode === 'passkey-new' ? await passkeyRegister(u.trim()) : await setUsername(u.trim());
    setBusy(false);
    if (err) setMsg({ ok: false, text: err }); else onDone();
  };
  const title = mode === 'change' ? 'CHANGE USERNAME' : 'PICK A USERNAME';
  return (
    <SheetFrame title={title} label="Pick a username" onClose={onClose} testId="username-sheet">
      <form className="acct-username" onSubmit={submit}>
        <p className="acct-lede">{mode === 'passkey-new' ? 'Pick your name first, then your device will make a passkey for it.' : "This is how you'll show up at the table."}</p>
        <input data-testid="username-input" value={u} onChange={(e) => setU(e.target.value)} maxLength={16} autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Username" aria-label="Username" />
        <p className={`acct-check ${msg ? (msg.ok ? 'ok' : 'bad') : ''}`} data-testid="username-msg" aria-live="polite">{msg?.text ?? '3–16 letters, numbers or _'}</p>
        <button type="submit" className="primary big" data-testid="username-save" disabled={busy || !msg?.ok}>
          {mode === 'passkey-new' ? 'Create passkey' : 'Save'}
        </button>
        {mode === 'first' && onClose && <button type="button" className="acct-guest" onClick={onClose}>Later</button>}
      </form>
    </SheetFrame>
  );
}

/* ------------------------------------------------------------------ account */
function SecurityScreen({ user, onBack }: { user: AccountUser; onBack: () => void }) {
  const a = useAccount();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const methods = user.identities.length + user.passkeys.length;
  const linkable = PROVIDER_ORDER.filter((p) => a.providers.includes(p) && (p === 'mock' || !user.identities.some((i) => i.provider === p))); // (the test-only mock provider can link twice)
  const run = async (f: () => Promise<string | null>) => { setBusy(true); setErr(''); const e = await f(); setBusy(false); if (e) setErr(e); };
  return (
    <SheetFrame title="SIGN-IN & SECURITY" label="Sign-in and security" onClose={onBack} testId="security-sheet">
      <p className="acct-lede">Passkeys and linked logins for this account.</p>
      <ul className="acct-list" data-testid="linked-logins">
        {user.identities.map((i) => (
          <li key={`${i.provider}-${i.linkedAt}-${i.name}`} data-testid={`linked-${i.provider}`}>
            <span className={`acct-li-icon brand-${i.provider}`}><ProviderIcon p={i.provider as ProviderId} /></span>
            <span className="acct-li-text"><b>{PROVIDER_LABEL[i.provider as ProviderId] ?? i.provider}</b><small>{i.name ?? ''}</small></span>
            <button type="button" className="acct-small" disabled={busy || methods <= 1} title={methods <= 1 ? 'Your only sign-in method' : undefined} data-testid={`unlink-${i.provider}`} onClick={() => run(() => unlink({ provider: i.provider }))}>Unlink</button>
          </li>
        ))}
        {user.passkeys.map((k, n) => (
          <li key={k.id} data-testid="linked-passkey">
            <span className="acct-li-icon brand-passkey"><ProviderIcon p="passkey" /></span>
            <span className="acct-li-text"><b>Passkey{user.passkeys.length > 1 ? ` ${n + 1}` : ''}</b><small>added {fmtDate(k.createdAt)}{k.synced ? ' · synced' : ''}</small></span>
            <button type="button" className="acct-small" disabled={busy || methods <= 1} data-testid="remove-passkey" onClick={() => run(() => unlink({ passkey: k.id }))}>Remove</button>
          </li>
        ))}
      </ul>
      {(linkable.length > 0 || a.passkeys) && (
        <div className="acct-link-row">
          {linkable.map((p) => (
            <button key={p} type="button" className={`brand-btn small brand-${p}`} data-testid={`link-${p}`} disabled={busy} onClick={() => startOAuth(p, 'link')}>
              <ProviderIcon p={p} /><span>Link {PROVIDER_LABEL[p]}</span>
            </button>
          ))}
          {a.passkeys && (
            <button type="button" className="brand-btn small brand-passkey" data-testid="add-passkey" disabled={busy} onClick={() => run(() => passkeyRegister())}>
              <ProviderIcon p="passkey" /><span>Add a passkey</span>
            </button>
          )}
        </div>
      )}
      {err && <p className="err acct-err" role="alert">{err}</p>}
    </SheetFrame>
  );
}

function AccountScreen({ user, onClose, onChangeName, onDelete, onSecurity }: { user: AccountUser; onClose: () => void; onChangeName: () => void; onDelete: () => void; onSecurity: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const methods = user.identities.length + user.passkeys.length;
  const run = async (f: () => Promise<string | null>) => { setBusy(true); setErr(''); const e = await f(); setBusy(false); if (e) setErr(e); };
  const local = localProgress();
  const localBits = [local.badges.length ? `${local.badges.length} badge${local.badges.length > 1 ? 's' : ''}` : '', local.series ? 'your rematch series' : '', local.teamName ? `team name "${local.teamName}"` : ''].filter(Boolean);
  return (
    <SheetFrame title="ACCOUNT" label="Account" onClose={onClose} testId="account-sheet">
      <div className="acct-name-row">
        <span className="acct-avatar" aria-hidden>{(user.username ?? '?').charAt(0).toUpperCase()}</span>
        <span className="acct-name" data-testid="account-username">{user.username ?? 'No username yet'}</span>
        <button type="button" className="acct-small" data-testid="change-username" onClick={onChangeName}>{user.username ? 'Change' : 'Pick'}</button>
      </div>
      <p className="acct-fine">Member since {fmtDate(user.createdAt)}</p>
      <button type="button" className="hero-btn purple" data-testid="open-profile" onClick={() => { onClose(); location.href = '/profile'; }}><b>REP PROFILE</b><small>rank · challenges · stats · achievements</small></button>
      <button type="button" className="acct-row-btn" data-testid="open-security" onClick={onSecurity}>
        <span className="acct-row-text"><b>Sign-in &amp; security</b><small>{methods} method{methods === 1 ? '' : 's'} · passkeys, linked logins</small></span>
        <span className="acct-row-chev" aria-hidden>›</span>
      </button>

      <NotificationsSection />

      <h3 className="sheet-h">Progress</h3>
      {user.progressImported ? (
        <p className="acct-fine" data-testid="progress-saved">✓ Progress from this device is saved to your account.</p>
      ) : (
        <div className="acct-progress">
          <p className="acct-fine">{localBits.length ? `On this device: ${localBits.join(', ')}.` : 'No badges or series on this device yet.'} You can do this once.</p>
          <button type="button" className="primary" data-testid="save-progress" disabled={busy || !hasLocalProgress()} onClick={() => run(saveProgress)}>Save my progress</button>
        </div>
      )}

      {err && <p className="err acct-err" role="alert">{err}</p>}
      <div className="acct-foot">
        <button type="button" className="acct-guest" data-testid="sign-out" disabled={busy} onClick={() => run(async () => { await signOut(); onClose(); return null; })}>Sign out</button>
        <button type="button" className="acct-danger" data-testid="delete-account" disabled={busy} onClick={onDelete}>Delete account</button>
      </div>
      <p className="acct-fine"><a href="/privacy" target="_blank" rel="noreferrer">Privacy</a> · <a href="/terms" target="_blank" rel="noreferrer">Terms</a> · <a href="/data-deletion" target="_blank" rel="noreferrer">Data deletion</a></p>
    </SheetFrame>
  );
}

function DeleteConfirm({ user, onClose, onDeleted }: { user: AccountUser; onClose: () => void; onDeleted: () => void }) {
  const word = user.username ?? 'DELETE';
  const [t, setT] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <SheetFrame title="DELETE ACCOUNT" label="Delete account" onClose={onClose} testId="delete-sheet">
      <p className="acct-lede">This permanently deletes your account, every linked sign-in, your passkeys and saved progress. It can't be undone. Badges on this device stay here.</p>
      <p className="acct-fine">Type <b>{word}</b> to confirm.</p>
      <input data-testid="delete-confirm-input" value={t} onChange={(e) => setT(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Confirm" />
      {err && <p className="err acct-err" role="alert">{err}</p>}
      <button type="button" className="acct-danger big" data-testid="delete-confirm" disabled={busy || t.trim() !== word} onClick={async () => { setBusy(true); const e = await deleteAccount(); setBusy(false); if (e) setErr(e); else onDeleted(); }}>Delete forever</button>
      <button type="button" className="acct-guest" onClick={onClose}>Cancel</button>
    </SheetFrame>
  );
}

/* ------------------------------------------------------- notifications */
/* ------------------------------------------------------- notifications */
function NotificationsSection() {
  const [perm, setPerm] = useState<PermState>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<Record<NotifType, boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (pushSupported()) {
      permissionState().then(setPerm);
      hasSubscription().then(setSubscribed);
    } else {
      setPerm('unsupported');
    }
  }, []);
  useEffect(() => {
    if (perm === 'granted' && subscribed) loadPrefs().then(setPrefs).catch(() => setPrefs(null));
    else setPrefs(null);
  }, [perm, subscribed]);

  if (perm === 'unsupported') return null;
  const refresh = async () => {
    setPerm(await permissionState());
    setSubscribed(await hasSubscription());
  };
  const onEnable = async () => {
    setBusy(true); setMsg('');
    const err = await enablePush();
    setBusy(false);
    if (err) setMsg(err);
    await refresh();
  };
  const onDisable = async () => {
    setBusy(true); setMsg('');
    await disablePush();
    setBusy(false);
    setPrefs(null);
    await refresh();
    setMsg('Notifications turned off on this device.');
  };
  const toggle = async (t: NotifType, v: boolean) => {
    setPrefs((p) => (p ? { ...p, [t]: v } : p));
    try { await savePref(t, v); } catch { setMsg('Could not save that preference.'); }
  };
  const onTest = async () => {
    setBusy(true); setMsg('');
    const err = await sendTestPush();
    setBusy(false);
    setMsg(err ?? 'Test sent — check your notifications.');
  };

  const isOn = perm === 'granted' && subscribed;
  return (
    <div className="acct-dropdown" data-testid="push-dropdown">
      <button
        type="button"
        className={`acct-dropdown-head${open ? ' open' : ''}`}
        data-testid="push-dropdown-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="acct-dropdown-title">Notifications</span>
        <span className="acct-dropdown-state">{isOn ? 'On' : 'Off'}</span>
        <span className="acct-dropdown-chev" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="acct-dropdown-body">
          {!isOn ? (
            <div className="acct-progress">
              <p className="acct-fine">
                Get a ping when it&rsquo;s your turn, when friends invite you, and for rank ups and rewards —
                even with the app closed.
              </p>
              <p className="acct-fine"><b>On iPhone:</b> add Bid Wit Me to your Home Screen first (Safari → Share → Add to Home Screen, iOS 16.4+), then launch the app from the Home Screen icon and enable here. Push will not work from inside Safari.</p>
              <button type="button" className="primary" data-testid="push-enable" disabled={busy} onClick={onEnable}>
                Enable notifications
              </button>
              {perm === 'denied' && <p className="acct-fine">Notifications are blocked for this site — allow them in your browser settings, then come back.</p>}
            </div>
          ) : (
            <div className="acct-notifs" data-testid="push-prefs">
              {NOTIF_TYPES.map(({ type, label, hint }) => (
                <button
                  key={type}
                  type="button"
                  role="switch"
                  aria-checked={prefs?.[type] ?? true}
                  data-testid={`push-pref-${type}`}
                  className={`acct-notif-row${prefs && !prefs[type] ? ' off' : ''}`}
                  onClick={() => toggle(type, !(prefs?.[type] ?? true))}
                >
                  <span className="acct-row-text"><b>{label}</b><small>{hint}</small></span>
                  <span className={`acct-switch${prefs?.[type] ?? true ? ' on' : ''}`} aria-hidden />
                </button>
              ))}
              <div className="acct-notif-acts">
                <button type="button" className="acct-small" data-testid="push-test" disabled={busy} onClick={onTest}>Send test</button>
                <button type="button" className="acct-guest" data-testid="push-disable" disabled={busy} onClick={onDisable}>Turn off on this device</button>
              </div>
            </div>
          )}
          {msg && <p className="acct-fine" role="status">{msg}</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ entry */
/** The account chip (start screen top-left) + every account sheet + the sign-in notice toast. */
export function AccountEntry({ showChip }: { showChip: boolean }) {
  const a = useAccount();
  const [sheet, setSheet] = useState<Sheet>(null);
  useEffect(() => { void loadAccount().then(() => { if (takePendingOpen() === 'account') setSheet('account'); }); }, []);
  // first sign-in (or a skipped pick): ask for a username
  const askedRef = useRef(false);
  useEffect(() => {
    if (a.user?.needsUsername && !askedRef.current && (sheet === null || sheet === 'signin')) { askedRef.current = true; setSheet('username'); }
  }, [a.user, sheet]);
  useEffect(() => {
    if (!a.notice) return;
    const t = window.setTimeout(() => account.clearNotice(), a.noticeKind === 'error' ? 7000 : 3500);
    return () => window.clearTimeout(t);
  }, [a.notice, a.noticeKind]);

  if (!a.ready || !a.accounts) return showChip ? <span /> : null;
  const u = a.user;
  return (
    <>
      {showChip && (u ? (
        <button type="button" className="acct-chip signed-in" data-testid="account-btn" onClick={() => setSheet(u.needsUsername ? 'username' : 'account')}>
          <span className="acct-avatar small" aria-hidden>{(u.username ?? '?').charAt(0).toUpperCase()}</span>
          <span className="acct-chip-name">{u.username ?? 'Pick a name'}</span>
        </button>
      ) : (
        <button type="button" className="acct-chip" data-testid="signin-btn" onClick={() => setSheet('signin')}>Sign in</button>
      ))}
      {!showChip && <span />}
      {a.notice && <div className={`acct-toast ${a.noticeKind ?? ''}`} role="status" data-testid="acct-toast" onClick={() => account.clearNotice()}>{a.notice}</div>}
      {sheet === 'signin' && <SignInSheet onClose={() => setSheet(null)} onPasskeyNew={() => setSheet('passkey-new')} />}
      {sheet === 'passkey-new' && <UsernamePicker mode="passkey-new" initial="" onDone={() => setSheet(null)} onClose={() => setSheet('signin')} />}
      {sheet === 'username' && u && <UsernamePicker mode={u.username ? 'change' : 'first'} initial={u.username ?? u.suggestion ?? ''} onDone={() => setSheet(u.username ? 'account' : null)} onClose={() => setSheet(u.username ? 'account' : null)} />}
      {sheet === 'account' && u && <AccountScreen user={u} onClose={() => setSheet(null)} onChangeName={() => setSheet('username')} onDelete={() => setSheet('delete')} onSecurity={() => setSheet('security')} />}
      {sheet === 'security' && u && <SecurityScreen user={u} onBack={() => setSheet('account')} />}
      {sheet === 'delete' && u && <DeleteConfirm user={u} onClose={() => setSheet('account')} onDeleted={() => setSheet(null)} />}
    </>
  );
}
