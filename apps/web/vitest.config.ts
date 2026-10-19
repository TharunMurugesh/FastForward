import { defineConfig } from 'vitest/config';

// Tests are pure functions over traces; they need none of the dev-server plugins in vite.config.ts.
export default defineConfig({ test: { environment: 'node' } });
