import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const fidelityFile = fileURLToPath(new URL('../../fidelity/latest.json', import.meta.url));

/** Serves the committed fidelity evidence (repo-root fidelity/latest.json, written by `npm run fidelity`). */
function fidelityEvidence(): Plugin {
  // Braces on purpose: Vite treats a function returned from configureServer as a post-hook.
  const serve = (server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }): void => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/fidelity/latest.json' || !existsSync(fidelityFile)) return next();
      res.setHeader('Content-Type', 'application/json');
      res.end(readFileSync(fidelityFile));
    });
  };
  return { name: 'fidelity-evidence', configureServer: serve, configurePreviewServer: serve };
}

// The twin's control API (spec section 9) lives on 4010; proxying keeps the browser on one origin.
const twin = process.env.FF_TWIN_URL ?? 'http://127.0.0.1:4010';

export default defineConfig({
  plugins: [react(), fidelityEvidence()],
  build: { outDir: 'dist/app' },
  server: { port: 5173, proxy: { '/_ff': twin } },
  preview: { proxy: { '/_ff': twin } },
});
