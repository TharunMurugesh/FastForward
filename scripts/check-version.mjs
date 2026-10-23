#!/usr/bin/env node
/**
 * One version for the whole project, kept in the VERSION file. Fails when a package.json, the changelog or
 * the packages that would be published disagree with it, so a release cannot go out half-updated.
 *   npm run check:version
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const problems = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`VERSION must look like 1.2.3, got "${version}"`);

const manifests = ['package.json'];
for (const group of ['packages', 'apps', 'examples']) {
  if (!existsSync(join(root, group))) continue;
  for (const dir of readdirSync(join(root, group))) manifests.push(`${group}/${dir}/package.json`);
}
for (const file of manifests) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const found = JSON.parse(readFileSync(path, 'utf8')).version;
  if (found !== version) problems.push(`${file} says ${found}, VERSION says ${version}`);
}

if (!existsSync(join(root, 'CHANGELOG.md'))) {
  problems.push('CHANGELOG.md is missing');
} else {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const headings = changelog.split(/\r?\n/).filter((line) => line.startsWith('## ['));
  if (!headings.some((line) => line.startsWith(`## [${version}]`))) problems.push(`CHANGELOG.md has no "## [${version}]" entry`);
}

// The packages that would be published, if they have been built (npm run bundle).
const publishDir = join(root, 'publish');
if (existsSync(publishDir)) {
  for (const name of readdirSync(publishDir)) {
    const found = JSON.parse(readFileSync(join(publishDir, name, 'package.json'), 'utf8')).version;
    if (found !== version) problems.push(`publish/${name} is ${found}; run npm run bundle again`);
  }
}

if (problems.length > 0) {
  console.error(`check-version FAILED:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-version: all ${manifests.length} manifests, the changelog and the packages say ${version}`);
