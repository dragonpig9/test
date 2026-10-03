import type { Exchange, Member, Reservation } from '@prisma/client';
import type { ExchangeView } from '@commonhours/shared';
import type { Db } from '../../core/db';
import { notFound } from '../../core/errors';
import { toSummary } from '../members/member.repo';
import { pricingOf } from '../pricing/pricing.service';
import { availableActions, roleOf } from './exchange.rules';

export const exchangeInclude = { provider: true, recipient: true, proposer: true, reservation: true, dispute: { select: { id: true } } } as const;
type Full = Exchange & { provider: Member; recipient: Member; proposer: Member; reservation: Reservation | null; dispute: { id: string } | null };

export async function getExchange(db: Db, id: string): Promise<Full> {
  const ex = await db.exchange.findUnique({ where: { id }, include: exchangeInclude });
  if (!ex) throw notFound('exchanges', 'Exchange');
  return ex;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toExchangeView(ex: Full, viewerId: string, now: Date): ExchangeView {
  const r = ex.reservation;
  return {
    id: ex.id,
    status: ex.status,
    listingId: ex.listingId,
    linkedExchangeId: ex.linkedExchangeId,
    provider: toSummary(ex.provider),
    recipient: toSummary(ex.recipient),
    proposer: toSummary(ex.proposer),
    myRole: roleOf(ex, viewerId),
    deliverable: ex.deliverable,
    category: ex.category,
    durationMinutes: ex.durationMinutes,
    scheduledAt: ex.scheduledAt.toISOString(),
    location: ex.location,
    punctualityRequired: ex.punctualityRequired,
    creditAmount: ex.creditAmount,
    giftBonus: ex.giftBonus,
    cancellationNoticeHours: ex.cancellationNoticeHours,
    cancellationTerms: ex.cancellationTerms,
    confirmationDeadline: ex.confirmationDeadline.toISOString(),
    termsVersion: ex.termsVersion,
    providerAcceptedAt: iso(ex.providerAcceptedAt),
    recipientAcceptedAt: iso(ex.recipientAcceptedAt),
    acceptedAt: iso(ex.acceptedAt),
    providerConfirmedAt: iso(ex.providerConfirmedAt),
    recipientConfirmedAt: iso(ex.recipientConfirmedAt),
    settledAt: iso(ex.settledAt),
    settledAmount: ex.settledAmount,
    cancelRequestedById: ex.cancelRequestedById,
    partialAmount: ex.partialAmount,
    partialProposedById: ex.partialProposedById,
    partialNote: ex.partialNote,
    createdAt: ex.createdAt.toISOString(),
    trustTier: ex.trustTier,
    minCredibility: ex.minCredibility,
    minRelationshipTrust: ex.minRelationshipTrust,
    maxCreditBudget: ex.maxCreditBudget,
    homeAccess: {
      required: ex.trustTier === 'HIGH_TRUST',
      approved: !!ex.homeAccessApprovedAt && ex.homeAccessApprovedVersion === ex.termsVersion,
      approvedAt: iso(ex.homeAccessApprovedAt),
    },
    pricing: pricingOf(ex),
    priceLocked: !!ex.priceLockedAt || ex.acceptedAt !== null,
    reservation: r
      ? {
          id: r.id,
          status: r.status,
          amount: r.amount,
          giftBonus: r.giftBonus,
          total: r.amount + r.giftBonus,
          payerId: r.payerId,
          payeeId: r.payeeId,
          createdAt: r.createdAt.toISOString(),
          resolvedAt: iso(r.resolvedAt),
          resolutionNote: r.resolutionNote,
        }
      : null,
    disputeId: ex.dispute?.id ?? null,
    actions: availableActions(ex, viewerId, now, !!ex.dispute),
  };
}

export async function listExchangesFor(db: Db, memberId: string) {
  return db.exchange.findMany({
    where: { OR: [{ providerId: memberId }, { recipientId: memberId }] },
    include: exchangeInclude,
    orderBy: [{ scheduledAt: 'desc' }],
  });
}
