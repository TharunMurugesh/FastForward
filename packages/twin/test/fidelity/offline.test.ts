import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FidelityFile } from '../../../../apps/web/src/fidelity.js';
import type { Twin } from '../../src/index.js';
import { evaluate, runFidelitySuite, startTwinWithRun, toFidelityFile, writeFidelityFile, type AllowedDiffs, type StepOutcome } from './suite.js';

// The first spec check of each OpenAPI file compiles it (several seconds); later ones reuse it.
vi.setConfig({ testTimeout: 120_000 });

const creds = { clientId: 'sandbox-client-id', clientSecret: 'sandbox-secret-value-123' };
const ENDPOINTS = [
  'POST /v1/catalogs/products',
  'POST /v1/billing/plans',
  'POST /v1/billing/subscriptions',
  'GET /v1/billing/subscriptions/{id}',
  'POST /v1/billing/subscriptions/{id}/cancel',
  'POST /v1/notifications/verify-webhook-signature',
  'GET /v1/customer/disputes',
];

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

async function fakeSandbox(): Promise<Twin> {
  const twin = await startTwinWithRun();
  cleanup.push(() => twin.close());
  return twin;
}

/** A proxy in front of a twin that can rewrite responses, to stand in for a real sandbox that differs. */
async function proxy(target: Twin, rewrite: (method: string, path: string, status: number, body: unknown) => { status: number; body: unknown }) {
  const seen: { path: string; authorization: string | undefined }[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = req.url ?? '/';
    seen.push({ path, authorization: req.headers.authorization });
    const headers: Record<string, string> = {};
    for (const key of ['authorization', 'content-type', 'prefer']) if (req.headers[key]) headers[key] = String(req.headers[key]);
    const upstream = await fetch(`${target.url}${path}`, { method: req.method, headers, ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}) });
    const text = await upstream.text();
    let out = { status: upstream.status, body: (text ? JSON.parse(text) : undefined) as unknown };
    if (!path.startsWith('/v1/oauth2')) out = rewrite(req.method ?? 'GET', path, out.status, out.body);
    res.statusCode = out.status;
    if (out.body !== undefined) res.setHeader('content-type', 'application/json');
    res.end(out.body === undefined ? undefined : JSON.stringify(out.body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const keyOf = (o: StepOutcome) => `${o.method} ${o.template}`;

describe('the suite, against a fake sandbox that is another twin', () => {
  it('runs the seven requests in order and finds no difference', async () => {
    const sandbox = await fakeSandbox();
    const twin = await fakeSandbox();
    const outcomes = await runFidelitySuite({ sandboxBase: sandbox.url, sandboxCreds: creds, twinUrl: twin.url });

    expect(outcomes.map(keyOf)).toEqual(ENDPOINTS);
    expect(outcomes.map((o) => [o.sandbox.status, o.twin.status])).toEqual([[201, 201], [201, 201], [201, 201], [200, 200], [404, 404], [400, 400], [200, 200]]);
    for (const o of outcomes) {
      expect(o.diffs, keyOf(o)).toEqual([]);
      expect(o.specErrors, keyOf(o)).toEqual([]);
    }
    const checks = outcomes.map((o) => evaluate(o, {}));
    expect(checks.every((c) => c.check.shapeMatch && c.check.specMatch && c.unexpected.length === 0)).toBe(true);
  });

  it('sends the sandbox credentials to the sandbox only, as a Basic token request', async () => {
    const sandbox = await fakeSandbox();
    const twin = await fakeSandbox();
    const front = await proxy(sandbox, (_m, _p, status, body) => ({ status, body }));
    await runFidelitySuite({ sandboxBase: front.url, sandboxCreds: creds, twinUrl: twin.url });
    const tokenCall = front.seen.find((s) => s.path === '/v1/oauth2/token')!;
    expect(tokenCall.authorization).toBe(`Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`);
    expect(front.seen.filter((s) => s.path !== '/v1/oauth2/token').every((s) => s.authorization?.startsWith('Bearer '))).toBe(true);
  });

  it('reports a field the sandbox lacks, and a status that differs, as differences', async () => {
    const sandbox = await fakeSandbox();
    const twin = await fakeSandbox();
    const front = await proxy(sandbox, (method, path, status, body) => {
      if (method === 'GET' && /^\/v1\/billing\/subscriptions\/[^/]+$/.test(path)) {
        const { quantity: _dropped, ...rest } = body as Record<string, unknown>;
        return { status, body: rest };
      }
      if (path.endsWith('/cancel')) return { status: 422, body }; // same error body, different status
      return { status, body };
    });
    const outcomes = await runFidelitySuite({ sandboxBase: front.url, sandboxCreds: creds, twinUrl: twin.url });

    const get = outcomes.find((o) => o.template === '/v1/billing/subscriptions/{id}' && o.method === 'GET')!;
    expect(get.diffs).toEqual([{ field: 'quantity', detail: 'only in twin' }]);
    const cancel = outcomes.find((o) => o.template.endsWith('/cancel'))!;
    expect([cancel.sandbox.status, cancel.twin.status]).toEqual([422, 404]);

    const strict = outcomes.map((o) => evaluate(o, {}));
    expect(strict.filter((c) => !c.check.shapeMatch).map((c) => `${c.check.method} ${c.check.endpoint}`)).toEqual([
      'GET /v1/billing/subscriptions/{id}',
      'POST /v1/billing/subscriptions/{id}/cancel',
    ]);
    expect(strict.find((c) => c.check.method === 'GET' && c.check.endpoint.endsWith('{id}'))!.unexpected).toEqual(['quantity (only in twin)']);

    const allowed: AllowedDiffs = {
      'GET /v1/billing/subscriptions/{id}': [{ field: 'quantity', reason: 'test: the fake sandbox omits it' }],
      'POST /v1/billing/subscriptions/{id}/cancel': [{ field: '(status)', reason: 'test: the fake sandbox refuses' }],
    };
    const lenient = outcomes.map((o) => evaluate(o, allowed));
    expect(lenient.every((c) => c.check.shapeMatch && c.unexpected.length === 0)).toBe(true);
    expect(lenient.flatMap((c) => c.check.allowedDiffs)).toEqual([
      { field: 'quantity', reason: 'test: the fake sandbox omits it' },
      { field: '(status)', reason: 'test: the fake sandbox refuses' },
    ]);
  });

  it('flags a sandbox response that breaks the OpenAPI schema', async () => {
    const sandbox = await fakeSandbox();
    const twin = await fakeSandbox();
    const front = await proxy(sandbox, (method, path, status, body) =>
      method === 'GET' && /^\/v1\/billing\/subscriptions\/[^/]+$/.test(path) ? { status, body: { ...(body as object), status: 'NOT_A_STATUS' } } : { status, body },
    );
    const outcomes = await runFidelitySuite({ sandboxBase: front.url, sandboxCreds: creds, twinUrl: twin.url });
    const get = outcomes.find((o) => o.method === 'GET' && o.template.endsWith('{id}'))!;
    expect(get.specErrors.join(' ')).toMatch(/sandbox.*status/);
    expect(evaluate(get, {}).check.specMatch).toBe(false);
    expect(evaluate(get, {}).check.shapeMatch).toBe(true); // a string is still a string
  });
});

describe('error names', () => {
  it('are reported in the notes for non-2xx answers, never in the evidence file', async () => {
    const sandbox = await fakeSandbox();
    const twin = await fakeSandbox();
    const front = await proxy(sandbox, (_m, path, status, body) =>
      path.endsWith('/cancel') ? { status: 404, body: { name: 'INVALID_RESOURCE_ID', message: 'm', debug_id: 'd', details: [], links: [] } } : { status, body },
    );
    const outcomes = await runFidelitySuite({ sandboxBase: front.url, sandboxCreds: creds, twinUrl: twin.url });
    const cancel = outcomes.find((o) => o.template.endsWith('/cancel'))!;
    const e = evaluate(cancel, {});
    expect(e.notes).toEqual(['error name: sandbox INVALID_RESOURCE_ID, twin RESOURCE_NOT_FOUND']);
    expect(JSON.stringify(e.check)).not.toContain('INVALID_RESOURCE_ID');
    expect(evaluate(outcomes[0]!, {}).notes).toEqual([]);
  });

  it('are compared when both sides fail', () => {
    const outcome: StepOutcome = {
      name: 'x',
      method: 'POST',
      template: '/v1/x',
      sandbox: { status: 404, body: { name: 'INVALID_RESOURCE_ID' } },
      twin: { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } },
      diffs: [],
      specErrors: [],
    };
    expect(evaluate(outcome, {}).notes).toEqual(['error name: sandbox INVALID_RESOURCE_ID, twin RESOURCE_NOT_FOUND']);
    expect(evaluate({ ...outcome, twin: { status: 404, body: { name: 'INVALID_RESOURCE_ID' } } }, {}).notes).toEqual([]);
  });
});

describe('safety', () => {
  it('refuses live PayPal and anything that is not the sandbox or localhost', async () => {
    for (const base of ['https://api-m.paypal.com', 'https://api.paypal.com', 'https://example.com']) {
      await expect(runFidelitySuite({ sandboxBase: base, sandboxCreds: creds, twinUrl: 'http://127.0.0.1:1' })).rejects.toThrow(/upstream/i);
    }
  });

  it('a rejected token request fails without echoing the credentials', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'invalid_client', echo: creds.clientSecret }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    cleanup.push(() => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))));
    const twin = await fakeSandbox();
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const error = await runFidelitySuite({ sandboxBase: base, sandboxCreds: creds, twinUrl: twin.url }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
    expect(text).toMatch(/401/);
    expect(text).not.toContain(creds.clientSecret);
    expect(text).not.toContain(Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64'));
  });
});

