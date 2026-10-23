import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CustomerDecision } from '@fastforward/contracts';
import { z } from 'zod';
import { DISPUTE_REASONS } from '@fastforward/contracts';

export const DecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update_card') }),
  z.object({ action: z.literal('ignore') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('dispute'), reason: z.enum(DISPUTE_REASONS), message: z.string().min(1) }),
  z.object({ action: z.literal('reply'), message: z.string().min(1) }),
]);

/** Saved customer decisions, so a rerun of a scenario behaves identically. Keyed by `<customer>:<point>:<n>`. */
export class DecisionLock {
  /** Keys this run used, whether replayed from the file or newly decided: how many decisions the model made. */
  private readonly used = new Set<string>();

  private constructor(
    private readonly path: string | null,
    private readonly decisions: Map<string, CustomerDecision>,
  ) {}

  /** A missing file is an empty lock. A damaged one is an error, so decisions are never silently thrown away. */
  static load(path: string): DecisionLock {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new DecisionLock(path, new Map());
      throw err;
    }
    const parsed = z.record(z.string(), DecisionSchema).safeParse(safeJson(text));
    if (!parsed.success) throw new Error(`${path} is not a valid decision lock; fix it or rerun with --fresh`);
    return new DecisionLock(path, new Map(Object.entries(parsed.data)));
  }

  /** How many decisions are held. A run with no AI decisions has nothing worth saving. */
  get size(): number {
    return this.decisions.size;
  }

  get touched(): number {
    return this.used.size;
  }

  get(key: string): CustomerDecision | undefined {
    const found = this.decisions.get(key);
    if (found) this.used.add(key);
    return found;
  }

  set(key: string, decision: CustomerDecision): void {
    this.decisions.set(key, decision);
    this.used.add(key);
  }

  save(): void {
    if (!this.path) return;
    const sorted = Object.fromEntries([...this.decisions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(sorted, null, 2) + '\n');
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
