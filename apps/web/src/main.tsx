import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isOnlinePath } from './online/nav';
import { importChunk } from './chunkLoad';
import { SoundDock } from './SoundControls';
import { SocialRoot } from './social/Social';
import IdleGuard from './IdleGuard';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import './styles.css';

// Route chunks load through importChunk: a deploy deletes the previous build's hashed
// chunks, so a page opened before the deploy (an invite landing in a long-lived tab is
// the classic case) asks for a chunk that no longer exists. Plain lazy() then throws,
// and with no boundary the whole app unmounts to a blank screen until a manual refresh.
// importChunk retries cache-busted and reloads once onto the new build instead.
const OnlineApp = lazy(() => importChunk(() => import('./online/OnlineApp')));
const ProfilePage = lazy(() => importChunk(() => import('./profile/ProfilePage')));
const RewardsPage = lazy(() => importChunk(() => import('./RewardsPage')));

/** Last line of defence for a failed route chunk: a visible way back, never a blank page. */
class RouteGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static override getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(err: unknown) { console.warn('[bwm] route chunk failed to load', err); }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="setup online-entry" data-testid="route-failed">
        <h2>That screen didn&apos;t load</h2>
        <p className="muted">The game may have just updated. Reload to get the latest version and pick up where you left off.</p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

function RouteLoading() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <p className="muted">Loading…</p>
    </div>
  );
}

/** "/" = offline (vs bots) as before; "/online" and "/t/CODE" = online tables; "/profile" = Rep profile. */
function Root() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return (
    <>
      <RouteGuard key={path}>
        {path === '/rewards' ? <Suspense fallback={<RouteLoading />}><RewardsPage /></Suspense>
          : path === '/profile' ? <Suspense fallback={<RouteLoading />}><ProfilePage /></Suspense>
          : isOnlinePath(path) ? <Suspense fallback={<RouteLoading />}><OnlineApp path={path} /></Suspense> : <App key={path} />}
      </RouteGuard>
      <SoundDock />
      <SocialRoot />
      <IdleGuard />
    </>
  );
}

const rootEl = document.getElementById('root')!;
if (new URLSearchParams(location.search).get('preview') === 'turn-ring') {
  void import('./turnRingPreview').then(({ mountTurnRingPreview }) => mountTurnRingPreview(rootEl));
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