describe('the evidence file', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  /** Outcomes whose bodies are full of things that must never be written down. */
  const tainted = (): StepOutcome[] => [
    {
      name: 'get subscription',
      method: 'GET',
      template: '/v1/billing/subscriptions/{id}',
      sandbox: {
        status: 200,
        body: { id: 'I-REALSANDBOX01', subscriber: { email_address: 'buyer@private.test' }, access_token: 'A21AAH-secret-token', plan_id: 'P-REALPLANID0000000000000001' },
      },
      twin: { status: 200, body: { id: 'I-TWIN00000001' } },
      diffs: [{ field: 'subscriber', detail: 'only in sandbox' }],
      specErrors: [],
    },
  ];

  it('writes only shapes, statuses and reasons: never ids, tokens, emails or values', () => {
    const file = toFidelityFile(tainted(), { sandboxBase: 'https://api-m.sandbox.paypal.com', allowed: { 'GET /v1/billing/subscriptions/{id}': [{ field: 'subscriber', reason: 'sandbox adds subscriber details' }] }, ranAt: '2026-10-25T10:00:00.000Z' });
    const dir = mkdtempSync(join(tmpdir(), 'ff-fidelity-'));
    dirs.push(dir);
    const path = join(dir, 'fidelity', 'latest.json');
    writeFidelityFile(path, file);

    const text = readFileSync(path, 'utf8');
    for (const secret of ['I-REALSANDBOX01', 'buyer@private.test', 'A21AAH-secret-token', 'P-REALPLANID0000000000000001', 'I-TWIN00000001']) {
      expect(text).not.toContain(secret);
    }
    const parsed = JSON.parse(text) as FidelityFile;
    expect(Object.keys(parsed).sort()).toEqual(['checks', 'ranAt', 'sandboxBase']);
    expect(Object.keys(parsed.checks[0]!).sort()).toEqual(['allowedDiffs', 'endpoint', 'method', 'sandboxStatus', 'shapeMatch', 'specMatch', 'twinStatus']);
    expect(parsed).toEqual({
      ranAt: '2026-10-25T10:00:00.000Z',
      sandboxBase: 'https://api-m.sandbox.paypal.com',
      checks: [
        {
          endpoint: '/v1/billing/subscriptions/{id}',
          method: 'GET',
          sandboxStatus: 200,
          twinStatus: 200,
          shapeMatch: true,
          specMatch: true,
          allowedDiffs: [{ field: 'subscriber', reason: 'sandbox adds subscriber details' }],
        },
      ],
    });
  });

  it('refuses to write a file that contains something that looks like an id, token or email', () => {
    const file: FidelityFile = {
      ranAt: '2026-10-25T10:00:00.000Z',
      sandboxBase: 'https://api-m.sandbox.paypal.com',
      checks: [{ endpoint: '/v1/billing/subscriptions/I-ABCDEFGHIJKL', method: 'GET', sandboxStatus: 200, twinStatus: 200, shapeMatch: true, specMatch: true, allowedDiffs: [] }],
    };
    const dir = mkdtempSync(join(tmpdir(), 'ff-fidelity-'));
    dirs.push(dir);
    expect(() => writeFidelityFile(join(dir, 'latest.json'), file)).toThrow(/looks like/);
    for (const bad of ['buyer@private.test', 'Bearer abc123', 'A21AAH-secret-token-value']) {
      const f = { ...file, checks: [{ ...file.checks[0]!, endpoint: '/ok', allowedDiffs: [{ field: 'x', reason: bad }] }] };
      expect(() => writeFidelityFile(join(dir, 'latest.json'), f), bad).toThrow(/looks like/);
    }
  });

  it('records a status difference and a spec failure honestly', () => {
    const outcome: StepOutcome = {
      name: 'cancel',
      method: 'POST',
      template: '/v1/billing/subscriptions/{id}/cancel',
      sandbox: { status: 422, body: { name: 'X' } },
      twin: { status: 204, body: undefined },
      diffs: [{ field: '(body)', detail: 'sandbox object, twin empty' }],
      specErrors: ['sandbox: something'],
    };
    const file = toFidelityFile([outcome], { sandboxBase: 'https://api-m.sandbox.paypal.com', allowed: {}, ranAt: '2026-10-25T10:00:00.000Z' });
    expect(file.checks[0]).toMatchObject({ sandboxStatus: 422, twinStatus: 204, shapeMatch: false, specMatch: false, allowedDiffs: [] });
  });
});
