/**
 * Entry flow (owner, 2026-10-23), mounted once at the app root:
 *  1. A new or logged-out visitor gets a prompt — SIGN IN or PLAY AS GUEST.
 *     A prompt, not a wall: the routed app (deep link included) is already
 *     mounted underneath; guest dismisses for the session, and sign-in
 *     returns to this very path, so the destination survives either choice.
 *  2. A first interactive sign-in (never a silent session restore) gets ONE
 *     offer to set game preferences — the real Settings sheet (MoreOptions)
 *     over the shared Settings model, seeded from whatever this device
 *     already holds (guest-era changes included). Complete or skip marks it
 *     done for that account on this device; it is never re-offered.
 * Pure visibility rules live in entryFlow.ts; the inactivity notice (owed to
 * an idle-timed-out user) always takes precedence over the prompt.
 */
import { useEffect, useState } from 'react';
import { account, clearFirstSignIn, loadAccount, useAccount } from './account/api';
import { SignInSheet, UsernamePicker } from './account/AccountUI';
import MoreOptions from './MoreOptions';
import { dismissGuest, entryModalVisible, entrySuppressed, guestDismissed, markPrefsDone, prefsDone, prefsOfferVisible } from './entryFlow';
import { idleNoticeOwed, idleNoticeVisible } from './inactivity';
import { isOnlinePath, isWatchPath } from './online/nav';
import { loadSettings, saveSettings, type Settings } from './settings';
import { loadTips, type TipsPref } from './tips';

/** The URL the app was OPENED with — autostart strips its own param during
 *  the first render, so suppression must read the original, captured here. */
const ENTRY_SEARCH = typeof location !== 'undefined' ? location.search : '';
const SUPPRESSED = entrySuppressed(ENTRY_SEARCH);

type ModalView = 'prompt' | 'signin' | 'passkey-new';
type PrefsView = 'offer' | 'settings';

export default function EntryFlow({ onPrefsDone }: { onPrefsDone?: () => void }) {
  const acct = useAccount();
  const [path, setPath] = useState(location.pathname);
  const [view, setView] = useState<ModalView>('prompt');
  const [dismissed, setDismissed] = useState(() => guestDismissed(sessionStorage));
  const [owed, setOwed] = useState(() => idleNoticeOwed(localStorage));
  const [prefsView, setPrefsView] = useState<PrefsView | null>(null);
  const [prefsSettings, setPrefsSettings] = useState<Settings | null>(null);
  const [prefsTips, setPrefsTips] = useState<TipsPref | null>(null);

  // Resolve the account store on every route (AccountEntry only mounts on the
  // start screen; the store's own promise makes this a no-op when already run).
  useEffect(() => { void loadAccount(); }, []);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  // Back to the prompt's front door whenever the visitor is signed out again.
  useEffect(() => { if (!acct.user) setView('prompt'); }, [acct.user]);
  // The idle notice can be owed or dismissed while this flow is mounted
  // (IdleGuard owns the flag); re-read it as the account resolves…
  useEffect(() => { setOwed(idleNoticeOwed(localStorage)); }, [acct.ready, acct.user]);
  // …and keep re-reading while the prompt is in play, so the prompt follows
  // the notice's dismissal instead of stacking on top of it.
  const promptInPlay = acct.ready && !acct.user && !dismissed;
  useEffect(() => {
    if (!promptInPlay) return;
    const id = window.setInterval(() => setOwed(idleNoticeOwed(localStorage)), 1_000);
    return () => window.clearInterval(id);
  }, [promptInPlay]);

  const user = acct.user;
  const modalVisible = entryModalVisible({
    ready: acct.ready,
    accounts: acct.accounts,
    signedIn: !!user,
    guestDismissed: dismissed,
    // The notice's own derivation, in its own (menu) scope: while it is on
    // screen the prompt waits; once dismissed, the prompt may follow.
    idleNoticeShowing: idleNoticeVisible(owed, !!user) && !isOnlinePath(path),
    // Watching never walls: watch routes (incl. the unauthenticated OBS
    // broadcast frame) never raise the sign-in/guest prompt.
    suppressed: SUPPRESSED || isWatchPath(path),
  });
  const offerVisible = prefsOfferVisible({
    firstSignInId: acct.firstSignIn?.id ?? null,
    userId: user?.id ?? null,
    needsUsername: !!user?.needsUsername,
    done: user ? prefsDone(localStorage, user.id) : false,
  });
  useEffect(() => { if (offerVisible) setPrefsView((v) => v ?? 'offer'); }, [offerVisible]);

  const chooseGuest = () => { dismissGuest(sessionStorage); setDismissed(true); };
  const finishPrefs = () => {
    const u = account.get().user;
    if (u) markPrefsDone(localStorage, u.id);
    clearFirstSignIn();
    setPrefsView(null);
    onPrefsDone?.();
  };
  const openPrefs = () => {
    // Seed from the device's CURRENT settings — anything the player already
    // changed as a guest is the starting point, never a reset to defaults.
    setPrefsSettings(loadSettings());
    setPrefsTips(loadTips());
    setPrefsView('settings');
  };

  return (
    <>
      {modalVisible && view === 'prompt' && (
        <div className="modal-backdrop sheet-backdrop acct-backdrop">
          <div className="sheet glass slant acct-sheet" role="dialog" aria-label="Sign in or play as guest" data-testid="entry-modal">
            <header className="sheet-head"><span className="panel-title">WELCOME</span></header>
            <div className="scroll sheet-body acct-body">
              <p className="acct-lede">Sign in to keep your badges, series and name on every device — or jump straight in as a guest. Guests can play everything.</p>
              <div className="acct-providers">
                <button type="button" className="primary big" data-testid="entry-signin" onClick={() => setView('signin')}>Sign in</button>
                <button type="button" className="acct-guest" data-testid="entry-guest" onClick={chooseGuest}>Play as guest</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {modalVisible && view === 'signin' && (
        <SignInSheet returnTo={path} onClose={() => setView('prompt')} onPasskeyNew={() => setView('passkey-new')} />
      )}
      {modalVisible && view === 'passkey-new' && (
        <UsernamePicker mode="passkey-new" initial="" onDone={() => setView('prompt')} onClose={() => setView('signin')} />
      )}
      {offerVisible && prefsView === 'offer' && (
        <div className="modal-backdrop sheet-backdrop acct-backdrop">
          <div className="sheet glass slant acct-sheet" role="dialog" aria-label="Set your game preferences" data-testid="first-prefs">
            <header className="sheet-head"><span className="panel-title">GAME PREFERENCES</span></header>
            <div className="scroll sheet-body acct-body">
              <p className="acct-lede">First time signing in — want to set your game preferences now? Sound, graphics, table rules and more. You can change any of it later from the gear.</p>
              <div className="acct-providers">
                <button type="button" className="primary big" data-testid="first-prefs-open" onClick={openPrefs}>Set my preferences</button>
                <button type="button" className="acct-guest" data-testid="first-prefs-skip" onClick={finishPrefs}>Skip for now</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {offerVisible && prefsView === 'settings' && prefsSettings && prefsTips && (
        <MoreOptions
          settings={prefsSettings}
          onChange={(s) => { setPrefsSettings(s); saveSettings(s); }}
          tips={prefsTips}
          onTips={setPrefsTips}
          onClose={finishPrefs}
        />
      )}
    </>
  );
}
