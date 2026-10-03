import type { Db } from '../../core/db';
import type { ScoredExchange } from './activity.rules';

/**
 * Qualifying exchanges for activity points: SETTLED (valid, confirmed and paid — mutual confirmation,
 * an agreed partial completion, or a dispute RESOLVED as confirmed) with a positive settled amount,
 * settled inside [from, to). Cancelled, declined, released (refuted) and still-disputed exchanges are
 * never SETTLED, so they never appear here. Pool rewards are ledger transfers, not exchanges.
 */
export async function loadQualifyingExchanges(db: Db, from: Date, to: Date): Promise<ScoredExchange[]> {
  const rows = await db.exchange.findMany({
    where: {
      status: 'SETTLED',
      settledAt: { gte: from, lt: to },
      settledAmount: { gt: 0 },
      OR: [{ dispute: null }, { dispute: { status: 'RESOLVED', outcome: 'CONFIRMED' } }],
    },
    select: { id: true, providerId: true, recipientId: true, settledAt: true },
    orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({ id: r.id, providerId: r.providerId, recipientId: r.recipientId, settledAt: r.settledAt! }));
}
