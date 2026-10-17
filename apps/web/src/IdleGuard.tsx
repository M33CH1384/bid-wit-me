/**
 * Root inactivity guard: mounted above BOTH the offline app and the online app, so the
 * 30-minute sign-out fires even when idling on the main menu.
 *  5 min  -> idle badge · 15 min -> drop off the Online list (heartbeats pause) ·
 *  30 min -> sign out fully (account signOut, or guest session rotation) + owed notice.
 * Offline bot games hold an exemption (App) and active play keeps touching the watch.
 */
import { useEffect, useRef, useState } from 'react';
import { account, signOut } from './account/api';
import { IDLE_NOTICE_KEY, IdleWatch, idleAction, idleExempt, idlePolicyFrom, type IdleStage } from './inactivity';
import { isOnlinePath, navigate } from './online/nav';
import { resetGuestSession } from './online/identity';
import { social } from './social/store';

const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export default function IdleGuard() {
  const [stage, setStage] = useState<IdleStage>('active');
  const [notice, setNotice] = useState(() => { try { return localStorage.getItem(IDLE_NOTICE_KEY) === '1'; } catch { return false; } });
  const signedOut = useRef(false);

  useEffect(() => {
    const watch = new IdleWatch(idlePolicyFrom(localStorage));
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
        try { localStorage.setItem(IDLE_NOTICE_KEY, '1'); } catch { /* private mode */ }
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

  const dismiss = () => { try { localStorage.removeItem(IDLE_NOTICE_KEY); } catch { /* ignore */ } setNotice(false); };
  const atMenu = !isOnlinePath(location.pathname);
  return (
    <>
      {stage === 'badge' && <div className="idle-badge" data-testid="idle-badge" role="status">💤 Away — no activity for a bit. Move or tap to stay signed in.</div>}
      {stage === 'away' && <div className="idle-badge" data-testid="idle-badge" role="status">💤 Away — you're off the Online list until you come back.</div>}
      {notice && atMenu && (
        <div className="idle-notice" data-testid="idle-logout" role="alert">
          <span>Signed out for inactivity.</span>
          <button type="button" className="btn" onClick={dismiss}>OK</button>
        </div>
      )}
    </>
  );
}
