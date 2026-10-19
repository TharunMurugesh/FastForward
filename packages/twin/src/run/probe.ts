const PROBE_TIMEOUT_MS = 5_000;

export interface ProbeAnswer {
  access: boolean | null;
  fulfilments: number | null;
}

/** Asks the app's test-only probe (spec §5). No answer, an error or a malformed body gives nulls. */
export async function probe(probeUrl: string, subscriptionId: string): Promise<ProbeAnswer> {
  const url = new URL(probeUrl);
  url.searchParams.set('subscription_id', subscriptionId);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel();
      return { access: null, fulfilments: null };
    }
    const body = (await res.json()) as { access?: unknown; fulfilments?: unknown };
    return {
      access: typeof body.access === 'boolean' ? body.access : null,
      fulfilments: typeof body.fulfilments === 'number' ? body.fulfilments : null,
    };
  } catch {
    return { access: null, fulfilments: null };
  }
}
