import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CheckId, Finding } from '@fastforward/contracts';
import { z } from 'zod';

const SavedSchema = z.object({ explanation: z.string().min(1), fix: z.string().min(1) });
export type SavedNarration = z.infer<typeof SavedSchema>;

/** Dispute, webhook-event, subscription, plan and product ids are made up fresh on every run, so they must not decide the key. */
const GENERATED_ID = /\b(?:PP-D-\d+|WH-[A-Z0-9-]{6,}|I-[A-Z0-9]{6,}|P-[A-Z0-9]{10,}|PROD-[A-Z0-9]{6,})\b/g;

/** Which saved explanation belongs to a finding: its check and its wording with generated ids masked. */
export function narrationKey(check: CheckId, finding: Pick<Finding, 'summary'>): string {
  const wording = finding.summary.replace(GENERATED_ID, '#');
  return `${check}:${createHash('sha256').update(wording).digest('hex').slice(0, 16)}`;
}

/**
 * Failure explanations the model has written, saved so a rerun (or a hosted demo with no API key) shows the same
 * words. Only real model output is ever saved, never a template. Sits next to the decision lock.
 */
export class NarrationLock {
  private readonly used = new Set<string>();

  private constructor(
    private readonly path: string | null,
    private readonly saved: Map<string, SavedNarration>,
  ) {}

  /** A missing file is an empty lock. A damaged one is an error, so a recording is never silently thrown away. */
  static load(path: string): NarrationLock {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new NarrationLock(path, new Map());
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = z.record(z.string(), SavedSchema).safeParse(json);
    if (!parsed.success) throw new Error(`${path} is not a valid narration lock; fix it or rerun with --fresh`);
    return new NarrationLock(path, new Map(Object.entries(parsed.data)));
  }

  get size(): number {
    return this.saved.size;
  }

  /** How many saved explanations this run used (replayed or newly written). */
  get touched(): number {
    return this.used.size;
  }

  get(key: string): SavedNarration | undefined {
    const found = this.saved.get(key);
    if (found) this.used.add(key);
    return found;
  }

  set(key: string, value: SavedNarration): void {
    this.saved.set(key, value);
    this.used.add(key);
  }

  save(): void {
    if (!this.path) return;
    const sorted = Object.fromEntries([...this.saved].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(sorted, null, 2) + '\n');
  }
}
