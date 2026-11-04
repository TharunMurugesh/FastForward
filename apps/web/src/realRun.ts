import type { CustomerDecision, DecisionBy } from '@fastforward/contracts';

/** Shape of fidelity/real-report.json, written by `fastforward real --report-dir fidelity`. */
export interface RealRunFile {
  subscriptionId: string | null;
  actions: { name: string; status: number; sandboxId?: string; expects?: string; noticeSeconds?: number }[];
  notices: { eventId: string; eventType: string; duplicate: boolean; appStatus: number | null; verify: 'SUCCESS' | 'FAILURE' | 'not-asked' }[];
  certFetched: boolean;
  resend?: 'arrived' | 'not-arrived' | 'refused';
  decision?: { customer: string; decision: CustomerDecision; by?: DecisionBy };
  error?: string;
}

export interface RealStep {
  /** Real means the real PayPal sandbox did it. Simulated means it did not, whatever the story says. */
  source: 'real' | 'simulated';
  title: string;
  detail: string;
  /** Only the last step: the simulated months, shown on the Timeline tab. */
  opensTimeline?: true;
}

export const CHOICE: Record<CustomerDecision['action'], string> = {
  update_card: 'update their card',
  ignore: 'do nothing',
  cancel: 'cancel',
  dispute: 'dispute the payment',
  reply: 'reply',
};

const TITLE: Record<string, string> = {
  'create product': 'Product created',
  'create plan': 'Plan created',
  'create subscription': 'Subscription created',
  suspend: 'Subscription suspended',
  activate: 'Subscription reactivated',
  cancel: 'Subscription cancelled by the customer',
  'cancel (end of run)': 'Subscription cancelled at the end of the run',
  'resend a notice': 'PayPal sent a notice again',
};

function actionDetail(action: RealRunFile['actions'][number]): string {
  if (action.expects) {
    return action.noticeSeconds === undefined
      ? "Sandbox delay, not an app problem: PayPal's sandbox did not send this notice within 3 minutes. Its other notices arrived."
      : `PayPal's notice reached the app in ${action.noticeSeconds.toFixed(0)} s`;
  }
  return action.sandboxId ? `PayPal's id: ${action.sandboxId}` : `PayPal answered ${action.status}`;
}

function decisionDetail({ decision, by }: NonNullable<RealRunFile['decision']>): string {
  const who = by === 'model' ? 'Decided by Claude, playing the customer.' : 'Scripted default: Claude did not decide this.';
  return decision.action === 'dispute' ? `${who} Not played on real PayPal, because the sandbox API cannot open a dispute.` : who;
}

/** The run in order, each step saying plainly whether real PayPal did it. */
export function realSteps(report: RealRunFile): RealStep[] {
  const steps: RealStep[] = [];
  for (const action of report.actions) {
    if (action.name === 'suspend' && report.decision) {
      steps.push({ source: 'simulated', title: `${report.decision.customer}'s card is declined`, detail: 'The sandbox cannot fail a renewal, so this cause is part of the story. The suspension that follows is real.' });
    }
    steps.push({ source: 'real', title: TITLE[action.name] ?? action.name, detail: actionDetail(action) });
    if (action.name === 'suspend' && report.decision) {
      steps.push({ source: 'simulated', title: `${report.decision.customer} chose to ${CHOICE[report.decision.decision.action]}`, detail: decisionDetail(report.decision) });
    }
  }
  steps.push({ source: 'simulated', title: 'The months after this', detail: 'The sandbox cannot move time, so the simulator plays them.', opensTimeline: true });
  return steps;
}
