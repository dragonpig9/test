import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ log: ['warn', 'error'] });

/** A Prisma client usable inside or outside a transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` in one database transaction. Business changes and their audit events are
 * always written through the same `tx`, so either both persist or neither does.
 */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
}

/** Row lock helper (SELECT … FOR UPDATE). Serializes concurrent writers on the same row. */
export async function lockRow(tx: Tx, table: 'Exchange' | 'LedgerAccount' | 'Reservation' | 'Dispute' | 'Member' | 'Vouch', id: string) {
  // Table names come from the closed union above, never from user input.
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}
