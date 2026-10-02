import type { Exchange, ExchangeStatus, Prisma } from '@prisma/client';
import { formatCredits, type ExchangeTermsInput, type ProposeExchangeInput } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { lockRow, type Tx } from '../../core/db';
import { AppError, forbidden } from '../../core/errors';
import { assertTransition } from '../../core/state-machine';
import { recordAudit } from '../audit/audit.service';
import { refreshCredibility, scoreOf } from '../credibility/credibility.service';
import { freezeReservation, releaseReservation, reserveCredits, settleReservation } from '../ledger/ledger.service';
import { assertCanCommit, getMember } from '../members/member.repo';
import { getListing } from '../services/listing.service';
import { isRestrictedCategory, listingRoles } from '../services/listing.rules';
import { liabilitySnapshot, recordQualifyingInteraction, strongestIncomingVouch } from '../vouches/vouch.service';
import { getExchange } from './exchange.repo';
import { exchangeMachine } from './exchange.state';
import { cancellationCutoff, confirmationDeadline, describeTerms, isDue, roleOf, standardCredits } from './exchange.rules';

const MODULE = 'exchanges';
const c = formatCredits;

function termsSnapshot(ex: Exchange) {
  return {
    deliverable: ex.deliverable,
    durationMinutes: ex.durationMinutes,
    scheduledAt: ex.scheduledAt,
    punctualityRequired: ex.punctualityRequired,
    creditAmount: ex.creditAmount,
    giftBonus: ex.giftBonus,
    cancellationNoticeHours: ex.cancellationNoticeHours,
    confirmationDeadline: ex.confirmationDeadline,
    termsVersion: ex.termsVersion,
    status: ex.status,
  };
}

/**
 * Moves an exchange between states through the shared state machine. The conditional update
 * (`where status = from`) makes concurrent duplicate requests harmless: only one can win.
 */
async function transition(
  tx: Tx,
  ctx: Ctx,
  ex: Exchange,
  to: ExchangeStatus,
  data: Prisma.ExchangeUpdateManyMutationInput,
  audit: { action: string; reason: string; ruleId: string; summary: string },
) {
  assertTransition(exchangeMachine, ex.status, to, audit.action.replace('exchange.', '').replace(/_/g, ' '));
  const r = await tx.exchange.updateMany({ where: { id: ex.id, status: ex.status }, data: { ...data, status: to, updatedAt: ctx.now } });
  if (r.count !== 1) throw new AppError('CONFLICT', 'This exchange changed while you were acting on it. Refresh and try again.', MODULE, undefined, 409);
  const updated = await tx.exchange.findUniqueOrThrow({ where: { id: ex.id } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: audit.action,
    entityType: 'EXCHANGE',
    entityId: ex.id,
    before: termsSnapshot(ex),
    after: termsSnapshot(updated),
    reason: audit.reason,
    ruleId: audit.ruleId,
    summary: audit.summary,
  });
  return updated;
}

async function lockedExchange(tx: Tx, id: string) {
  await lockRow(tx, 'Exchange', id);
  return getExchange(tx, id);
}

function assertParty(ex: Exchange, memberId: string) {
  if (roleOf(ex, memberId) === 'observer') throw forbidden(MODULE, 'Only the provider or recipient can act on this exchange.');
}

function validateTerms(ctx: Ctx, input: ExchangeTermsInput) {
  const scheduledAt = new Date(input.scheduledAt);
  if (scheduledAt.getTime() <= ctx.now.getTime()) {
    throw new AppError('SCHEDULE_IN_PAST', `The scheduled time must be after the current (simulated) time ${ctx.now.toISOString()}.`, MODULE);
  }
  if (input.giftBonus > POLICY.credits.maxGiftBonus) {
    throw new AppError('VALIDATION_FAILED', `Gift bonus is limited to ${c(POLICY.credits.maxGiftBonus)} credits.`, MODULE);
  }
  return scheduledAt;
}

