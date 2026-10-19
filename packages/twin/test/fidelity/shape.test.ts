import { describe, expect, it } from 'vitest';
import { diffShapes, shapeOf } from './shape.js';

describe('shapeOf', () => {
  it('keeps keys and value types, never values', () => {
    expect(shapeOf({ id: 'I-ABC', count: 3, ok: true, none: null, nested: { a: 'x', b: 1.5 } })).toEqual({
      id: 'string',
      count: 'number',
      ok: 'boolean',
      none: 'null',
      nested: { a: 'string', b: 'number' },
    });
  });

  it('describes an array by its first element', () => {
    expect(shapeOf({ links: [{ href: 'a', rel: 'self' }, { href: 'b', rel: 'other', extra: 1 }] })).toEqual({ links: [{ href: 'string', rel: 'string' }] });
    expect(shapeOf([1, 'two'])).toEqual(['number']);
    expect(shapeOf([[1], ['a']])).toEqual([['number']]);
  });

  it('an empty array is an empty array shape', () => {
    expect(shapeOf({ items: [] })).toEqual({ items: [] });
  });

  it('handles scalars, null and undefined at the top level', () => {
    expect(shapeOf('text')).toBe('string');
    expect(shapeOf(7)).toBe('number');
    expect(shapeOf(null)).toBe('null');
    expect(shapeOf(undefined)).toBe('empty');
  });

  it('two bodies with different values but one shape have equal shapes', () => {
    const a = shapeOf({ id: 'I-AAA', billing_info: { failed_payments_count: 0, outstanding_balance: { value: '0.00' } } });
    const b = shapeOf({ id: 'I-ZZZ', billing_info: { failed_payments_count: 7, outstanding_balance: { value: '12.00' } } });
    expect(a).toEqual(b);
  });

  it('key order does not matter', () => {
    expect(shapeOf({ a: 1, b: 'x' })).toEqual(shapeOf({ b: 'y', a: 2 }));
  });
});

describe('diffShapes', () => {
  const diff = (a: unknown, b: unknown) => diffShapes(shapeOf(a), shapeOf(b));

  it('finds nothing when shapes are equal', () => {
    expect(diff({ a: 1, b: { c: 'x' } }, { a: 2, b: { c: 'y' } })).toEqual([]);
  });

  it('names a field present on one side only', () => {
    expect(diff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ field: 'b', detail: 'only in sandbox' }]);
    expect(diff({ a: 1 }, { a: 1, b: { c: 1 } })).toEqual([{ field: 'b', detail: 'only in twin' }]);
  });

  it('names a field whose type differs', () => {
    expect(diff({ a: { n: 1 } }, { a: { n: '1' } })).toEqual([{ field: 'a.n', detail: 'sandbox number, twin string' }]);
  });

  it('writes array elements as [] in the path', () => {
    expect(diff({ links: [{ href: 'a', method: 'GET' }] }, { links: [{ href: 'a' }] })).toEqual([{ field: 'links[].method', detail: 'only in sandbox' }]);
  });

  it('an empty array on either side says nothing about the elements', () => {
    expect(diff({ items: [] }, { items: [{ a: 1 }] })).toEqual([]);
    expect(diff({ items: [{ a: 1 }] }, { items: [] })).toEqual([]);
  });

  it('an array against a non-array is a type difference', () => {
    expect(diff({ a: [1] }, { a: 1 })).toEqual([{ field: 'a', detail: 'sandbox array, twin number' }]);
  });

  it('lists differences in a stable (sorted) order', () => {
    expect(diff({ z: 1, a: 1, m: 1 }, {}).map((d) => d.field)).toEqual(['a', 'm', 'z']);
  });

  it('an empty body on both sides matches; empty against a body differs', () => {
    expect(diff(undefined, undefined)).toEqual([]);
    expect(diff(undefined, { a: 1 })).toEqual([{ field: '(body)', detail: 'sandbox empty, twin object' }]);
  });
});
