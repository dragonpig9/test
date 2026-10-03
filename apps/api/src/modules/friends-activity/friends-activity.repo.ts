import type { Db } from '../../core/db';
import { serviceUnitsOf, type ServiceTransfer } from './friends-activity.rules';

/**
 * Settled service-credit transfers posted in [from, to): SETTLEMENT ledger transactions of exchanges
 * (provider earns, recipient spends; gift excluded). Pool rewards (POOL_DISTRIBUTION), expiry and
 * administrative adjustments are not exchange settlements and are left out. An ADJUSTMENT linked to an
 * exchange that moves credits back from the provider to the recipient is a refund/reversal and counts
 * negative.
 */
export async function loadServiceTransfers(db: Db, from: Date, to: Date): Promise<ServiceTransfer[]> {
  const rows = await db.ledgerTransaction.findMany({
    where: { kind: { in: ['SETTLEMENT', 'ADJUSTMENT'] }, exchangeId: { not: null }, effectiveAt: { gte: from, lt: to } },
    select: { kind: true, exchangeId: true, entries: { select: { amount: true, account: { select: { memberId: true } } } } },
  });
  if (!rows.length) return [];
  const exchanges = await db.exchange.findMany({
    where: { id: { in: rows.map((r) => r.exchangeId!) } },
    select: { id: true, providerId: true, recipientId: true, creditAmount: true },
  });
  const byId = new Map(exchanges.map((e) => [e.id, e]));
  const out: ServiceTransfer[] = [];
  for (const r of rows) {
    const ex = byId.get(r.exchangeId!);
    if (!ex) continue;
    const toProvider = r.entries.find((e) => e.account.memberId === ex.providerId && e.amount > 0)?.amount ?? 0;
    const fromProvider = -(r.entries.find((e) => e.account.memberId === ex.providerId && e.amount < 0)?.amount ?? 0);
    if (r.kind === 'SETTLEMENT' && toProvider > 0) out.push({ providerId: ex.providerId, recipientId: ex.recipientId, units: serviceUnitsOf(toProvider, ex.creditAmount) });
    if (r.kind === 'ADJUSTMENT' && fromProvider > 0) out.push({ providerId: ex.providerId, recipientId: ex.recipientId, units: -serviceUnitsOf(fromProvider, ex.creditAmount) });
  }
  return out;
}

/** Earliest year anyone joined (for the year selector). */
export async function firstYear(db: Db): Promise<number | null> {
  const m = await db.member.findFirst({ orderBy: { joinedAt: 'asc' }, select: { joinedAt: true } });
  return m ? m.joinedAt.getUTCFullYear() : null;
}
