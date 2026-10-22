import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isOnlinePath } from './online/nav';
import { importChunk } from './chunkLoad';
import { SoundDock } from './SoundControls';
import { SocialRoot } from './social/Social';
import { LeagueTickerRoot } from './social/LeagueTicker';
import InkLayer from './ink/InkLayer';
import { watchPendingClaim } from './pendingClaim';
import ReactiveGlow from './neon/ReactiveGlow';
import { initTheme } from './theme';
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
const StoryHome = lazy(() => importChunk(() => import('./story/StoryHome')));
const RewardsPage = lazy(() => importChunk(() => import('./RewardsPage')));

/** Last line of defence for a failed route chunk: a visible way back, never a blank page. */
class RouteGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
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
  // A guest game's held rewards claim submits itself on the next signed-in
  // app load, whichever screen the sign-in lands on (/rewards defers to its
  // own in-place claim so the breakdown can render the delta).
  useEffect(() => { watchPendingClaim(); }, []);
  return (
    <>
      <RouteGuard key={path}>
        {path === '/rewards' ? <Suspense fallback={<RouteLoading />}><RewardsPage /></Suspense>
          : path === '/story' ? <Suspense fallback={<RouteLoading />}><StoryHome /></Suspense>
          : path === '/profile' ? <Suspense fallback={<RouteLoading />}><ProfilePage /></Suspense>
          : isOnlinePath(path) ? <Suspense fallback={<RouteLoading />}><OnlineApp path={path} /></Suspense> : <App key={path} />}
      </RouteGuard>
      <InkLayer />
      <ReactiveGlow />
      {/* The floating speaker parks on a designed slot (home top bar, table scorebug).
          The full-screen /profile and /rewards routes have no slot, so the dock fell
          back to its fixed corner position and sat ON the page header (it covered the
          profile's season label — owner, 2026-10-20): no floating dock on those routes. */}
      {path !== '/profile' && path !== '/rewards' && <SoundDock />}
      <SocialRoot />
      {/* The BottomLine, app-wide (league data wave 6a): a fixed bottom bar
          on the main surfaces with its height reserved via bwm-ticker-on.
          It hides itself at a live table, while the Social panel is
          open (the panel carries its own in-flow instance), and on
          /story (story surfaces never carry broadcast chrome). */}
      <LeagueTickerRoot />
      <IdleGuard />
    </>
  );
}

initTheme();

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
