import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Version stamp baked into the build: "v0.3.0 beta · <short sha> · <build date>" (shown in More options + Credits). */
const APP_VERSION = '0.3.0';
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; } })();

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __GIT_SHA__: JSON.stringify(process.env.GIT_SHA || sha),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // the three.js scene is a lazy-loaded chunk (~267 kB gzip); it's only fetched when a table opens
  build: { chunkSizeWarningLimit: 1100 },
});
