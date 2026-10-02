import { randomUUID } from 'node:crypto';
import { formatCredits } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { lockRow, type Tx, type Db } from '../../core/db';
import { memberAccount, postedBalance, reservationTotals, systemAccount } from '../ledger/ledger.repo';
import { postTransfer } from '../ledger/ledger.service';
import { expirableAmount } from './expiry.rules';

/**
 * Runs the credit-expiry sweep for every member. Each expiry is an explicit, balanced
 * ledger transaction: member −x, "System: expired credits" +x, with an explanation.
 * Safe to run repeatedly: once lots are consumed there is nothing left to expire.
 */
export async function runCreditExpiry(tx: Tx, ctx: Ctx) {
  const sys = await systemAccount(tx, 'SYSTEM_EXPIRY');
  const members = await tx.member.findMany({ select: { id: true, displayName: true } });
  const results: { memberId: string; name: string; amount: number }[] = [];
  for (const m of members) {
    const acct = await memberAccount(tx, m.id);
    await lockRow(tx, 'LedgerAccount', acct.id);
    const lots = await tx.creditLot.findMany({ where: { memberId: m.id, remaining: { gt: 0 } } });
    if (!lots.length) continue;
    const t = await reservationTotals(tx, m.id);
    const amount = expirableAmount(lots, t.outActive + t.outFrozen, ctx.now);
    if (amount <= 0) continue;
    const posted = await postedBalance(tx, acct.id);
    await postTransfer(tx, ctx, {
      kind: 'EXPIRY',
      idempotencyKey: `expiry:${m.id}:${ctx.now.toISOString()}:${randomUUID()}`,
      fromMemberId: m.id,
      toAccountId: sys.id,
      amount,
      explanation: `${formatCredits(amount)} credit(s) earned more than ${POLICY.credits.lotExpiryMonths} months ago expired (posted balance ${formatCredits(posted)} → ${formatCredits(posted - amount)}). Credits backing open reservations were protected.`,
      ruleId: RULES.EXPIRY,
    });
    results.push({ memberId: m.id, name: m.displayName, amount });
  }
  return results;
}

export async function expiryPreview(db: Db, memberId: string, now: Date) {
  const lots = await db.creditLot.findMany({ where: { memberId, remaining: { gt: 0 } }, orderBy: { earnedAt: 'asc' } });
  const t = await reservationTotals(db, memberId);
  return { dueNow: expirableAmount(lots, t.outActive + t.outFrozen, now), lots: lots.length };
}
