import type { LedgerTxKind, Reservation } from '@prisma/client';
import { formatCredits, type CreditSummary, type LedgerEntryView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { addMonths, addDays } from '../../core/dates';
import { lockRow, type Db, type Tx } from '../../core/db';
import { AppError, notFound } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { onPostedBalanceChange } from '../negative-balance/negative-balance.tracker';
import { memberAccount, postedBalance, reservationTotals } from './ledger.repo';
import { floorCheck, newLotAmount, planLotConsumption } from './ledger.rules';

const MODULE = 'ledger';
const KIND_LABEL: Record<LedgerTxKind, string> = { SETTLEMENT: 'Settlement', EXPIRY: 'Expiry', ADJUSTMENT: 'Adjustment', POOL_DISTRIBUTION: 'Community pool reward' };
const c = formatCredits;

/**
 * The ledger owns ALL credit state: accounts, balanced transactions, reservations and lots.
 * Other modules call these functions; they never write ledger tables directly.
 */

function resView(r: Reservation) {
  return { status: r.status, amount: r.amount, giftBonus: r.giftBonus, total: r.amount + r.giftBonus };
}

/**
 * Reserve credits for an accepted exchange. Locks the payer's account row so concurrent
 * acceptances for the same payer are serialized and cannot jointly bypass the floor.
 */
export async function reserveCredits(
  tx: Tx,
  ctx: Ctx,
  p: { exchangeId: string; payerId: string; payeeId: string; amount: number; giftBonus: number; payerName: string },
) {
  const acct = await memberAccount(tx, p.payerId);
  await lockRow(tx, 'LedgerAccount', acct.id);
  const posted = await postedBalance(tx, acct.id);
  const totals = await reservationTotals(tx, p.payerId);
  const reserved = totals.outActive + totals.outFrozen;
  const total = p.amount + p.giftBonus;
  const chk = floorCheck(posted, reserved, total);
  if (!chk.allowed) {
    throw new AppError(
      'CREDIT_FLOOR_EXCEEDED',
      `${p.payerName} cannot take on this exchange: available balance ${c(chk.available)} − ${c(total)} = ${c(chk.after)}, which is below the floor of ${c(chk.floor)}. ` +
        `(Posted ${c(posted)}, already reserved ${c(reserved)}.) Earn credits by providing a service, or reduce the duration or gift.`,
      MODULE,
      { posted, reserved, available: chk.available, requested: total, wouldBe: chk.after, floor: chk.floor },
    );
  }
  const r = await tx.reservation.create({
    data: {
      exchangeId: p.exchangeId,
      payerId: p.payerId,
      payeeId: p.payeeId,
      amount: p.amount,
      giftBonus: p.giftBonus,
      status: 'ACTIVE',
      createdAt: ctx.now,
      updatedAt: ctx.now,
    },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'reservation.created',
    entityType: 'RESERVATION',
    entityId: r.id,
    before: { available: chk.available },
    after: { ...resView(r), available: chk.after },
    reason: `Floor check: ${c(chk.available)} − ${c(total)} = ${c(chk.after)} ≥ ${c(chk.floor)}. A reservation reduces available balance but pays nobody yet.`,
    ruleId: RULES.LEDGER_RESERVE,
    summary: `Reserved ${c(total)} credit(s) from ${p.payerName} for exchange (available ${c(chk.available)} → ${c(chk.after)})`,
  });
  return r;
}

async function lockedReservation(tx: Tx, exchangeId: string) {
  const r0 = await tx.reservation.findUnique({ where: { exchangeId } });
  if (!r0) throw notFound(MODULE, 'Reservation');
  await lockRow(tx, 'Reservation', r0.id);
  return tx.reservation.findUniqueOrThrow({ where: { id: r0.id } });
}

/** Dispute opened: the reservation stays counted against the payer but is frozen until resolved. */
export async function freezeReservation(tx: Tx, ctx: Ctx, exchangeId: string, reason: string) {
  const r = await lockedReservation(tx, exchangeId);
  if (r.status !== 'ACTIVE') throw new AppError('INVALID_TRANSITION', `Reservation is ${r.status}; only ACTIVE reservations can be frozen.`, MODULE);
  const u = await tx.reservation.update({ where: { id: r.id }, data: { status: 'FROZEN', updatedAt: ctx.now } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'reservation.frozen',
    entityType: 'RESERVATION',
    entityId: r.id,
    before: resView(r),
    after: resView(u),
    reason,
    ruleId: RULES.LEDGER_FREEZE,
    summary: `Reservation of ${c(r.amount + r.giftBonus)} frozen pending dispute`,
  });
  return u;
}

/** Releases a reservation without payment (cancellation or refuted dispute). */
export async function releaseReservation(tx: Tx, ctx: Ctx, exchangeId: string, reason: string, ruleId: string = RULES.LEDGER_RELEASE) {
  const r = await lockedReservation(tx, exchangeId);
  if (r.status === 'RELEASED') throw new AppError('ALREADY_DONE', 'This reservation was already released.', MODULE, undefined, 409);
  if (r.status === 'SETTLED') throw new AppError('INVALID_TRANSITION', 'This reservation was already settled and cannot be released.', MODULE);
  const u = await tx.reservation.update({ where: { id: r.id }, data: { status: 'RELEASED', updatedAt: ctx.now, resolvedAt: ctx.now, resolutionNote: reason } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'reservation.released',
    entityType: 'RESERVATION',
    entityId: r.id,
    before: resView(r),
    after: resView(u),
    reason,
    ruleId,
    summary: `Reservation of ${c(r.amount + r.giftBonus)} released without payment`,
  });
  return u;
}

/**
 * Atomic settlement: one balanced transaction (debit recipient, credit provider), lot updates,
 * reservation SETTLED and audit — all in the caller's DB transaction.
 * Duplicate-proof: the reservation row is locked and must be ACTIVE/FROZEN, and the ledger
 * transaction has the unique idempotency key "settle:<exchangeId>".
 */
export async function settleReservation(tx: Tx, ctx: Ctx, exchangeId: string, opts: { amount?: number; explanation: string; ruleId?: string }) {
  const r = await lockedReservation(tx, exchangeId);
  if (r.status === 'SETTLED') throw new AppError('ALREADY_DONE', 'This exchange is already settled; nothing was paid twice.', MODULE, undefined, 409);
  if (r.status === 'RELEASED') throw new AppError('INVALID_TRANSITION', 'This reservation was released and cannot be settled.', MODULE);
  const full = r.amount + r.giftBonus;
  const pay = opts.amount ?? full;
  if (pay <= 0 || pay > full) throw new AppError('VALIDATION_FAILED', `Settlement amount must be between 0.01 and ${c(full)}.`, MODULE);
  const txRow = await postTransfer(tx, ctx, {
    kind: 'SETTLEMENT',
    idempotencyKey: `settle:${exchangeId}`,
    exchangeId,
    fromMemberId: r.payerId,
    toMemberId: r.payeeId,
    amount: pay,
    explanation: opts.explanation,
    ruleId: opts.ruleId ?? RULES.LEDGER_SETTLE,
  });
  const note = pay < full ? `Settled ${c(pay)} of ${c(full)}; remaining ${c(full - pay)} released.` : `Settled in full (${c(pay)}).`;
  const u = await tx.reservation.update({ where: { id: r.id }, data: { status: 'SETTLED', updatedAt: ctx.now, resolvedAt: ctx.now, resolutionNote: note } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'reservation.settled',
    entityType: 'RESERVATION',
    entityId: r.id,
    before: resView(r),
    after: { ...resView(u), paid: pay, ledgerTransactionId: txRow.id },
    reason: opts.explanation,
    ruleId: opts.ruleId ?? RULES.LEDGER_SETTLE,
    summary: note,
  });
  return { reservation: u, transaction: txRow, paid: pay };
}

/**
 * Posts a balanced two-entry transaction and maintains credit lots for member accounts.
 * Accounts are locked in id order to avoid deadlocks between concurrent transfers.
 */
export async function postTransfer(
  tx: Tx,
  ctx: Ctx,
  p: {
    kind: LedgerTxKind;
    idempotencyKey: string;
    exchangeId?: string;
    fromMemberId?: string;
    fromAccountId?: string;
    toMemberId?: string;
    toAccountId?: string;
    amount: number;
    explanation: string;
    ruleId: string;
  },
) {
  if (p.amount <= 0) throw new AppError('VALIDATION_FAILED', 'Transfer amount must be positive.', MODULE);
  const from = p.fromAccountId ?? (await memberAccount(tx, p.fromMemberId!)).id;
  const to = p.toAccountId ?? (await memberAccount(tx, p.toMemberId!)).id;
  for (const id of [from, to].sort()) await lockRow(tx, 'LedgerAccount', id);
  const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
  if (existing) throw new AppError('ALREADY_DONE', 'This ledger transaction was already posted.', MODULE, { idempotencyKey: p.idempotencyKey }, 409);

  const fromBefore = await postedBalance(tx, from);
  const toBefore = await postedBalance(tx, to);
  const txRow = await tx.ledgerTransaction.create({
    data: {
      kind: p.kind,
      idempotencyKey: p.idempotencyKey,
      exchangeId: p.exchangeId,
      explanation: p.explanation,
      ruleId: p.ruleId,
      policyVersion: POLICY.version,
      correlationId: ctx.correlationId,
      effectiveAt: ctx.now,
      entries: {
        create: [
          { accountId: from, amount: -p.amount, explanation: p.explanation, effectiveAt: ctx.now },
          { accountId: to, amount: p.amount, explanation: p.explanation, effectiveAt: ctx.now },
        ],
      },
    },
  });

  // Lots: debit side consumes oldest lots; credit side pays off debt first, remainder becomes a dated lot.
  if (p.fromMemberId) {
    const lots = await tx.creditLot.findMany({ where: { memberId: p.fromMemberId, remaining: { gt: 0 } } });
    for (const step of planLotConsumption(lots, fromBefore - p.amount)) {
      await tx.creditLot.update({ where: { id: step.id }, data: { remaining: { decrement: step.take } } });
    }
  }
  if (p.toMemberId) {
    const lotAmt = newLotAmount(toBefore, toBefore + p.amount);
    if (lotAmt > 0) {
      await tx.creditLot.create({
        data: {
          memberId: p.toMemberId,
          sourceTransactionId: txRow.id,
          earnedAt: ctx.now,
          expiresAt: addMonths(ctx.now, POLICY.credits.lotExpiryMonths),
          originalAmount: lotAmt,
          remaining: lotAmt,
        },
      });
    }
  }
  // Continuous negative-balance tracking: every posted change of a member balance, incl. pool rewards.
  if (p.fromMemberId) await onPostedBalanceChange(tx, ctx, p.fromMemberId, fromBefore, fromBefore - p.amount);
  if (p.toMemberId) await onPostedBalanceChange(tx, ctx, p.toMemberId, toBefore, toBefore + p.amount);
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: `ledger.${p.kind.toLowerCase()}`,
    entityType: 'LEDGER',
    entityId: txRow.id,
    before: { fromBalance: fromBefore, toBalance: toBefore },
    after: { fromBalance: fromBefore - p.amount, toBalance: toBefore + p.amount, amount: p.amount },
    reason: p.explanation,
    ruleId: p.ruleId,
    summary: `${KIND_LABEL[p.kind]}: ${c(p.amount)} credit(s) moved. ${p.explanation}`,
  });
  return txRow;
}

