import type { ExchangeView } from '@commonhours/shared';
import { useAction } from '../../lib/mutations';
import { acceptExchange, acceptPartial, approveHomeAccess, cancelExchange, confirmExchange, declineExchange } from './api';

export const ACTION_LABEL: Record<string, string> = {
  accept: 'Accept these terms',
  approveHomeAccess: 'Approve home access',
  decline: 'Decline',
  withdraw: 'Withdraw proposal',
  editTerms: 'Change terms',
  confirm: 'Confirm completion',
  cancel: 'Cancel exchange',
  dispute: 'Open a dispute',
  proposePartial: 'Propose partial completion',
  acceptPartial: 'Accept partial completion',
};

/**
 * Runs one of the backend's exchange actions as the signed-in member. Home access and late cancellation
 * ask the member first; nothing is accepted or approved without their click.
 */
export function useExchangeAction(exchange: ExchangeView | undefined) {
  return useAction(async (key: string) => {
    const e = exchange!;
    if (key === 'accept') return acceptExchange(e.id, e.termsVersion);
    if (key === 'decline' || key === 'withdraw') return declineExchange(e.id);
    if (key === 'confirm') return confirmExchange(e.id);
    if (key === 'acceptPartial') return acceptPartial(e.id);
    if (key === 'approveHomeAccess') {
      const ok = window.confirm(
        `Grant ${e.provider.displayName} permission to enter your home while you are away, for this exchange (terms version ${e.termsVersion}) only?\n\nTheir eligibility does not grant this automatically. Changing the terms will require a new approval.`,
      );
      if (!ok) throw Object.assign(new Error('Home access was not approved.'), { code: 'VALIDATION_FAILED', module: 'web' });
      return approveHomeAccess(e.id, e.termsVersion);
    }
    if (key === 'cancel') {
      const reason = window.prompt('Reason for cancelling (shared with the other member):');
      if (!reason || reason.length < 3) throw Object.assign(new Error('Cancellation needs a reason of at least 3 characters.'), { code: 'VALIDATION_FAILED', module: 'web' });
      return cancelExchange(e.id, reason);
    }
  });
}
