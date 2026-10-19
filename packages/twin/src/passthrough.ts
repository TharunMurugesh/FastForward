import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const SANDBOX_HOST = 'api-m.sandbox.paypal.com';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export interface SandboxCreds {
  clientId: string;
  clientSecret: string;
}

/**
 * Returns `base` without a trailing slash if it may be a passthrough target, otherwise throws.
 * Allowed: exactly `https://api-m.sandbox.paypal.com`, or `127.0.0.1` / `localhost` (tests).
 * Everything else, live PayPal included, is refused.
 */
export function checkUpstreamBase(base: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`invalid upstream base "${base}": not a URL`);
  }
  if (url.username !== '' || url.password !== '') throw new Error(`invalid upstream base "${base}": credentials in URL`);
  const sandbox = url.protocol === 'https:' && url.hostname === SANDBOX_HOST && url.port === '';
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (!sandbox && !local) {
    throw new Error(`refusing upstream base "${base}": passthrough only targets ${SANDBOX_BASE}`);
  }
  return url.origin;
}

/** The twin's own OAuth client against the real sandbox; the app's token is never forwarded. */
class SandboxToken {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly base: string,
    private readonly creds: SandboxCreds,
  ) {}

  async get(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString('base64');
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`sandbox rejected the twin's credentials (HTTP ${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('sandbox token response had no access_token');
    const lifetimeMs = (body.expires_in ?? 300) * 1000;
    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max(lifetimeMs - 60_000, 0) };
    return body.access_token;
  }
}

const SKIP_REQUEST_HEADERS = new Set(['host', 'authorization', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding']);
const KEEP_RESPONSE_HEADERS = ['content-type', 'paypal-debug-id'];

/** Registers catch-alls for `/v1/*` and `/v2/*`. Routes registered more specifically win. */
export function registerPassthrough(app: FastifyInstance, opts: { upstreamBase: string; sandboxCreds?: SandboxCreds }): void {
  const base = checkUpstreamBase(opts.upstreamBase);
  const token = opts.sandboxCreds ? new SandboxToken(base, opts.sandboxCreds) : null;

  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!token) {
      return reply.code(501).send({
        name: 'NOT_IMPLEMENTED_IN_TWIN',
        message: `The Fastforward twin does not implement ${req.method} ${req.url} and has no sandbox credentials to pass it through.`,
      });
    }
    let bearer: string;
    try {
      bearer = await token.get();
    } catch (err) {
      return reply.code(502).send({ name: 'PASSTHROUGH_AUTH_FAILED', message: (err as Error).message });
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (SKIP_REQUEST_HEADERS.has(name) || value === undefined) continue;
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    headers.authorization = `Bearer ${bearer}`;

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody && req.rawBody ? Uint8Array.from(req.rawBody) : undefined;
    let upstream: Response;
    try {
      upstream = await fetch(`${base}${req.raw.url ?? req.url}`, { method: req.method, headers, body });
    } catch (err) {
      return reply.code(502).send({ name: 'PASSTHROUGH_FAILED', message: (err as Error).message });
    }

    reply.code(upstream.status);
    for (const name of KEEP_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) reply.header(name, value);
    }
    return reply.send(Buffer.from(await upstream.arrayBuffer()));
  };

  app.all('/v1/*', handler);
  app.all('/v2/*', handler);
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Request body bytes exactly as received, kept for byte-exact passthrough. */
    rawBody?: Buffer;
  }
}
