/**
 * The shape of a JSON body: its keys and the type of each value, with the values themselves thrown away.
 * Arrays are described by their first element. This is all the fidelity suite ever keeps of a response,
 * so ids, tokens and emails from the real sandbox can never reach a file.
 */
export type Shape = 'string' | 'number' | 'boolean' | 'null' | 'empty' | Shape[] | { [key: string]: Shape };

export function shapeOf(json: unknown): Shape {
  if (json === undefined) return 'empty';
  if (json === null) return 'null';
  if (Array.isArray(json)) return json.length === 0 ? [] : [shapeOf(json[0])];
  switch (typeof json) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object': {
      const out: { [key: string]: Shape } = {};
      for (const key of Object.keys(json as object).sort()) out[key] = shapeOf((json as Record<string, unknown>)[key]);
      return out;
    }
    default:
      return 'string'; // bigint, symbol and function never come out of JSON.parse
  }
}

export interface ShapeDiff {
  /** Dotted path with `[]` for array elements, e.g. `billing_info.cycle_executions[].tenure_type`. */
  field: string;
  detail: string;
}

const kind = (s: Shape): string => (Array.isArray(s) ? 'array' : typeof s === 'object' ? 'object' : s);

/** Where two shapes differ, `a` being the real sandbox and `b` the twin, in sorted order. An empty array says nothing about its elements. */
export function diffShapes(a: Shape, b: Shape, path = ''): ShapeDiff[] {
  const here = path === '' ? '(body)' : path;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === 0 || b.length === 0) return [];
    return diffShapes(a[0]!, b[0]!, `${path}[]`);
  }
  if (typeof a === 'object' && !Array.isArray(a) && typeof b === 'object' && !Array.isArray(b)) {
    const diffs: ShapeDiff[] = [];
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const field = path === '' ? key : `${path}.${key}`;
      if (!(key in b)) diffs.push({ field, detail: 'only in sandbox' });
      else if (!(key in a)) diffs.push({ field, detail: 'only in twin' });
      else diffs.push(...diffShapes(a[key]!, b[key]!, field));
    }
    return diffs;
  }
  return kind(a) === kind(b) ? [] : [{ field: here, detail: `sandbox ${kind(a)}, twin ${kind(b)}` }];
}
