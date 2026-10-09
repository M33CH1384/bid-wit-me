import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  // the three.js scene is a lazy-loaded chunk (~267 kB gzip); it's only fetched when a table opens
  build: { chunkSizeWarningLimit: 1100 },
});
