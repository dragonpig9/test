import type { PoolDistribution } from '@prisma/client';
import { formatCredits, type PoolDistributionView } from '@commonhours/shared';
import { POLICY } from '../../config/policy';
import type { Db } from '../../core/db';
import { dayKeysBetween } from '../../core/timezone';
import { postedBalance } from '../ledger/ledger.repo';

/** Read-side helpers for the pool (writes go through community-pool.service + the ledger). */

export async function poolAccountId(db: Db): Promise<string | null> {
  return (await db.ledgerAccount.findFirst({ where: { type: 'SYSTEM_COMMUNITY_POOL' }, select: { id: true } }))?.id ?? null;
}

export async function poolBalance(db: Db): Promise<number> {
  const id = await poolAccountId(db);
  return id ? postedBalance(db, id) : 0;
}

export function toDistributionView(d: PoolDistribution): PoolDistributionView {
  const c = formatCredits;
  const explanation =
    d.status === 'PAID'
      ? `Pool ${c(d.poolBefore)} ÷ ${d.recipientCount} recipient(s) = ${c(d.paymentPerRecipient)} each (rounded down to 0.01). Paid ${c(d.paymentPerRecipient)} × ${d.recipientCount} = ${c(d.totalPaid)}; retained ${c(d.poolBefore)} − ${c(d.totalPaid)} = ${c(d.remaining)}.`
      : d.status === 'RETAINED_NO_ACTIVE_USERS'
        ? `No eligible member had activity points, so the whole pool (${c(d.poolBefore)}) was retained.`
        : `The pool (${c(d.poolBefore)}) cannot pay 0.01 to each of ${d.recipientCount} recipient(s), so it was retained for a later distribution.`;
  return {
    runDate: d.runDate,
    status: d.status as PoolDistributionView['status'],
    poolBefore: d.poolBefore,
    activeUserCount: d.activeUserCount,
    recipientCount: d.recipientCount,
    paymentPerRecipient: d.paymentPerRecipient,
    totalPaid: d.totalPaid,
    remaining: d.remaining,
    window: { startDay: d.windowStart, endDay: d.windowEnd, days: dayKeysBetween(d.windowStart, d.windowEnd).length, timezone: POLICY.schedule.timezone },
    createdAt: d.createdAt.toISOString(),
    explanation,
  };
}
