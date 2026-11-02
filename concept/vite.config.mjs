import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Localhost only, and not part of the hosted demo: the Dockerfile builds apps/web alone.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
});
