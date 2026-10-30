import { Component, StrictMode, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isOnlinePath, isWatchPath, watchRoute } from './online/nav';
import { importChunk } from './chunkLoad';
import { installCrashTelemetry, noteCrumb, reportCrash } from './telemetry';
import { SoundDock } from './SoundControls';
import { SocialRoot } from './social/Social';
import DailyBonusReceipt from './DailyBonusReceipt';
import { LeagueTickerRoot } from './social/LeagueTicker';
import InkLayer from './ink/InkLayer';
import SprayLayer from './SprayLayer';
import FanLayer from './FanLayer';
import TableTransitionLayer from './TableTransitionLayer';
import DoorwayLayer from './DoorwayLayer';
import { cancelSpray, coverThen, sprayRouteEligible } from './spray';
import { coverTableEntry, routeMoveClass } from './transitions';
import { initSpraySound } from './spraySound';
import { initTransitionSound } from './transitionSound';
import { watchPendingClaim } from './pendingClaim';
import ReactiveGlow from './neon/ReactiveGlow';
import { initTheme } from './theme';
import IdleGuard from './IdleGuard';
import EntryFlow from './EntryFlow';
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
const WatchApp = lazy(() => importChunk(() => import('./online/WatchApp')));
const ProfilePage = lazy(() => importChunk(() => import('./profile/ProfilePage')));
const StoryHome = lazy(() => importChunk(() => import('./story/StoryHome')));
const RewardsPage = lazy(() => importChunk(() => import('./RewardsPage')));

