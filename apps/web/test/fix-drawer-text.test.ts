import { describe, expect, it } from 'vitest';
import { firstSentence, shortIds } from '../src/panels/FixDrawer.js';

describe('How to fix drawer text', () => {
  it('shortens long PayPal ids to their first 8 characters', () => {
    expect(shortIds('notice WH-VGZDZD0XSESQGHOA7-SOVM92N6POBYU43VO was accepted')).toBe('notice WH-VGZDZD0X… was accepted');
  });

  it('leaves short ids and plain words alone', () => {
    expect(shortIds('subscription I-LTI2N0RM0HIM for WHITE-BOX')).toBe('subscription I-LTI2N0RM0HIM for WHITE-BOX');
  });

  it('cuts an explanation at its first sentence, not at dots inside event names', () => {
    expect(firstSentence('PayPal sent the BILLING.SUBSCRIPTION.CREATED notice for Maya. Your app answered 200.')).toBe(
      'PayPal sent the BILLING.SUBSCRIPTION.CREATED notice for Maya.',
    );
  });

  it('keeps text with no full stop whole', () => {
    expect(firstSentence('No full stop here')).toBe('No full stop here');
  });
});
