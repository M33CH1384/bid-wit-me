/**
 * Root inactivity guard: mounted above BOTH the offline app and the online app, so the
 * 30-minute sign-out fires even when idling on the main menu.
 *  5 min  -> idle badge · 15 min -> drop off the Online list (heartbeats pause) ·
 *  30 min -> sign out fully (account signOut, or guest session rotation) + owed notice.
 * Offline bot games hold an exemption (App) and active play keeps touching the watch.
 */
import { useEffect, useRef, useState } from 'react';
import { account, signOut, useAccount } from './account/api';
import { IdleWatch, clearIdleNotice, idleAction, idleExempt, idleNoticeOwed, idleNoticeVisible, idlePolicyFrom, markIdleNoticeOwed, type IdleStage } from './inactivity';
import { isOnlinePath, navigate } from './online/nav';
import { resetGuestSession } from './online/identity';
import { social } from './social/store';

const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export default function IdleGuard() {
  const [stage, setStage] = useState<IdleStage>('active');
  const [notice, setNotice] = useState(() => idleNoticeOwed(localStorage));
  const signedOut = useRef(false);
  const watchRef = useRef<IdleWatch | null>(null);
  const acct = useAccount();

  // Sign-in ends the idle sign-out, whichever surface completed it (the account
  // store has already cleared the persisted flag at the transition itself):
  // hide the notice now, re-arm the guard so only a genuinely NEW idle sign-out
  // can bring it back, and restart the idle clock for the fresh session.
  useEffect(() => {
    if (!acct.user) return;
    clearIdleNotice(localStorage);
    setNotice(false);
    if (signedOut.current) { signedOut.current = false; watchRef.current?.touch(); }
  }, [acct.user]);

  useEffect(() => {
    const watch = new IdleWatch(idlePolicyFrom(localStorage));
    watchRef.current = watch;
    const onAct = () => { watch.touch(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    const iv = setInterval(() => {
      if (idleExempt()) { watch.touch(); setStage((s) => (s === 'active' ? s : 'active')); return; }
      const st = watch.stage();
      setStage((s) => (s === st ? s : st));
      const action = idleAction(st, { scope: isOnlinePath(location.pathname) ? 'online' : 'menu' });
      social.setHeartbeatPaused(action === 'drop-presence' || action === 'sign-out');
      if (action === 'sign-out' && !signedOut.current) {
        signedOut.current = true;
        markIdleNoticeOwed(localStorage);
        setNotice(true);
        void (async () => {
          // Full sign-out: account users lose their session; guests lose their guest identity.
          // (At an online table, OnlineApp's own idle leave releases the seat and forgets the token.)
          if (account.get().user) await signOut().catch(() => undefined);
          else resetGuestSession();
          if (isOnlinePath(location.pathname)) navigate('/', true, { wiz: 'home', d: 0 });
        })();
      }
    }, 1_000);
    return () => { ACTIVITY.forEach((e) => window.removeEventListener(e, onAct)); clearInterval(iv); };
  }, []);

  const dismiss = () => { clearIdleNotice(localStorage); setNotice(false); };
  const atMenu = !isOnlinePath(location.pathname);
  return (
    <>
      {stage === 'badge' && <div className="idle-badge" data-testid="idle-badge" role="status">💤 Away — no activity for a bit. Move or tap to stay signed in.</div>}
      {stage === 'away' && <div className="idle-badge" data-testid="idle-badge" role="status">💤 Away — you're off the Online list until you come back.</div>}
      {idleNoticeVisible(notice, !!acct.user) && atMenu && (
        <div className="idle-notice" data-testid="idle-logout" role="alert">
          <span>Signed out for inactivity.</span>
          <button type="button" className="btn primary" onClick={dismiss}>OK</button>
        </div>
      )}
    </>
  );
}