/** Proposal = the proposer's acceptance of these exact terms (version 1). */
export async function proposeExchange(tx: Tx, ctx: Ctx, proposerId: string, input: ProposeExchangeInput) {
  const proposer = await assertCanCommit(tx, proposerId, MODULE);
  const other = await assertCanCommit(tx, input.counterpartyId, MODULE);
  if (proposerId === other.id) throw new AppError('VALIDATION_FAILED', 'You cannot exchange with yourself.', MODULE);
  const scheduledAt = validateTerms(ctx, input);
  let providerId = input.myRole === 'provider' ? proposerId : other.id;
  let recipientId = input.myRole === 'provider' ? other.id : proposerId;
  if (input.listingId) {
    const l = await getListing(tx, input.listingId);
    if (l.status !== 'OPEN') throw new AppError('INVALID_TRANSITION', 'This listing is no longer open.', MODULE);
    if (l.ownerId !== proposerId && l.ownerId !== other.id) throw new AppError('VALIDATION_FAILED', 'The listing must belong to one of the two parties.', MODULE);
    const roles = listingRoles(l.type, l.ownerId, l.ownerId === proposerId ? other.id : proposerId);
    providerId = roles.providerId;
    recipientId = roles.recipientId;
  }
  // Gift bonus is the recipient's voluntary choice; the provider cannot ask for one through the terms.
  if (input.giftBonus > 0 && recipientId !== proposerId) {
    throw new AppError('GIFT_ONLY_FROM_RECIPIENT', 'Only the person receiving the service can offer a gift bonus.', MODULE);
  }
  await assertProviderMayProvide(tx, ctx, providerId, input.category);
  if (input.linkedExchangeId) {
    const linked = await getExchange(tx, input.linkedExchangeId);
    const pair = new Set([linked.providerId, linked.recipientId]);
    if (!pair.has(providerId) || !pair.has(recipientId)) throw new AppError('VALIDATION_FAILED', 'A linked exchange must be between the same two members.', MODULE);
  }
  const ex = await tx.exchange.create({
    data: {
      listingId: input.listingId,
      linkedExchangeId: input.linkedExchangeId,
      providerId,
      recipientId,
      proposerId,
      deliverable: input.deliverable,
      category: input.category,
      durationMinutes: input.durationMinutes,
      scheduledAt,
      location: input.location,
      punctualityRequired: input.punctualityRequired,
      creditAmount: standardCredits(input.durationMinutes),
      giftBonus: input.giftBonus,
      cancellationNoticeHours: input.cancellationNoticeHours,
      cancellationTerms: input.cancellationTerms,
      confirmationDeadline: confirmationDeadline(scheduledAt, input.durationMinutes, input.confirmationDays),
      status: 'PROPOSED',
      providerAcceptedAt: providerId === proposerId ? ctx.now : null,
      recipientAcceptedAt: recipientId === proposerId ? ctx.now : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    },
  });
  if (input.linkedExchangeId) {
    await tx.exchange.updateMany({ where: { id: input.linkedExchangeId, linkedExchangeId: null }, data: { linkedExchangeId: ex.id } });
  }
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'exchange.proposed',
    entityType: 'EXCHANGE',
    entityId: ex.id,
    after: termsSnapshot(ex),
    reason: `Proposer accepted terms v1. ${describeTerms(ex)}`,
    ruleId: RULES.EXCHANGE_TERMS,
    summary: `${proposer.displayName} proposed: ${ex.deliverable} (${c(ex.creditAmount)} credit(s)${ex.giftBonus ? ` + ${c(ex.giftBonus)} gift` : ''})${input.linkedExchangeId ? ' — linked to a reciprocal exchange' : ''}`,
  });
  return ex;
}

async function assertProviderMayProvide(tx: Tx, ctx: Ctx, providerId: string, category: string) {
  if (!isRestrictedCategory(category)) return;
  const score = await scoreOf(tx, providerId, ctx.now);
  const th = POLICY.credibility.thresholds.restrictedCategory;
  if (score < th) {
    const p = await getMember(tx, providerId);
    throw new AppError(
      'CATEGORY_RESTRICTED',
      `${p.displayName} cannot provide "${category}" yet: it requires credibility ≥ ${th} (current ${score}). This is a community safeguard, not a qualification check.`,
      MODULE,
      { threshold: th, current: score },
    );
  }
}

/**
 * Changing terms before acceptance creates a new terms version. The editor accepts the new
 * version; the other party's acceptance is cleared, so nobody is bound to terms they did not see.
 */
