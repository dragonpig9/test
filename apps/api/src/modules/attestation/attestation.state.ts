import type { DisputeStatus } from '@commonhours/shared';
import type { Machine } from '../../core/state-machine';

/**
 * Dispute lifecycle (one state machine, enforced by core/state-machine).
 *   AWAITING_ATTESTATION (one attestor) → RESOLVED | PANEL_REVIEW (attestor said "unclear") | NEEDS_REVIEW
 *   PANEL_REVIEW (three attestors)     → RESOLVED | NEEDS_REVIEW
 *   NEEDS_REVIEW (blocked; credits stay frozen) → AWAITING_ATTESTATION | PANEL_REVIEW (retry selection) | RESOLVED (mutual agreement only)
 * The system never silently picks a winner from NEEDS_REVIEW.
 */
export const disputeMachine: Machine<DisputeStatus> = {
  name: 'dispute',
  module: 'attestation',
  transitions: {
    AWAITING_ATTESTATION: ['RESOLVED', 'PANEL_REVIEW', 'NEEDS_REVIEW'],
    PANEL_REVIEW: ['RESOLVED', 'NEEDS_REVIEW'],
    NEEDS_REVIEW: ['AWAITING_ATTESTATION', 'PANEL_REVIEW', 'RESOLVED'],
    RESOLVED: [],
  },
  describe: {
    AWAITING_ATTESTATION: 'waiting for the selected attestor',
    PANEL_REVIEW: 'waiting for the panel of three',
    NEEDS_REVIEW: 'blocked — see the explanation and next action',
    RESOLVED: 'final',
  },
};
