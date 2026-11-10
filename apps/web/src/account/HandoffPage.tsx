import { useEffect, useRef, useState } from 'react';
import './handoff.css';
import { passkeySignIn } from './api';
import { startHandoffPage, type HandoffPageState } from './handoffPage';

/**
 * /auth/handoff — the browser half of the app sign-in handoff. This page only
 * ever runs in a real browser (opened FROM the app), where passkeys work.
 *
 * SIGN-IN ONLY, deliberately: this page mints codes for EXISTING accounts. A
 * player with no account creates one in a normal browser session (or in the
 * app's own create flow later — never here, and never through a handoff code):
 * minting for a brand-new account is how someone ends up with a second,
 * empty account instead of their real one.
 */
export default function HandoffPage() {
  const [st, setSt] = useState<HandoffPageState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const runRef = useRef(0);

  const run = async () => {
    const mine = ++runRef.current;
    setSt(await startHandoffPage());
    if (runRef.current !== mine) return;
  };
  useEffect(() => { void run(); }, []);

  // Ready: try the automatic return once. If the app doesn't come forward
  // (scheme blocked, app not installed), the button and the code stay put.
  useEffect(() => {
    if (st === 'loading' || st.phase !== 'ready') return;
    const t = setTimeout(() => { window.location.href = st.link; }, 600);
    return () => clearTimeout(t);
  }, [st]);

  const signIn = async () => {
    setBusy(true);
    const err = await passkeySignIn(); // api.ts convention: null = signed in, string = the error to show
    setBusy(false);
    if (err === null) void run();
    else setSt({ phase: 'error', message: err });
  };

  return (
    <main className="hf-page">
      <div className="hf-card">
        <h1>Sign in to Bid Wit Me</h1>
        {st === 'loading' && <p>One moment…</p>}
        {st !== 'loading' && st.phase === 'need-signin' && (
          <>
            <p>Sign in with your passkey, and this page will hand your sign-in to the app.</p>
            <button type="button" className="hf-primary" disabled={busy} onClick={() => void signIn()}>
              {busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
            </button>
            <p className="hf-fine">New here? A passkey sign-in only works for an account that already exists — a new passkey would start a separate, empty account. Create your account first in the game, then come back here.</p>
          </>
        )}
        {st !== 'loading' && st.phase === 'ready' && (
          <>
            <p>You&rsquo;re signed in. Tap below to finish in the app:</p>
            <a data-testid="return-to-app" className="hf-primary" href={st.link}>Return to the app</a>
            <p className="hf-fine">Didn&rsquo;t switch over? Open the app, tap Sign in, and type this code — it works once and expires in 10 minutes:</p>
            <p className="hf-code">{st.pretty}</p>
            <button type="button" className="hf-secondary" onClick={() => void run()}>Get a fresh code</button>
          </>
        )}
        {st !== 'loading' && st.phase === 'error' && (
          <>
            <p className="hf-error">{st.message}</p>
            <button type="button" className="hf-secondary" onClick={() => void run()}>Try again</button>
          </>
        )}
      </div>
    </main>
  );
}
