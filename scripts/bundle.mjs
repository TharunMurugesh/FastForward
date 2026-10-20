#!/usr/bin/env node
/**
 * Builds the three packages that get published to npm, into publish/ (git-ignored):
 *   fastforward-cli       the `fastforward` command, with the twin, AI part and contracts packed inside
 *   fastforward-register  the add-on an app preloads with `node --import`
 *   fastforward-mcp       the stdio server for coding assistants
 * Workspace packages (@fastforward/*) are inlined; every other import stays a normal npm dependency, and the
 * version for each is read from the workspace package that uses it, so the manifests cannot drift from the code.
 * Nothing is published by this script. Try it with: npm run pack:check
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'publish');
const VERSION = process.env.FF_VERSION ?? '0.1.0';
const REPO = 'https://github.com/VinayG759/FastForward';

const workspaceDeps = {};
for (const dir of readdirSync(join(root, 'packages'))) {
  const pkg = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) if (!name.startsWith('@fastforward/')) workspaceDeps[name] ??= range;
}

const targets = [
  {
    name: 'fastforward-cli',
    description: 'Fastforward: a flight simulator for PayPal subscriptions. Skip a month ahead, let AI customers misbehave, find your billing bugs.',
    entries: { bin: 'packages/cli/src/bin.ts', index: 'packages/cli/src/index.ts' },
    manifest: { bin: { fastforward: './bin.js' }, main: './index.js', exports: { '.': './index.js' } },
  },
  {
    name: 'fastforward-register',
    description: 'Preload for Fastforward: sends your app\'s PayPal sandbox calls to the simulator and blocks live PayPal. Use: FASTFORWARD=1 node --import fastforward-register app.js',
    entries: { index: 'packages/register/src/index.ts' },
    manifest: { main: './index.js', exports: { '.': './index.js' } },
  },
  {
    name: 'fastforward-mcp',
    description: 'MCP server for Fastforward: lets a coding assistant write a scenario, run it against your app and explain billing bugs.',
    entries: { server: 'packages/mcp/src/server.ts', index: 'packages/mcp/src/index.ts' },
    manifest: { bin: { 'fastforward-mcp': './server.js' }, main: './index.js', exports: { '.': './index.js' } },
  },
];

/** Bare imports stay external unless they are our own workspace packages. */
const externalise = {
  name: 'externalise',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@fastforward/') || /^[A-Za-z]:/.test(args.path) || args.path.startsWith('node:')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

rmSync(out, { recursive: true, force: true });
for (const t of targets) {
  const dir = join(out, t.name);
  mkdirSync(dir, { recursive: true });
  const result = await build({
    entryPoints: Object.fromEntries(Object.entries(t.entries).map(([k, v]) => [k, join(root, v)])),
    outdir: dir,
    outExtension: { '.js': '.js' },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    conditions: ['development'],
    plugins: [externalise],
    metafile: true,
    sourcemap: false,
    logLevel: 'warning',
  });
  const used = new Set();
  for (const o of Object.values(result.metafile.outputs)) {
    for (const i of o.imports) {
      if (!i.external || i.path.startsWith('node:')) continue;
      const parts = i.path.split('/');
      used.add(i.path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  const dependencies = {};
  for (const name of [...used].sort()) {
    if (!workspaceDeps[name]) throw new Error(`${t.name} imports ${name} but no workspace package declares it`);
    dependencies[name] = workspaceDeps[name];
  }
  const manifest = {
    name: t.name,
    version: VERSION,
    description: t.description,
    license: 'MIT',
    type: 'module',
    ...t.manifest,
    files: ['*.js', 'README.md', 'LICENSE', 'NOTICE'],
    engines: { node: '>=24' },
    dependencies,
    repository: { type: 'git', url: `git+${REPO}.git` },
    homepage: `${REPO}#readme`,
    bugs: { url: `${REPO}/issues` },
    keywords: ['paypal', 'subscriptions', 'webhooks', 'testing', 'simulator', 'sandbox', 'mcp'],
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), `# ${t.name}\n\n${t.description}\n\nSee ${REPO} for what it does, a three-command demo and the full docs.\n`);
  copyFileSync(join(root, 'LICENSE'), join(dir, 'LICENSE'));
  copyFileSync(join(root, 'NOTICE'), join(dir, 'NOTICE'));
  console.log(`${t.name}: ${Object.keys(dependencies).length} dependencies (${Object.keys(dependencies).join(', ')})`);
}
