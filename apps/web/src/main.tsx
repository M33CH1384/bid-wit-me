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

/** "/" = offline (vs bots) as before; "/online" and "/t/CODE" = online tables. */
function Root() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return (
    <>
      {isOnlinePath(path) ? <Suspense fallback={null}><OnlineApp path={path} /></Suspense> : <App key={path} />}
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
