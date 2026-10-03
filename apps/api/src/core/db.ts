import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ log: ['warn', 'error'] });

/** A Prisma client usable inside or outside a transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;

type AfterCommit = () => Promise<void>;
const pendingAfterCommit = new AsyncLocalStorage<AfterCommit[]>();

/**
 * Runs `fn` in one database transaction. Business changes and their audit events are
 * always written through the same `tx`, so either both persist or neither does.
 * Callbacks registered with `afterCommit` inside `fn` run only once the transaction has
 * committed; if it rolls back they are discarded.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const queue: AfterCommit[] = [];
  const result = await pendingAfterCommit.run(queue, () => prisma.$transaction(fn, { timeout: opts.timeoutMs ?? 20_000, maxWait: 10_000 }));
  for (const cb of queue) {
    // Side effects (notifications, email outbox) must never undo or fail a committed change.
    try {
      await cb();
    } catch (e) {
      console.error('[afterCommit] side effect failed (business change is already committed):', e);
    }
  }
  return result;
}

/**
 * Schedules work to run after the surrounding `withTx` commits. Outside a transaction it runs
 * immediately (still isolated from the caller's errors).
 */
export function afterCommit(cb: AfterCommit): void {
  const queue = pendingAfterCommit.getStore();
  if (queue) queue.push(cb);
  else void cb().catch((e) => console.error('[afterCommit] side effect failed:', e));
}

/** Row lock helper (SELECT … FOR UPDATE). Serializes concurrent writers on the same row. */
export async function lockRow(tx: Tx, table: 'Exchange' | 'LedgerAccount' | 'Reservation' | 'Dispute' | 'Member' | 'Vouch' | 'EarnedRelationship' | 'SkillClaim', id: string) {
  // Table names come from the closed union above, never from user input.
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}