export async function updateTerms(tx: Tx, ctx: Ctx, id: string, memberId: string, input: ExchangeTermsInput) {
  const ex = await lockedExchange(tx, id);
  assertParty(ex, memberId);
  await assertCanCommit(tx, memberId, MODULE);
  if (ex.status !== 'PROPOSED') {
    throw new AppError('INVALID_TRANSITION', `Terms can only change before acceptance. This exchange is ${ex.status}; no price changes after acceptance.`, MODULE);
  }
  const role = roleOf(ex, memberId);
  if (role === 'provider' && input.giftBonus !== ex.giftBonus) {
    throw new AppError('GIFT_ONLY_FROM_RECIPIENT', 'Only the recipient can set or change the gift bonus.', MODULE);
  }
  const scheduledAt = validateTerms(ctx, input);
  const updated = await tx.exchange.update({
    where: { id },
    data: {
      deliverable: input.deliverable,
      durationMinutes: input.durationMinutes,
      scheduledAt,
      location: input.location,
      punctualityRequired: input.punctualityRequired,
      creditAmount: standardCredits(input.durationMinutes),
      giftBonus: input.giftBonus,
      cancellationNoticeHours: input.cancellationNoticeHours,
      cancellationTerms: input.cancellationTerms,
      confirmationDeadline: confirmationDeadline(scheduledAt, input.durationMinutes, input.confirmationDays),
      termsVersion: { increment: 1 },
      providerAcceptedAt: role === 'provider' ? ctx.now : null,
      recipientAcceptedAt: role === 'recipient' ? ctx.now : null,
      updatedAt: ctx.now,
    },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'exchange.terms_changed',
    entityType: 'EXCHANGE',
    entityId: id,
    before: termsSnapshot(ex),
    after: termsSnapshot(updated),
    reason: `New terms version ${updated.termsVersion}; the other party must accept again. ${describeTerms(updated)}`,
    ruleId: RULES.EXCHANGE_TERMS,
    summary: `Terms updated to v${updated.termsVersion}`,
  });
  return updated;
}

export async function acceptExchange(tx: Tx, ctx: Ctx, id: string, memberId: string, termsVersion: number) {
  const ex = await lockedExchange(tx, id);
  assertParty(ex, memberId);
  if (ex.status === 'ACCEPTED') throw new AppError('ALREADY_DONE', 'This exchange is already accepted.', MODULE, undefined, 409);
  assertTransition(exchangeMachine, ex.status, 'ACCEPTED', 'accept');
  if (termsVersion !== ex.termsVersion) {
    throw new AppError('TERMS_VERSION_MISMATCH', `The terms changed (now version ${ex.termsVersion}). Review the latest terms before accepting.`, MODULE, {
      expected: ex.termsVersion,
      received: termsVersion,
    });
  }
  await assertCanCommit(tx, ex.providerId, MODULE);
  await assertCanCommit(tx, ex.recipientId, MODULE);
  const role = roleOf(ex, memberId);
  const providerAcceptedAt = role === 'provider' ? ctx.now : ex.providerAcceptedAt;
  const recipientAcceptedAt = role === 'recipient' ? ctx.now : ex.recipientAcceptedAt;
  if ((role === 'provider' && ex.providerAcceptedAt) || (role === 'recipient' && ex.recipientAcceptedAt)) {
    throw new AppError('ALREADY_DONE', 'You already accepted these terms; waiting for the other member.', MODULE, undefined, 409);
  }
  if (!providerAcceptedAt || !recipientAcceptedAt) {
    const u = await tx.exchange.update({ where: { id }, data: { providerAcceptedAt, recipientAcceptedAt, updatedAt: ctx.now } });
    await recordAudit(tx, ctx, {
      module: MODULE,
      action: 'exchange.terms_accepted',
      entityType: 'EXCHANGE',
      entityId: id,
      before: termsSnapshot(ex),
      after: termsSnapshot(u),
      reason: `Accepted terms v${ex.termsVersion}.`,
      ruleId: RULES.EXCHANGE_ACCEPT,
      summary: `${role} accepted terms v${ex.termsVersion}`,
    });
    return u;
  }
  await assertProviderMayProvide(tx, ctx, ex.providerId, ex.category);
  await assertGuarantor(tx, ctx, ex);
  // Reserve credits (credit-floor check under a row lock on the payer's account).
  await reserveCredits(tx, ctx, {
    exchangeId: id,
    payerId: ex.recipientId,
    payeeId: ex.providerId,
    amount: ex.creditAmount,
    giftBonus: ex.giftBonus,
    payerName: ex.recipient.displayName,
  });
  const snapshot = await liabilitySnapshot(tx, [ex.providerId, ex.recipientId], ctx.now);
  return transition(
    tx,
    ctx,
    ex,
    'ACCEPTED',
    { providerAcceptedAt, recipientAcceptedAt, acceptedAt: ctx.now, liabilitySnapshot: snapshot },
    {
      action: 'exchange.accepted',
      reason: `Both parties accepted terms v${ex.termsVersion}. ${describeTerms(ex)} Liability snapshot recorded for ${snapshot.length} direct vouch(es).`,
      ruleId: RULES.EXCHANGE_ACCEPT,
      summary: `Exchange accepted by both: ${ex.deliverable}`,
    },
  );
}

