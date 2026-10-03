// One-off for databases created before earned trust existed: replays every exchange that both
// parties confirmed in full, oldest first, through the same rule used at settlement time.
// Safe to run more than once — TrustUpdate is unique per exchange, so nothing is applied twice.
//   npx tsx scripts/backfill-earned-trust.ts
import { makeCtx } from '../src/core/context';
import { prisma, withTx } from '../src/core/db';
import { recordEarnedTrust } from '../src/modules/trust/trust.earned';

const rows = await prisma.exchange.findMany({
  where: { status: 'SETTLED', dispute: null, partialAmount: null, providerConfirmedAt: { not: null }, recipientConfirmedAt: { not: null }, trustUpdate: null },
  orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
});
let applied = 0;
for (const ex of rows) {
  // Historic domain time = settlement time, so decay and the pair window replay as they would have.
  const u = await withTx((tx) => recordEarnedTrust(tx, makeCtx(null, ex.settledAt ?? ex.updatedAt, `backfill-${ex.id}`), ex));
  if (u.applied) applied++;
}
console.log(`Replayed ${rows.length} confirmed exchange(s); ${applied} increased an earned relationship.`);
await prisma.$disconnect();
