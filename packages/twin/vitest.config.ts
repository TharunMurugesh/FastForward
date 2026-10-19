import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The live sandbox comparison runs in the root `fidelity` project (`npm run fidelity`), never in `npm test`.
    exclude: [...configDefaults.exclude, 'test/fidelity/fidelity.test.ts'],
  },
});
