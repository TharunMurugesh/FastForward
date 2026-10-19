export const BUG_NAMES = ['no-verify', 'no-dedupe', 'slow-ack', 'ignores-suspend', 'ignores-disputes', 'trusts-event-order'] as const;
export type Bug = (typeof BUG_NAMES)[number];

/** Parses COFFEE_BUGS: `none` (default), `all`, or a comma list of bug names. */
export function parseBugs(value: string | undefined): Set<Bug> {
  const text = (value ?? 'none').trim().toLowerCase();
  if (text === '' || text === 'none') return new Set();
  if (text === 'all') return new Set(BUG_NAMES);
  const bugs = new Set<Bug>();
  for (const name of text.split(',').map((s) => s.trim())) {
    if (!(BUG_NAMES as readonly string[]).includes(name)) {
      throw new Error(`unknown COFFEE_BUGS entry "${name}" (use none, all or: ${BUG_NAMES.join(', ')})`);
    }
    bugs.add(name as Bug);
  }
  return bugs;
}
