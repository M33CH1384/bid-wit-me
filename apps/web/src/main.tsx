import { Component, StrictMode, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isOnlinePath, isWatchPath, watchRoute } from './online/nav';
import { importChunk } from './chunkLoad';
import { installCrashTelemetry, noteCrumb, reportCrash } from './telemetry';
import { LayerGuard } from './LayerGuard';
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
const VictoryRecovery = lazy(() => importChunk(() => import('./VictoryRecovery')));

/** The /rewards postgame route retired in the victory consolidation
 *  (2026-11-01): the report lives at the table now, so a stale tab or an
 *  old bookmark on /rewards lands home instead. A breakdown stranded by
 *  that tab's reload is not lost — VictoryRecovery re-presents whatever
 *  is still owed (an undismissed level-up takeover, a held guest claim). */
function RewardsRetired() {
  useEffect(() => { location.replace('/'); }, []);
  return <RouteLoading />;
}

/** The shared "screen didn't load" card: route failures and the app-level guard land here. */
function ScreenLoadFailure() {
  return (
    <div className="setup online-entry" data-testid="route-failed">
      <h2>That screen didn&apos;t load</h2>
      <p className="muted">The game may have just updated. Reload to get the latest version and pick up where you left off.</p>
      <button type="button" className="btn primary" onClick={() => location.reload()}>Reload</button>
    </div>
  );
}

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
    return <ScreenLoadFailure />;
  }
}

/**
 * App-level guard (crash hardening, 2026-11-06): until now the routed
 * tree was the only guarded part of the app — the dozen global layers
 * below Root's route (Social, the ticker, the transition layers…) sat
 * outside any boundary, so a render throw in one unmounted the ENTIRE
 * root: white screen, live game gone. Each layer now carries its own
 * LayerGuard (a failure stays inside its layer), and this final guard
 * keeps even a failure in Root's own frame on the reload card instead
 * of a blank page.
 */
function AppGuard({ children }: { children: ReactNode }) {
  return <LayerGuard name="app" fallback={<ScreenLoadFailure />}>{children}</LayerGuard>;
}

/** Social's contained fallback: the game underneath is untouched; the
 *  player can retry the panel or dismiss the card and keep playing. */
function SocialFallback({ retry }: { retry: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div data-testid="social-failed" style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 60, maxWidth: 320, background: 'var(--panel, #1c1c22)', border: '1px solid var(--line, #444)', borderRadius: 12, padding: 14 }}>
      <h3 style={{ margin: '0 0 6px' }}>Social hit a snag</h3>
      <p className="muted" style={{ margin: '0 0 10px' }}>The game underneath is fine. Try again, or close this and keep playing.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" onClick={retry}>Try again</button>
        <button type="button" className="btn" onClick={() => setDismissed(true)}>Close</button>
      </div>
    </div>
  );
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
  // app load, whichever screen the sign-in lands on (a victory report
  // surface showing that game defers the watcher to its own in-place claim
  // so the breakdown can render the delta).
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
        {path === '/rewards' ? <RewardsRetired />
          : path === '/story' ? <Suspense fallback={<RouteLoading />}><StoryHome /></Suspense>
          : path === '/profile' ? <Suspense fallback={<RouteLoading />}><ProfilePage /></Suspense>
          : isWatchPath(path) ? <Suspense fallback={<RouteLoading />}><WatchApp path={path} /></Suspense>
          : isOnlinePath(path) ? <Suspense fallback={<RouteLoading />}><OnlineApp path={path} /></Suspense> : <App key={path} />}
      </RouteGuard>
      <LayerGuard name="ink"><InkLayer /></LayerGuard>
      <LayerGuard name="glow"><ReactiveGlow /></LayerGuard>
      {/* The floating speaker parks on a designed slot (home top bar, table scorebug).
          The full-screen /profile route has no slot, so the dock fell
          back to its fixed corner position and sat ON the page header (it covered the
          profile's season label — owner, 2026-10-20): no floating dock on that route. */}
      {path !== '/profile' && !isWatchPath(path) && <LayerGuard name="sound-dock"><SoundDock /></LayerGuard>}
      {/* Watch surfaces carry no app chrome of their own: the in-app watch view
          is a viewing surface, and the broadcast frame must show nothing but
          the table, the bug and its own in-frame ticker (an OBS source loads
          it with no session at all — no social panel, no bonus receipt, and
          no second ticker from the root). */}
      {!isWatchPath(path) && <LayerGuard name="social" fallback={(retry) => <SocialFallback retry={retry} />}><SocialRoot /></LayerGuard>}
      {/* Daily-bonus receipt (2026-10-23): the one-time "+N coins — you now
          have M" card raised when the day's grant lands (see dailyBonus.ts). */}
      {!isWatchPath(path) && <LayerGuard name="bonus-receipt"><DailyBonusReceipt /></LayerGuard>}
      {/* Victory reload-recovery (2026-11-01): presents ONLY when the
          finished-match stash still owes the player something across a
          reload — an undismissed level-up card takeover, or a held guest
          claim on an unsigned breakdown. Renders nothing otherwise; it is
          not a destination and no flow routes to it. */}
      {!isWatchPath(path) && <LayerGuard name="victory-recovery"><Suspense fallback={null}><VictoryRecovery /></Suspense></LayerGuard>}
      {/* The BottomLine, app-wide (league data wave 6a): a fixed bottom bar
          on the main surfaces with its height reserved via bwm-ticker-on.
          It hides itself at a live table, while the Social panel is
          open (the panel carries its own in-flow instance), and on
          /story (story surfaces never carry broadcast chrome). */}
      {!isWatchPath(path) && <LayerGuard name="ticker"><LeagueTickerRoot /></LayerGuard>}
      {/* Spray-paint screen transitions: renders only during a spray. */}
      <LayerGuard name="spray"><SprayLayer /></LayerGuard>
      {/* The Card Fan: renders only during a profile/social move. */}
      <LayerGuard name="fan"><FanLayer /></LayerGuard>
      {/* The Deal + the Book Sweep: render only on table entry/exit. */}
      <LayerGuard name="table-transition"><TableTransitionLayer /></LayerGuard>
      {/* The Doorway: renders only on story entries. */}
      <LayerGuard name="doorway"><DoorwayLayer /></LayerGuard>
      <LayerGuard name="idle-guard"><IdleGuard /></LayerGuard>
      {/* Entry prompt (sign in / guest) + first-sign-in preferences offer.
          Online paths skip the remount: a live room owns its own state and
          its settings refresh on the next navigation instead. */}
      <LayerGuard name="entry-flow"><EntryFlow onPrefsDone={() => { if (!isOnlinePath(location.pathname)) setSettingsEpoch((e) => e + 1); }} /></LayerGuard>
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
      <AppGuard>
        <Root />
      </AppGuard>
    </StrictMode>,
  );
}
