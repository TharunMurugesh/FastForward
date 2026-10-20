import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScenario } from '@fastforward/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/index.js';

let dir: string;
let prev: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-init-'));
  prev = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(prev);
  rmSync(dir, { recursive: true, force: true });
});

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (t: string) => void out.push(t), stderr: (t: string) => void err.push(t), ai: null } };
}

describe('fastforward init', () => {
  it('writes a starter scenario that parses and points at the default webhook address', async () => {
    const { io: cliIo, out } = io();
    expect(await main(['init'], cliIo)).toBe(0);
    const scenario = parseScenario(readFileSync(join(dir, 'fastforward.yaml'), 'utf8'));
    expect(scenario.app.webhookUrl).toBe('http://127.0.0.1:3000/webhooks/paypal');
    expect(scenario.customers.length).toBeGreaterThanOrEqual(3);
    // The next steps name the real commands, so a new user can copy them.
    expect(out.join('')).toContain('FASTFORWARD=1 node --import');
    expect(out.join('')).toContain('fastforward run fastforward.yaml');
  });

  it('uses --webhook-url and -o', async () => {
    const { io: cliIo } = io();
    expect(await main(['init', '--webhook-url', 'http://localhost:8080/paypal/hook', '-o', 'mine.yaml'], cliIo)).toBe(0);
    expect(parseScenario(readFileSync(join(dir, 'mine.yaml'), 'utf8')).app.webhookUrl).toBe('http://localhost:8080/paypal/hook');
  });

  it('never overwrites an existing file', async () => {
    writeFileSync(join(dir, 'fastforward.yaml'), 'keep me');
    const { io: cliIo, err } = io();
    expect(await main(['init'], cliIo)).toBe(2);
    expect(err.join('')).toContain('already exists');
    expect(readFileSync(join(dir, 'fastforward.yaml'), 'utf8')).toBe('keep me');
  });

  it('rejects a webhook address that is not a URL', async () => {
    const { io: cliIo, err } = io();
    expect(await main(['init', '--webhook-url', 'not a url'], cliIo)).toBe(2);
    expect(err.join('')).toContain('--webhook-url');
    expect(existsSync(join(dir, 'fastforward.yaml'))).toBe(false);
  });
});