/** Guarantor rule: low-credibility providers need a strong incoming vouch for larger services. */
async function assertGuarantor(tx: Tx, ctx: Ctx, ex: Exchange & { provider: { displayName: string } }) {
  const total = ex.creditAmount + ex.giftBonus;
  if (total <= POLICY.credibility.guarantorFreeLimit) return;
  const score = await scoreOf(tx, ex.providerId, ctx.now);
  if (score >= POLICY.credibility.thresholds.guarantorBelow) return;
  const best = await strongestIncomingVouch(tx, ex.providerId, ctx.now);
  if (best && best.e.effectiveStrength >= POLICY.credibility.guarantorMinStrength) return;
  throw new AppError(
    'GUARANTOR_REQUIRED',
    `${ex.provider.displayName} has credibility ${score} (< ${POLICY.credibility.thresholds.guarantorBelow}) and this service is worth ${c(total)} credits (> ${c(POLICY.credibility.guarantorFreeLimit)}). ` +
      `A guarantor is required: an active incoming vouch with effective strength ≥ ${POLICY.credibility.guarantorMinStrength}.`,
    MODULE,
    { score, total },
  );
}

export async function declineOrWithdraw(tx: Tx, ctx: Ctx, id: string, memberId: string) {
  const ex = await lockedExchange(tx, id);
  assertParty(ex, memberId);
  const withdraw = ex.proposerId === memberId;
  return transition(tx, ctx, ex, withdraw ? 'WITHDRAWN' : 'DECLINED', { closedAt: ctx.now }, {
    action: withdraw ? 'exchange.withdrawn' : 'exchange.declined',
    reason: withdraw ? 'Proposer withdrew before acceptance.' : 'Counterparty declined the proposal.',
    ruleId: RULES.EXCHANGE_TERMS,
    summary: withdraw ? 'Proposal withdrawn' : 'Proposal declined',
  });
}

/**
 * Settles an exchange: ledger transfer + status SETTLED + vouch interaction refresh +
 * credibility refresh, all inside the caller's transaction.
 */
async function settle(tx: Tx, ctx: Ctx, ex: Exchange, opts: { amount?: number; via: string; data?: Prisma.ExchangeUpdateManyMutationInput; ruleId: string }) {
  const { paid } = await settleReservation(tx, ctx, ex.id, {
    amount: opts.amount,
    explanation: `Exchange "${ex.deliverable}" settled (${opts.via}): recipient pays provider.`,
    ruleId: opts.ruleId,
  });
  const updated = await transition(tx, ctx, ex, 'SETTLED', { ...opts.data, settledAt: ctx.now, settledAmount: paid, closedAt: ctx.now }, {
    action: 'exchange.settled',
    reason: `Settled via ${opts.via}; ${c(paid)} credit(s) moved from recipient to provider.`,
    ruleId: opts.ruleId,
    summary: `Settled: ${c(paid)} credit(s) paid (${opts.via})`,
  });
  await recordQualifyingInteraction(tx, ctx, ex.providerId, ex.recipientId, ex.id);
  await refreshCredibility(tx, ctx, [ex.providerId, ex.recipientId], `exchange settled (${opts.via})`);
  return updated;
}

