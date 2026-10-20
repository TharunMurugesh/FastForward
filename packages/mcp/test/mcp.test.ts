import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiClient } from '@fastforward/ai';
import type { Report } from '@fastforward/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/index.js';

let dir: string;
let servers: http.Server[];
let clients: Client[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-mcp-'));
  servers = [];
  clients = [];
});
afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  rmSync(dir, { recursive: true, force: true });
});

/** A fake PayPal-integrated app that answers every webhook 200 and never verifies signatures. */
async function startApp(): Promise<string> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.statusCode = 200;
      res.end('ok');
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/paypal`;
}

const scenarioYaml = (webhookUrl: string) => `
name: tiny
seed: 7
start: 2026-11-01T00:00:00.000Z
duration: P3D
app:
  webhookUrl: ${webhookUrl}
plan:
  name: Tiny
  price: "5.00"
  currency: USD
  interval: MONTH
customers:
  - name: Sam
    persona: Easygoing.
    card: ok
`;

async function connect(ai: AiClient | null = null): Promise<Client> {
  const server = createServer({ cwd: dir, ai, runOptions: { twinPort: 0 } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  clients.push(client);
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n');

describe('fastforward-mcp', () => {
  it('lists three tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['ff_explain', 'ff_run', 'ff_write_scenario']);
  });

  it('ff_run returns a summary naming failed checks, with the fix and the runId', async () => {
    const client = await connect();
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(await startApp()));
    const result = await client.callTool({ name: 'ff_run', arguments: { scenarioPath: file } });
    const text = textOf(result);
    expect(result.isError).toBeFalsy();
    expect(text).toMatch(/runId: run-[0-9a-f]{8}/);
    expect(text).toMatch(/VERIFIES_SIGNATURES\s+fail/);
    expect(text).toMatch(/Fix:/);
    expect(text).toMatch(/NO_LIVE_CALLS\s+(pass|skipped)/);
  });

  it('ff_explain returns every finding of a check for a known run', async () => {
    const client = await connect();
    const report: Report = {
      runId: 'run-0badf00d',
      scenario: 'tiny',
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-11-04T00:00:00.000Z',
      counts: { events: 4, deliveries: 4, customers: 1 },
      checks: [
        {
          id: 'FULFIL_ONCE',
          status: 'fail',
          findings: [
            { at: '2026-11-02T00:00:00.000Z', summary: 'Paid twice for one payment', eventIds: ['e1'], explanation: 'Retries are not deduplicated.', fix: 'Remember event ids.' },
            { at: '2026-11-03T00:00:00.000Z', summary: 'Paid twice again', eventIds: ['e2'] },
          ],
        },
      ],
    };
    mkdirSync(join(dir, '.fastforward', 'runs', report.runId), { recursive: true });
    writeFileSync(join(dir, '.fastforward', 'runs', report.runId, 'report.json'), JSON.stringify(report));
    const result = await client.callTool({ name: 'ff_explain', arguments: { runId: report.runId, checkId: 'FULFIL_ONCE' } });
    const text = textOf(result);
    expect(result.isError).toBeFalsy();
    expect(text).toContain('Paid twice for one payment');
    expect(text).toContain('Paid twice again');
    expect(text).toContain('Retries are not deduplicated.');
    expect(text).toContain('Fix: Remember event ids.');
  });

  it('ff_explain on an unknown runId returns an error result, not a crash', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'ff_explain', arguments: { runId: 'run-deadbeef', checkId: 'ACK_FAST' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no run run-deadbeef/);
  });

  it('ff_explain refuses a runId that is a path, so it cannot read other files', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'ff_explain', arguments: { runId: '../../secret', checkId: 'ACK_FAST' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/runId looks like/);
  });

  it('ff_write_scenario writes the YAML the model produced and refuses to overwrite', async () => {
    const yaml = scenarioYaml('http://127.0.0.1:3000/webhooks/paypal');
    const client = await connect({ complete: async () => yaml });
    const out = join(dir, 'new.yaml');
    const result = await client.callTool({ name: 'ff_write_scenario', arguments: { description: 'one easygoing customer', outputPath: out } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(out);
    expect(readFileSync(out, 'utf8')).toContain('name: tiny');

    const again = await client.callTool({ name: 'ff_write_scenario', arguments: { description: 'one easygoing customer', outputPath: out } });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toMatch(/already exists/);
  });

  it('ff_write_scenario without AI returns an error result', async () => {
    const client = await connect(null);
    const result = await client.callTool({ name: 'ff_write_scenario', arguments: { description: 'anything' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/AI is switched off/);
    expect(existsSync(join(dir, 'tiny.yaml'))).toBe(false);
  });
});
