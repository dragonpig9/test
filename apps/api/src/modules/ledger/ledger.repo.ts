import type { LedgerAccountType } from '@prisma/client';
import type { Db, Tx } from '../../core/db';

export async function ensureMemberAccount(tx: Tx, memberId: string, name: string) {
  return (
    (await tx.ledgerAccount.findUnique({ where: { memberId } })) ??
    tx.ledgerAccount.create({ data: { type: 'MEMBER', memberId, name: `Member: ${name}` } })
  );
}

export async function memberAccount(db: Db, memberId: string) {
  return db.ledgerAccount.findUniqueOrThrow({ where: { memberId } });
}

export async function systemAccount(tx: Tx, type: Exclude<LedgerAccountType, 'MEMBER'>) {
  const name =
    type === 'SYSTEM_EXPIRY' ? 'System: expired credits (legacy)' : type === 'SYSTEM_COMMUNITY_POOL' ? 'Community Credit Pool' : 'System: administrative adjustments';
  return (await tx.ledgerAccount.findFirst({ where: { type } })) ?? tx.ledgerAccount.create({ data: { type, name } });
}

export async function postedBalance(db: Db, accountId: string): Promise<number> {
  const r = await db.ledgerEntry.aggregate({ where: { accountId }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

export async function reservationTotals(db: Db, memberId: string) {
  const [outActive, outFrozen, inActive, inFrozen] = await Promise.all([
    db.reservation.aggregate({ where: { payerId: memberId, status: 'ACTIVE' }, _sum: { amount: true, giftBonus: true } }),
    db.reservation.aggregate({ where: { payerId: memberId, status: 'FROZEN' }, _sum: { amount: true, giftBonus: true } }),
    db.reservation.aggregate({ where: { payeeId: memberId, status: 'ACTIVE' }, _sum: { amount: true, giftBonus: true } }),
    db.reservation.aggregate({ where: { payeeId: memberId, status: 'FROZEN' }, _sum: { amount: true, giftBonus: true } }),
  ]);
  const t = (x: { _sum: { amount: number | null; giftBonus: number | null } }) => (x._sum.amount ?? 0) + (x._sum.giftBonus ?? 0);
  return { outActive: t(outActive), outFrozen: t(outFrozen), inActive: t(inActive), inFrozen: t(inFrozen) };
}