export async function confirmCompletion(tx: Tx, ctx: Ctx, id: string, memberId: string) {
  const ex = await lockedExchange(tx, id);
  assertParty(ex, memberId);
  if (ex.status === 'SETTLED') throw new AppError('ALREADY_DONE', 'This exchange is already settled; nothing was paid twice.', MODULE, undefined, 409);
  if (ex.status !== 'ACCEPTED') {
    throw new AppError('INVALID_TRANSITION', `Completion can only be confirmed while the exchange is ACCEPTED (it is ${ex.status}).`, MODULE);
  }
  if (!isDue(ex, ctx.now)) {
    throw new AppError('SERVICE_NOT_YET_DUE', `The service is scheduled for ${ex.scheduledAt.toISOString()}; confirm completion after it has happened (current time ${ctx.now.toISOString()}).`, MODULE);
  }
  const role = roleOf(ex, memberId);
  const mine = role === 'provider' ? ex.providerConfirmedAt : ex.recipientConfirmedAt;
  if (mine) throw new AppError('ALREADY_DONE', 'You already confirmed completion; waiting for the other member.', MODULE, undefined, 409);
  const data = role === 'provider' ? { providerConfirmedAt: ctx.now } : { recipientConfirmedAt: ctx.now };
  const both = role === 'provider' ? !!ex.recipientConfirmedAt : !!ex.providerConfirmedAt;
  if (!both) {
    const u = await tx.exchange.update({ where: { id }, data: { ...data, updatedAt: ctx.now } });
    await recordAudit(tx, ctx, {
      module: MODULE,
      action: 'exchange.confirmed',
      entityType: 'EXCHANGE',
      entityId: id,
      before: { providerConfirmedAt: ex.providerConfirmedAt, recipientConfirmedAt: ex.recipientConfirmedAt },
      after: { providerConfirmedAt: u.providerConfirmedAt, recipientConfirmedAt: u.recipientConfirmedAt },
      reason: `${role} confirmed the agreed activity happened.`,
      ruleId: RULES.EXCHANGE_CONFIRM,
      summary: `${role === 'provider' ? ex.provider.displayName : ex.recipient.displayName} confirmed completion`,
    });
    return u;
  }
  return settle(tx, ctx, ex, { via: 'mutual confirmation', data, ruleId: RULES.LEDGER_SETTLE });
}

/**
 * Cancellation terms: free unilateral cancellation until scheduledAt − notice hours.
 * After that, cancellation needs both parties (first request + counterparty agreement).
 */
export async function cancelExchange(tx: Tx, ctx: Ctx, id: string, memberId: string, reason: string) {
  const ex = await lockedExchange(tx, id);
  assertParty(ex, memberId);
  assertTransition(exchangeMachine, ex.status, 'CANCELLED', 'cancel');
  const cutoff = cancellationCutoff(ex);
  const free = ctx.now.getTime() <= cutoff.getTime();
  const agreeing = ex.cancelRequestedById && ex.cancelRequestedById !== memberId;
  if (!free && !agreeing) {
    if (ex.cancelRequestedById === memberId) throw new AppError('ALREADY_DONE', 'You already requested cancellation.', MODULE, undefined, 409);
    const u = await tx.exchange.update({ where: { id }, data: { cancelRequestedById: memberId, cancelRequestedAt: ctx.now, cancelReason: reason, updatedAt: ctx.now } });
    await recordAudit(tx, ctx, {
      module: MODULE,
      action: 'exchange.cancel_requested',
      entityType: 'EXCHANGE',
      entityId: id,
      after: { cancelRequestedById: memberId, reason },
      reason: `Free cancellation window closed at ${cutoff.toISOString()}; the other member must agree.`,
      ruleId: RULES.EXCHANGE_CANCEL,
      summary: 'Late cancellation requested; waiting for the other member',
    });
    return u;
  }
  await releaseReservation(tx, ctx, id, `Exchange cancelled (${free ? 'within free cancellation window' : 'by mutual agreement'}): ${reason}`, RULES.EXCHANGE_CANCEL);
  return transition(tx, ctx, ex, 'CANCELLED', { closedAt: ctx.now, cancelReason: ex.cancelReason ?? reason }, {
    action: 'exchange.cancelled',
    reason: free ? `Cancelled before the notice cutoff (${cutoff.toISOString()}).` : 'Both parties agreed to a late cancellation.',
    ruleId: RULES.EXCHANGE_CANCEL,
    summary: 'Exchange cancelled; reservation released',
  });
}