export async function creditSummary(db: Db, memberId: string, now: Date): Promise<CreditSummary> {
  const acct = await memberAccount(db, memberId);
  const posted = await postedBalance(db, acct.id);
  const t = await reservationTotals(db, memberId);
  const reservedOutgoing = t.outActive + t.outFrozen;
  const available = posted - reservedOutgoing;
  const reservations = await db.reservation.findMany({
    where: { OR: [{ payerId: memberId }, { payeeId: memberId }] },
    include: { exchange: { select: { deliverable: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const lots = await db.creditLot.findMany({ where: { memberId }, orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }] });
  // Reservations are notionally funded by the OLDEST lots (FIFO), so those units are protected from expiry.
  let protect = reservedOutgoing;
  const lotViews = lots.map((l) => {
    const p = Math.min(protect, l.remaining);
    protect -= p;
    return {
      id: l.id,
      earnedAt: l.earnedAt.toISOString(),
      expiresAt: l.expiresAt.toISOString(),
      originalAmount: l.originalAmount,
      remaining: l.remaining,
      expired: l.expiresAt.getTime() <= now.getTime(),
      protectedByReservation: p,
    };
  });
  const live = lotViews.filter((l) => l.remaining > 0 && !l.expired);
  const soon = live.filter((l) => new Date(l.expiresAt).getTime() <= addDays(now, 30).getTime()).reduce((s, l) => s + l.remaining, 0);
  return {
    memberId,
    posted,
    reservedOutgoing,
    available,
    pendingIncoming: t.inActive,
    disputedOutgoing: t.outFrozen,
    disputedIncoming: t.inFrozen,
    floor: POLICY.credits.floor,
    headroom: available - POLICY.credits.floor,
    explanation: {
      posted: `Sum of all posted ledger entries on your account = ${c(posted)}. Settlements, expiries and adjustments are the only things that change it.`,
      available: `Posted ${c(posted)} − reserved for accepted or disputed exchanges ${c(reservedOutgoing)} = ${c(available)}.`,
      floor: `You may commit to new exchanges while available balance stays ≥ ${c(POLICY.credits.floor)}. Headroom: ${c(available - POLICY.credits.floor)}.`,
    },
    reservations: reservations.map((r) => ({
      id: r.id,
      exchangeId: r.exchangeId,
      deliverable: r.exchange.deliverable,
      direction: r.payerId === memberId ? 'outgoing' : 'incoming',
      status: r.status,
      amount: r.amount,
      giftBonus: r.giftBonus,
      total: r.amount + r.giftBonus,
      payerId: r.payerId,
      payeeId: r.payeeId,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolutionNote: r.resolutionNote,
    })),
    lots: lotViews,
    expiry: {
      implemented: true,
      nextExpiryAt: live[0]?.expiresAt ?? null,
      expiringWithin30Days: soon,
      note: `Positive earned credits expire ${POLICY.credits.lotExpiryMonths} months after they were earned (oldest spent first) and move into the shared Community Credit Pool. Debts never expire. Credits backing an open reservation are protected until it resolves. Expiry runs in the daily job (00:00 Hong Kong time) and on demo clock advances.`,
    },
  };
}

export async function ledgerEntries(db: Db, memberId: string): Promise<LedgerEntryView[]> {
  const acct = await memberAccount(db, memberId);
  const entries = await db.ledgerEntry.findMany({
    where: { accountId: acct.id },
    include: { transaction: { include: { entries: { include: { account: { include: { member: true } } } } } } },
    orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
  });
  let running = 0;
  const out = entries.map((e) => {
    running += e.amount;
    const other = e.transaction.entries.find((x) => x.accountId !== acct.id);
    return {
      id: e.id,
      transactionId: e.transactionId,
      kind: e.transaction.kind,
      amount: e.amount,
      explanation: e.explanation,
      effectiveAt: e.effectiveAt.toISOString(),
      exchangeId: e.transaction.exchangeId,
      ruleId: e.transaction.ruleId,
      counterparty: other?.account.member?.displayName ?? other?.account.name ?? 'unknown',
      runningBalance: running,
    };
  });
  return out.reverse();
}
