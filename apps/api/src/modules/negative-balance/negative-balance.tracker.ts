import type { Ctx } from '../../core/context';
import type { Tx } from '../../core/db';
import { periodTransition } from './negative-balance.rules';

/**
 * Called by the ledger (postTransfer) for EVERY posted balance change of a member — settlements,
 * expiries, adjustments and pool rewards — inside the same transaction and under the account lock.
 * Kept free of other module imports so the ledger can depend on it without cycles.
 */
export async function onPostedBalanceChange(tx: Tx, ctx: Ctx, memberId: string, before: number, after: number) {
  const t = periodTransition(before, after);
  if (t === 'open') {
    const open = await tx.negativeBalancePeriod.findFirst({ where: { memberId, recoveredAt: null }, select: { id: true } });
    if (!open) await tx.negativeBalancePeriod.create({ data: { memberId, negativeSince: ctx.now, source: 'ledger', createdAt: ctx.now } });
  } else if (t === 'close') {
    await tx.negativeBalancePeriod.updateMany({ where: { memberId, recoveredAt: null }, data: { recoveredAt: ctx.now } });
  }
}
