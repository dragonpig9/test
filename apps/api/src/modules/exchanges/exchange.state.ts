import type { ExchangeStatus } from '@commonhours/shared';
import type { Machine } from '../../core/state-machine';

/**
 * Exchange lifecycle.
 *   PROPOSED  → ACCEPTED (both accepted the same terms version; credits reserved)
 *             → DECLINED (counterparty said no) | WITHDRAWN (proposer pulled it)
 *   ACCEPTED  → SETTLED (both confirmed, or partial completion agreed)
 *             → CANCELLED (within cancellation terms; reservation released)
 *             → DISPUTED (one party disputes before settlement; reservation frozen)
 *   DISPUTED  → SETTLED (attestation confirmed / mutual) | RELEASED (refuted / mutual)
 * Settled exchanges cannot be disputed: there is no reversal workflow in this MVP.
 */
export const exchangeMachine: Machine<ExchangeStatus> = {
  name: 'exchange',
  module: 'exchanges',
  transitions: {
    PROPOSED: ['ACCEPTED', 'DECLINED', 'WITHDRAWN'],
    ACCEPTED: ['SETTLED', 'CANCELLED', 'DISPUTED'],
    DISPUTED: ['SETTLED', 'RELEASED'],
    SETTLED: [],
    RELEASED: [],
    CANCELLED: [],
    DECLINED: [],
    WITHDRAWN: [],
  },
  describe: {
    PROPOSED: 'waiting for both parties to accept the same terms',
    ACCEPTED: 'terms agreed and credits reserved',
    DISPUTED: 'credits frozen while attestation runs',
    SETTLED: 'credits transferred',
    RELEASED: 'reservation released without payment',
    CANCELLED: 'cancelled; reservation released',
    DECLINED: 'declined by the counterparty',
    WITHDRAWN: 'withdrawn by the proposer',
  },
};
