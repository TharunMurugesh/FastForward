import { describe, expect, it } from 'vitest';
import { parseTab } from '../src/useTab.js';

describe('parseTab', () => {
  it('reads the tab from the address', () => {
    expect(parseTab('#result')).toBe('result');
    expect(parseTab('details')).toBe('details');
  });
  it('falls back to the first step for an empty or unknown tab', () => {
    expect(parseTab('')).toBe('choose');
    expect(parseTab('#deliveries')).toBe('choose');
    expect(parseTab('#constructor')).toBe('choose');
  });
});
