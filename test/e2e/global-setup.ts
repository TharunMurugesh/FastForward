import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** The register add-on and Coffee Club run as plain `node` processes, so they need their built output. */
export default function setup(): void {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  for (const file of ['packages/register/dist/index.js', 'examples/coffee-club/dist/server.js']) {
    if (!existsSync(root + file)) throw new Error(`build did not produce ${file}`);
  }
}
