import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isOnlinePath } from './online/nav';
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
  if (isOnlinePath(path)) return <Suspense fallback={null}><OnlineApp path={path} /></Suspense>;
  return <App key={path} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
