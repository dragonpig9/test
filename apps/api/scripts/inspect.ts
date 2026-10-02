// Prints balances, scores, vouch edges and disputes for quick verification: `npx tsx scripts/inspect.ts`
import { prisma } from '../src/core/db';
import { readClock } from '../src/core/context';
import { creditSummary } from '../src/modules/ledger/ledger.service';
import { computeCredibility, permissionsOf } from '../src/modules/credibility/credibility.service';
import { findPath, loadTrust } from '../src/modules/trust/trust.service';
import { effectiveEdge } from '../src/modules/vouches/vouch.rules';

const now = await readClock(prisma);
console.log('now', now.toISOString());
const members = await prisma.member.findMany({ orderBy: { joinedAt: 'asc' } });
for (const m of members) {
  const s = await creditSummary(prisma, m.id, now);
  const c = await computeCredibility(prisma, m.id, now);
  const p = await permissionsOf(prisma, m.id, now, c.score);
  const lots = s.lots.reduce((a, l) => a + l.remaining, 0);
  console.log(
    m.handle.padEnd(6),
    `posted ${s.posted / 100}`.padEnd(12),
    `avail ${s.available / 100}`.padEnd(12),
    `lots ${lots / 100} ${lots === Math.max(0, s.posted) ? 'ok' : 'BAD'}`.padEnd(12),
    `score ${c.score}`.padEnd(11),
    c.factors.map((f) => `${f.key[0]}${f.points}`).join(' '),
    p.filter((x) => x.allowed).map((x) => x.key).join(','),
  );
}
const byH = (h: string) => members.find((m) => m.handle === h)!;
for (const v of await prisma.vouch.findMany({ include: { voucher: true, vouchee: true } })) {
  const e = effectiveEdge(v, now);
  console.log(`${v.voucher.handle}->${v.vouchee.handle} ${v.strength} ${v.status}/${e.status} eff ${e.effectiveStrength}`);
}
const t = await loadTrust(prisma, now);
console.log(findPath(t, byH('mei').id, byH('sam').id).explanation);
for (const d of await prisma.dispute.findMany({ include: { assignments: { include: { attestor: true } }, selections: true } })) {
  console.log('dispute', d.status, d.reviewReason, d.assignments.map((a) => `${a.attestor.handle}:${a.status}:${a.vote}`));
  for (const s of d.selections) console.log('  sel', s.round, s.stage, s.sufficient, JSON.stringify((s.candidates as any[]).filter((c) => c.eligible).map((c) => c.memberId.slice(-4))));
}
const sum = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
console.log('ledger sum', sum._sum.amount, 'audit events', await prisma.auditEvent.count());
await prisma.$disconnect();
