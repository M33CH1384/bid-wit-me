import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isOnlinePath } from './online/nav';
import { SoundDock } from './SoundControls';
import { SocialRoot } from './social/Social';
import IdleGuard from './IdleGuard';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import './styles.css';

const OnlineApp = lazy(() => import('./online/OnlineApp'));
const ProfilePage = lazy(() => import('./profile/ProfilePage'));
const RewardsPage = lazy(() => import('./RewardsPage'));

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
      {path === '/rewards' ? <Suspense fallback={null}><RewardsPage /></Suspense>
        : path === '/profile' ? <Suspense fallback={null}><ProfilePage /></Suspense>
        : isOnlinePath(path) ? <Suspense fallback={null}><OnlineApp path={path} /></Suspense> : <App key={path} />}
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
