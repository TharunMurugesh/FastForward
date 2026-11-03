import { describe, expect, it } from 'vitest';
import { realSteps, type RealRunFile } from '../src/realRun.js';

const base: RealRunFile = {
  subscriptionId: 'I-REAL',
  actions: [
    { name: 'create subscription', status: 201, sandboxId: 'I-REAL', expects: 'BILLING.SUBSCRIPTION.ACTIVATED', noticeSeconds: 12 },
    { name: 'suspend', status: 204, expects: 'BILLING.SUBSCRIPTION.SUSPENDED' },
    { name: 'activate', status: 204, expects: 'BILLING.SUBSCRIPTION.ACTIVATED', noticeSeconds: 20.4 },
  ],
  notices: [],
  certFetched: false,
  decision: { customer: 'Leo', decision: { action: 'update_card' }, by: 'model' },
};

describe('realSteps', () => {
  it('labels what real PayPal did and what it did not, in order', () => {
    expect(realSteps(base).map((s) => [s.source, s.title])).toEqual([
      ['real', 'Subscription created'],
      ['simulated', "Leo's card is declined"],
      ['real', 'Subscription suspended'],
      ['simulated', 'Leo chose to update their card'],
      ['real', 'Subscription reactivated'],
      ['simulated', 'The months after this'],
    ]);
  });

  it('says how long a notice took, and never invents one that did not arrive', () => {
    const steps = realSteps(base);
    expect(steps[0]!.detail).toBe("PayPal's notice reached the app in 12 s");
    expect(steps[2]!.detail).toContain('did not come within 3 minutes');
  });

  it('does not credit Claude for a scripted default', () => {
    const steps = realSteps({ ...base, decision: { customer: 'Leo', decision: { action: 'ignore' }, by: 'scripted' } });
    expect(steps.find((s) => s.title === 'Leo chose to do nothing')!.detail).toContain('Claude did not decide');
  });

  it('says a chosen dispute was not played on real PayPal', () => {
    const steps = realSteps({ ...base, decision: { customer: 'Leo', decision: { action: 'dispute', reason: 'OTHER', message: 'No.' }, by: 'model' } });
    expect(steps.find((s) => s.title === 'Leo chose to dispute the payment')!.detail).toContain('Not played on real PayPal');
  });

  it('adds no customer story to a report without a decision', () => {
    const { decision: _decision, ...older } = base;
    expect(realSteps(older).filter((s) => s.source === 'simulated').map((s) => s.title)).toEqual(['The months after this']);
  });
});
