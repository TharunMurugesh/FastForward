import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { urlToHttpOptions } from 'node:url';
import { Agent, setGlobalDispatcher, type Dispatcher } from 'undici';

export const SANDBOX_HOSTS: readonly string[] = ['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'];
export const LIVE_HOSTS: readonly string[] = ['api-m.paypal.com', 'api.paypal.com'];

const INSTALLED = Symbol.for('fastforward.register');

/** Thrown instead of letting a request reach live PayPal. Through `fetch` it arrives as the error's `cause`. */
export class FastforwardLiveCallError extends Error {
  override name = 'FastforwardLiveCallError';
  readonly url: string;

  constructor(url: string) {
    super(`Fastforward blocked a call to live PayPal (${url}). Only the sandbox is allowed while FASTFORWARD=1. Point your app's PayPal base URL at the sandbox (api-m.sandbox.paypal.com), or leave it unset so the add-on redirects it to the simulator.`);
    this.url = url;
  }
}

export function hostKind(host: string): 'sandbox' | 'live' | 'other' {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (SANDBOX_HOSTS.includes(h)) return 'sandbox';
  if (LIVE_HOSTS.includes(h)) return 'live';
  return 'other';
}

/** The twin must be a plain http(s) server that is not PayPal, or redirected traffic could go anywhere. */
export function parseTwinUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`FF_TWIN_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`FF_TWIN_URL must be http or https: ${value}`);
  if (hostKind(url.hostname) !== 'other') throw new Error(`FF_TWIN_URL must point at the Fastforward twin, not PayPal: ${value}`);
  return url;
}

type Headers = http.OutgoingHttpHeaders | readonly string[] | Iterable<[string, unknown]> | null | undefined;

/** Copies headers in whatever shape they came (flat array, iterable, object), replacing Host. */
function withHost(headers: Headers, host: string): Record<string, unknown> | string[] {
  if (Array.isArray(headers)) {
    const flat: string[] = [];
    for (let i = 0; i < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() !== 'host') flat.push(headers[i] as string, headers[i + 1] as string);
    }
    return [...flat, 'host', host];
  }
  const entries: [string, unknown][] =
    headers == null
      ? []
      : Symbol.iterator in headers
        ? [...(headers as Iterable<[string, unknown]>)]
        : Object.entries(headers as http.OutgoingHttpHeaders);
  return Object.fromEntries([...entries.filter(([k]) => k.toLowerCase() !== 'host'), ['host', host]]);
}

/** Origin and path only: a query string could hold secrets and must not travel to the twin's trace. */
function describeUrl(host: string, path: string | null | undefined): string {
  const url = new URL(path ?? '/', `https://${host.toLowerCase().replace(/\.$/, '')}`);
  return `${url.origin}${url.pathname}`;
}

export function installRedirect(twinUrl: string): void {
  const g = globalThis as { [INSTALLED]?: { twinUrl: string } };
  if (g[INSTALLED]) return;
  const twin = parseTwinUrl(twinUrl);

  const httpRequest = http.request;
  const httpsRequest = https.request;
  const httpsGet = https.get;
  const twinRequest = twin.protocol === 'https:' ? httpsRequest : httpRequest;
  const twinOptions = urlToHttpOptions(twin);

  function reportLiveCall(url: string): void {
    const body = JSON.stringify({ url });
    const req = twinRequest(new URL('/_ff/live-call', twin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    });
    req.on('response', (res) => res.resume());
    req.on('error', () => {}); // the twin may be down; the throw that follows is what protects the app
    req.end(body);
  }

  function blockLive(url: string): never {
    reportLiveCall(url);
    throw new FastforwardLiveCallError(url);
  }

  /** Returns a request to the twin for sandbox hosts, throws for live hosts, or null to leave the call alone. */
  function route(args: unknown[]): http.ClientRequest | null {
    const [first, second, third] = args;
    let options: https.RequestOptions;
    let callback: unknown;
    if (typeof first === 'string' || first instanceof URL) {
      const fromUrl = urlToHttpOptions(new URL(first));
      if (typeof second === 'function') {
        options = fromUrl;
        callback = second;
      } else {
        options = { ...fromUrl, ...(second as https.RequestOptions | undefined) };
        callback = third;
      }
    } else {
      options = { ...(first as https.RequestOptions | undefined) };
      callback = second;
    }

    const host = options.hostname ?? options.host ?? 'localhost';
    const kind = hostKind(host);
    if (kind === 'other') return null;
    if (kind === 'live') blockLive(describeUrl(host, options.path));

    const port = options.port == null || options.port === '' || Number(options.port) === 443 ? '' : `:${options.port}`;
    const target: http.RequestOptions = {
      ...options,
      protocol: twinOptions.protocol,
      hostname: twinOptions.hostname,
      host: twinOptions.hostname,
      port: twinOptions.port,
      headers: withHost(options.headers, `${host}${port}`) as http.OutgoingHttpHeaders,
      agent: undefined,
      createConnection: undefined,
    };
    return twinRequest(target, callback as (res: http.IncomingMessage) => void);
  }

  function request(...args: unknown[]): http.ClientRequest {
    return route(args) ?? (httpsRequest as (...a: unknown[]) => http.ClientRequest)(...args);
  }

  function get(...args: unknown[]): http.ClientRequest {
    const req = route(args);
    if (!req) return (httpsGet as (...a: unknown[]) => http.ClientRequest)(...args);
    req.end();
    return req;
  }

  // Covers the official SDK (axios → node:https). Sync so `import { request } from 'node:https'` sees it too.
  Object.assign(https, { request, get });
  syncBuiltinESMExports();

  // Covers global fetch. npm undici and Node's bundled copy share the global-dispatcher slot; undici is
  // pinned exactly and a test proves fetch is redirected, because that slot is an internal contract.
  class RedirectAgent extends Agent {
    override dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
      const origin = new URL(String(opts.origin));
      const kind = hostKind(origin.hostname);
      if (kind === 'other') return super.dispatch(opts, handler);
      if (kind === 'live') blockLive(describeUrl(origin.host, opts.path));
      const headers = withHost(opts.headers as Headers, origin.host) as Dispatcher.DispatchOptions['headers'];
      return super.dispatch({ ...opts, origin: twin.origin, headers }, handler);
    }
  }
  setGlobalDispatcher(new RedirectAgent());

  g[INSTALLED] = { twinUrl: twin.href };
}
