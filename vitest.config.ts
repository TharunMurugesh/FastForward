import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      'examples/*',
      // Sandbox fidelity: compares the twin with PayPal's real sandbox. Needs keys and the network, so it is
      // kept out of `npm test` and runs with `npm run fidelity`; the test file skips itself without FF_FIDELITY=1.
      {
        test: {
          name: 'fidelity',
          include: ['packages/twin/test/fidelity/fidelity.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
      // Phase 1 acceptance: real processes and real sockets, so it is kept out of `npm test` (see package.json).
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.test.ts'],
          globalSetup: ['test/e2e/global-setup.ts'],
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
