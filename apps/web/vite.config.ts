import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/** Version stamp baked into the build: "v0.3.0 beta · <short sha> · <build date>" (shown in More options + Credits). */
const APP_VERSION = '0.3.0';
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; } })();

/**
 * Content-Security-Policy: only this site's own scripts can run, so a stray/injected script can't read the seat tokens
 * kept in localStorage. connect-src lists the game server (HTTP + websocket). Shipped to Pages as `_headers`
 * (static assets only) and mirrored on `vite preview` so local e2e runs under the same policy.
 */
function csp(server: string): string {
  const ws = server.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob: mediastream:",
    "font-src 'self' data:",
    `connect-src 'self' data: blob: ${server} ${ws}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
const SECURITY = (server: string) => ({
  'Content-Security-Policy': csp(server),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), payment=(), usb=()',
});
const prodServer = (process.env.VITE_SERVER_URL || 'https://bid-wit-me-server.demetrius-robinson31.workers.dev').trim().replace(/\/$/, '');
const localServer = 'http://127.0.0.1:8787';
function pagesHeaders(): Plugin {
  return {
    name: 'bwm-pages-headers',
    apply: 'build',
    generateBundle() {
      const h = SECURITY(prodServer);
      const lines = ['/*', ...Object.entries(h).map(([k, v]) => `  ${k}: ${v}`), ''];
      this.emitFile({ type: 'asset', fileName: '_headers', source: lines.join('\n') });
    },
  };
}

export default defineConfig({
  plugins: [react(), pagesHeaders()],
  // /api/* (accounts + sign-in) is same-origin: Pages Functions proxy it to the Worker in production, these proxies locally
  server: { port: 5173, proxy: { '/api': { target: localServer, xfwd: true } } },
  preview: { port: 4173, headers: SECURITY(localServer), proxy: { '/api': { target: localServer, xfwd: true } } },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __GIT_SHA__: JSON.stringify(process.env.GIT_SHA || sha),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // the three.js scene is a lazy-loaded chunk (~267 kB gzip); it's only fetched when a table opens
  build: {
    chunkSizeWarningLimit: 1100,
    // throwaway WebXR prototype is its own page (xr.html) so @react-three/xr never enters the game bundle graph
    rollupOptions: { input: { main: 'index.html', xr: 'xr.html' } },
  },
});
