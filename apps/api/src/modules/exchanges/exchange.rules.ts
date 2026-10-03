import type { Exchange } from '@prisma/client';
import { formatCredits } from '@commonhours/shared';
import { addDays, addHours } from '../../core/dates';

export function confirmationDeadline(scheduledAt: Date, durationMinutes: number, days: number): Date {
  return addDays(new Date(scheduledAt.getTime() + durationMinutes * 60_000), days);
}

/** Unilateral cancellation is free until `scheduledAt − cancellationNoticeHours`; later it needs the counterparty's agreement. */
export function cancellationCutoff(ex: Pick<Exchange, 'scheduledAt' | 'cancellationNoticeHours'>): Date {
  return addHours(ex.scheduledAt, -ex.cancellationNoticeHours);
}

export function isDue(ex: Pick<Exchange, 'scheduledAt'>, now: Date): boolean {
  return now.getTime() >= ex.scheduledAt.getTime();
}

export type Role = 'provider' | 'recipient' | 'observer';

export function roleOf(ex: Pick<Exchange, 'providerId' | 'recipientId'>, memberId: string): Role {
  return ex.providerId === memberId ? 'provider' : ex.recipientId === memberId ? 'recipient' : 'observer';
}

/**
 * Backend-computed actions with a reason for each blocked one. The UI only renders these;
 * it never re-implements the rules.
 */
export function availableActions(ex: Exchange, viewerId: string, now: Date, hasDispute: boolean) {
  const role = roleOf(ex, viewerId);
  const party = role !== 'observer';
  const out: { key: string; allowed: boolean; reason: string | null }[] = [];
  const add = (key: string, allowed: boolean, reason: string | null) => out.push({ key, allowed, reason: allowed ? null : reason });
  if (!party) return out;
  const myAccepted = role === 'provider' ? ex.providerAcceptedAt : ex.recipientAcceptedAt;
  const myConfirmed = role === 'provider' ? ex.providerConfirmedAt : ex.recipientConfirmedAt;
  const due = isDue(ex, now);
  if (ex.status === 'PROPOSED') {
    const otherAccepted = role === 'provider' ? ex.recipientAcceptedAt : ex.providerAcceptedAt;
    const approved = !!ex.homeAccessApprovedAt && ex.homeAccessApprovedVersion === ex.termsVersion;
    const needsApproval = ex.trustTier === 'HIGH_TRUST' && !approved;
    if (needsApproval && role === 'recipient') add('approveHomeAccess', true, null);
    if (!myAccepted && otherAccepted && needsApproval) {
      add('accept', false, role === 'recipient' ? 'Approve home access first: this high-trust task needs your explicit permission.' : 'Waiting for the owner to approve home access before the exchange can be accepted.');
    } else add('accept', !myAccepted, 'You already accepted this version of the terms; waiting for the other member.');
    add('editTerms', true, null);
    if (ex.proposerId === viewerId) add('withdraw', true, null);
    else add('decline', true, null);
  }
  if (ex.status === 'ACCEPTED') {
    add('confirm', due && !myConfirmed, myConfirmed ? 'You already confirmed completion.' : `Service is scheduled for ${ex.scheduledAt.toISOString()}; confirm after it happens.`);
    const cutoff = cancellationCutoff(ex);
    const free = now.getTime() <= cutoff.getTime();
    const otherRequested = ex.cancelRequestedById && ex.cancelRequestedById !== viewerId;
    add(
      'cancel',
      ex.cancelRequestedById !== viewerId,
      'You already asked to cancel; waiting for the other member to agree.',
    );
    if (!free && !otherRequested && ex.cancelRequestedById !== viewerId) {
      out[out.length - 1].reason = `Free cancellation ended at ${cutoff.toISOString()}; cancelling now sends a request the other member must agree to.`;
    }
    add('dispute', due && !hasDispute, hasDispute ? 'A dispute already exists.' : 'Disputes can be opened once the scheduled time has passed.');
    if (ex.partialProposedById && ex.partialProposedById !== viewerId) add('acceptPartial', true, null);
    else add('proposePartial', due && !ex.partialProposedById, ex.partialProposedById ? 'You already proposed a partial amount.' : 'Partial completion can be proposed after the scheduled time.');
  }
  return out;
}

export function describeTerms(ex: Pick<Exchange, 'creditAmount' | 'giftBonus' | 'durationMinutes' | 'punctualityRequired' | 'trustTier'>): string {
  return `${ex.durationMinutes} min → ${formatCredits(ex.creditAmount)} service credit(s)${ex.giftBonus ? ` + ${formatCredits(ex.giftBonus)} gift bonus` : ''}; punctuality ${ex.punctualityRequired ? 'IS' : 'is NOT'} an agreed condition; access level ${ex.trustTier.toLowerCase()}.`;
}
