import { describe, expect, it } from 'vitest';
import { parseTab } from '../src/useTab.js';

describe('parseTab', () => {
  it('reads the tab from the address', () => {
    expect(parseTab('#deliveries')).toBe('deliveries');
    expect(parseTab('match')).toBe('match');
  });
  it('falls back to the overview for an empty or unknown tab', () => {
    expect(parseTab('')).toBe('overview');
    expect(parseTab('#report')).toBe('overview');
    expect(parseTab('#constructor')).toBe('overview');
  });
});
