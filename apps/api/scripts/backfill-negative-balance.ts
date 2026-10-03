// One-off after the community-pool migration: opens a NegativeBalancePeriod for every member whose
// posted balance is negative, with negativeSince reconstructed from ledger history (or "now" when
// no history explains it), and closes stale ones. The daily job does the same on every run, so this
// is only needed to see the periods before the first run. Idempotent.
//   npx tsx scripts/backfill-negative-balance.ts
import { makeCtx, readClock } from '../src/core/context';
import { prisma, withTx } from '../src/core/db';
import { syncNegativePeriods } from '../src/modules/negative-balance/negative-balance.service';

const now = await readClock(prisma);
const r = await withTx((tx) => syncNegativePeriods(tx, makeCtx(null, now, `backfill-negative-${now.toISOString()}`)));
console.log(`Negative-balance periods: ${r.opened} opened (reconstructed), ${r.closed} closed.`);
await prisma.$disconnect();