/** Last line of defence for a failed route chunk: a visible way back, never a blank page. */
class RouteGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(err: unknown) {
    console.warn('[bwm] route chunk failed to load', err);
    // Every catch here used to vanish into the console: a fatal in the table /
    // Scene subtree looked exactly like a chunk failure and left no trace.
    // Report it as what it is — the boundary is the bounce-to-menu path.
    reportCrash('boundary', err, { route: location.pathname });
  }
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
  // Crash-telemetry breadcrumb: every route the session visits, so a report
  // shows the road that led to the crash (table -> boundary -> menu).
  useEffect(() => { noteCrumb('route', path); }, [path]);
  // Bumped when the first-sign-in preferences step finishes: the screens hold
  // their own Settings snapshots (read at mount), so a remount is how the
  // step's saved settings become the live ones everywhere at once.
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  // Spray-paint transitions (spray.ts): EVERY route change reaches Root as a
  // popstate — navigate() dispatches one synthetically, browser back/forward
  // fires it natively — so this handler is the one choke point. An eligible
  // menu-space swap waits under the paint cover (the old screen stays
  // rendered until full cover, then path flips underneath); anything else
  // (table entries above all) applies instantly and cancels any stray spray
  // so paint can never dissolve over a table. The ref mirrors `path` because
  // eligibility must be judged against the screen actually on display,
  // including while a covered swap is still pending.
  const pathRef = useRef(path);
  useEffect(() => {
    const on = () => {
      const next = location.pathname;
      const cur = pathRef.current;
      if (next === cur) return;
      // The transition family (transitions.ts): the move is
      // classified and the class picks the program.
      const move = routeMoveClass(cur, next);
      if (move === 'table-entry') {
        // THE DEAL: start the deal FIRST (its cover flushes any
        // older pending swap), then land the table path instantly —
        // the table mounts underneath and its seats hold owns the
        // wait; the deal lifts on the table's ready signal.
        coverTableEntry();
        pathRef.current = next;
        setPath(next);
      } else if (sprayRouteEligible(cur, next)) {
        // Menu space: spray/ink by theme, the Card Fan for profile
        // moves, the Doorway for Story Mode entry.
        coverThen(() => {
          pathRef.current = next;
          setPath(next);
        }, move ?? 'menu-nav');
      } else if (move === 'table-exit') {
        // THE BOOK SWEEP: the leave lands under the sweep's cover.
        coverThen(() => {
          pathRef.current = next;
          setPath(next);
        }, 'table-exit');
      } else {
        cancelSpray();
        pathRef.current = next;
        setPath(next);
      }
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  // A guest game's held rewards claim submits itself on the next signed-in
  // app load, whichever screen the sign-in lands on (/rewards defers to its
  // own in-place claim so the breakdown can render the delta).
  useEffect(() => { watchPendingClaim(); }, []);
  // Spray-transition sound (spraySound.ts): the can's shake + hiss follow
  // the spray controller's phase events; a suppressed spray stays silent.
  useEffect(() => { initSpraySound(); }, []);
  // Family sounds (transitionSound.ts): the fan's shuffle, the deal's
  // slides, the sweep's shove — same phase-event discipline.
  useEffect(() => { initTransitionSound(); }, []);
  return (
    <>
      <RouteGuard key={`${path}:${settingsEpoch}`}>
        {path === '/rewards' ? <Suspense fallback={<RouteLoading />}><RewardsPage /></Suspense>
          : path === '/story' ? <Suspense fallback={<RouteLoading />}><StoryHome /></Suspense>
          : path === '/profile' ? <Suspense fallback={<RouteLoading />}><ProfilePage /></Suspense>
          : isWatchPath(path) ? <Suspense fallback={<RouteLoading />}><WatchApp path={path} /></Suspense>
          : isOnlinePath(path) ? <Suspense fallback={<RouteLoading />}><OnlineApp path={path} /></Suspense> : <App key={path} />}
      </RouteGuard>
      <InkLayer />
      <ReactiveGlow />
      {/* The floating speaker parks on a designed slot (home top bar, table scorebug).
          The full-screen /profile and /rewards routes have no slot, so the dock fell
          back to its fixed corner position and sat ON the page header (it covered the
          profile's season label — owner, 2026-10-20): no floating dock on those routes. */}
      {path !== '/profile' && path !== '/rewards' && !isWatchPath(path) && <SoundDock />}
      {/* Watch surfaces carry no app chrome of their own: the in-app watch view
          is a viewing surface, and the broadcast frame must show nothing but
          the table, the bug and its own in-frame ticker (an OBS source loads
          it with no session at all — no social panel, no bonus receipt, and
          no second ticker from the root). */}
      {!isWatchPath(path) && <SocialRoot />}
      {/* Daily-bonus receipt (2026-10-23): the one-time "+N coins — you now
          have M" card raised when the day's grant lands (see dailyBonus.ts). */}
      {!isWatchPath(path) && <DailyBonusReceipt />}
      {/* The BottomLine, app-wide (league data wave 6a): a fixed bottom bar
          on the main surfaces with its height reserved via bwm-ticker-on.
          It hides itself at a live table, while the Social panel is
          open (the panel carries its own in-flow instance), and on
          /story (story surfaces never carry broadcast chrome). */}
      {!isWatchPath(path) && <LeagueTickerRoot />}
      {/* Spray-paint screen transitions: renders only during a spray. */}
      <SprayLayer />
      {/* The Card Fan: renders only during a profile/social move. */}
      <FanLayer />
      {/* The Deal + the Book Sweep: render only on table entry/exit. */}
      <TableTransitionLayer />
      {/* The Doorway: renders only on story entries. */}
      <DoorwayLayer />
      <IdleGuard />
      {/* Entry prompt (sign in / guest) + first-sign-in preferences offer.
          Online paths skip the remount: a live room owns its own state and
          its settings refresh on the next navigation instead. */}
      <EntryFlow onPrefsDone={() => { if (!isOnlinePath(location.pathname)) setSettingsEpoch((e) => e + 1); }} />
    </>
  );
}

// Crash telemetry installs before the route tree renders, so the boot's own
// failures (and the previous session's unclean-exit witness) are captured.
installCrashTelemetry();

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
