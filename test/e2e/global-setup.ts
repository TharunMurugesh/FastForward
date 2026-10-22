import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

const DIST_FILES = [
  'packages/register/dist/index.js',
  'examples/coffee-club/dist/server.js',
  'examples/plain-fetch-shop/dist/server.js',
];

/**
 * Returns true if every dist file exists and is newer than every source file
 * under the listed source globs. Falls back to false on any error.
 */
function distIsUpToDate(): boolean {
  try {
    const distMtimes = DIST_FILES.map((f) => statSync(root + f).mtimeMs);
    const oldestDist = Math.min(...distMtimes);
    const srcGlobs = [
      'packages/*/src/**/*.ts',
      'examples/*/src/**/*.ts',
      'packages/*/tsconfig.json',
      'tsconfig*.json',
    ];
    for (const pattern of srcGlobs) {
      const files = globSync(pattern, { cwd: root });
      for (const f of files) {
        if (statSync(root + f).mtimeMs > oldestDist) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** The register add-on and example apps run as plain `node` processes, so they need their built output. */
export default function setup(): void {
  if (distIsUpToDate()) {
    console.log('[global-setup] dist is up-to-date, skipping build');
  } else {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  }
  for (const file of DIST_FILES) {
    if (!existsSync(root + file)) throw new Error(`build did not produce ${file}`);
  }
}
