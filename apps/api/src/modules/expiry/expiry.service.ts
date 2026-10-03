import { formatCredits } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { lockRow, type Tx, type Db } from '../../core/db';
import { memberAccount, postedBalance, reservationTotals, systemAccount } from '../ledger/ledger.repo';
import { postTransfer } from '../ledger/ledger.service';
import { expirableAmount } from './expiry.rules';

/**
 * Runs the credit-expiry sweep for every member. Each expiry is an explicit, balanced ledger
 * transaction: member −x, Community Credit Pool +x, with an explanation. The expiry duration is
 * unchanged (POLICY.credits.lotExpiryMonths).
 *
 * Exactly once: the member's account row is locked and the expired lots are consumed in the same
 * transaction, so a retry or a concurrent sweep finds nothing left to expire. Only positive lots can
 * expire (spent credits and negative balances have no lots), and units backing ACTIVE or FROZEN
 * (disputed) reservations are protected by `expirableAmount`.
 */
export async function runCreditExpiry(tx: Tx, ctx: Ctx) {
  const sys = await systemAccount(tx, 'SYSTEM_COMMUNITY_POOL');
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
      // Unique per member and state of their lots: the same expiry can never be posted twice.
      idempotencyKey: `expiry:${m.id}:${ctx.now.toISOString()}:${lots.map((l) => `${l.id}=${l.remaining}`).sort().join(',')}`,
      fromMemberId: m.id,
      toAccountId: sys.id,
      amount,
      explanation: `${formatCredits(amount)} credit(s) earned more than ${POLICY.credits.lotExpiryMonths} months ago expired into the Community Credit Pool (posted balance ${formatCredits(posted)} → ${formatCredits(posted - amount)}). Credits backing open reservations were protected.`,
      ruleId: RULES.EXPIRY_TO_POOL,
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
