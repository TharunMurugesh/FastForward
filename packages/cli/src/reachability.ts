import { ToolError } from './errors.js';

/**
 * Is anything listening at `url`? Any HTTP answer counts, including 404 and 405: a webhook route that only
 * takes POST still proves the app is up. Only "no answer" fails, so a run never starts against a dead app.
 */
export async function checkReachable(url: string, timeoutMs: number): Promise<void> {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ToolError(`can't reach your app at ${url}. Start your app first (FASTFORWARD=1 node --import fastforward-register your-app.js), and check that app.webhookUrl in your scenario matches the address it listens on.`);
  }
}
