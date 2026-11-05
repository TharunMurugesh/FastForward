import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// On your machine: `npm run concept` (port 5180, with the dashboard on 8080). Hosted: `npm run build:concept` builds it
// into concept/dist, and scripts/start-hosted.mjs serves it at /frame/ as the front page.
// The /frame/ path is for the hosted build only, so the local preview stays at http://127.0.0.1:5180/.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/frame/' : '/',
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
}));