/** Partial completion: one party proposes a reduced amount, the other accepts; the rest is released. */
export async function proposePartial(tx: Tx, ctx: Ctx, id: string, memberId: string, amount: number, note: string) {
  const ex = await lockedExchange(tx, id);
  assertParty(ex, memberId);
  if (ex.status !== 'ACCEPTED') throw new AppError('INVALID_TRANSITION', `Partial completion needs an ACCEPTED exchange (it is ${ex.status}).`, MODULE);
  if (!isDue(ex, ctx.now)) throw new AppError('SERVICE_NOT_YET_DUE', 'Partial completion can be proposed after the scheduled time.', MODULE);
  const full = ex.creditAmount + ex.giftBonus;
  if (amount <= 0 || amount >= full) throw new AppError('VALIDATION_FAILED', `Partial amount must be more than 0 and less than ${c(full)}.`, MODULE);
  const u = await tx.exchange.update({ where: { id }, data: { partialAmount: amount, partialProposedById: memberId, partialNote: note, updatedAt: ctx.now } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'exchange.partial_proposed',
    entityType: 'EXCHANGE',
    entityId: id,
    after: { partialAmount: amount, note },
    reason: 'Partial completion requires the other party to agree.',
    ruleId: RULES.EXCHANGE_PARTIAL,
    summary: `Partial completion proposed: ${c(amount)} of ${c(full)}`,
  });
  return u;
}

export async function acceptPartial(tx: Tx, ctx: Ctx, id: string, memberId: string) {
  const ex = await lockedExchange(tx, id);
  assertParty(ex, memberId);
  if (ex.status !== 'ACCEPTED' || !ex.partialAmount || !ex.partialProposedById) {
    throw new AppError('INVALID_TRANSITION', 'There is no pending partial-completion proposal.', MODULE);
  }
  if (ex.partialProposedById === memberId) throw forbidden(MODULE, 'The other member must accept your partial-completion proposal.');
  return settle(tx, ctx, ex, {
    amount: ex.partialAmount,
    via: 'agreed partial completion',
    data: { providerConfirmedAt: ex.providerConfirmedAt ?? ctx.now, recipientConfirmedAt: ex.recipientConfirmedAt ?? ctx.now },
    ruleId: RULES.EXCHANGE_PARTIAL,
  });
}

// ───── functions the attestation module calls (it never writes exchange rows itself) ─────

export async function markDisputed(tx: Tx, ctx: Ctx, id: string, reason: string) {
  const ex = await lockedExchange(tx, id);
  const u = await transition(tx, ctx, ex, 'DISPUTED', {}, {
    action: 'exchange.disputed',
    reason,
    ruleId: RULES.DISPUTE_OPEN,
    summary: 'Exchange disputed; reservation frozen',
  });
  await freezeReservation(tx, ctx, id, reason);
  return u;
}

export async function settleAfterAttestation(tx: Tx, ctx: Ctx, id: string, via: string) {
  const ex = await lockedExchange(tx, id);
  return settle(tx, ctx, ex, { via, ruleId: RULES.DISPUTE_RESOLVE });
}

export async function releaseAfterAttestation(tx: Tx, ctx: Ctx, id: string, via: string) {
  const ex = await lockedExchange(tx, id);
  await releaseReservation(tx, ctx, id, `Agreed activity found not to have occurred (${via}); reservation released without payment.`, RULES.DISPUTE_RESOLVE);
  const u = await transition(tx, ctx, ex, 'RELEASED', { closedAt: ctx.now }, {
    action: 'exchange.released',
    reason: `Refuted (${via}); no credits moved.`,
    ruleId: RULES.DISPUTE_RESOLVE,
    summary: 'Reservation released without payment',
  });
  await refreshCredibility(tx, ctx, [ex.providerId, ex.recipientId], `exchange released (${via})`);
  return u;
}

/** Used when a member leaves: proposals not yet accepted are withdrawn/declined. Accepted ones remain. */
export async function closePendingProposalsFor(tx: Tx, ctx: Ctx, memberId: string) {
  const pending = await tx.exchange.findMany({ where: { status: 'PROPOSED', OR: [{ providerId: memberId }, { recipientId: memberId }] } });
  for (const ex of pending) await declineOrWithdraw(tx, ctx, ex.id, memberId);
  return pending.length;
}
