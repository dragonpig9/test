import { randomUUID } from 'node:crypto';
import type { Db } from './db';

/**
 * Everything a service needs to know about "who/when/why" for a request.
 * `now` is the domain clock: the simulated demo clock when one is set, otherwise wall time.
 * Services never call `new Date()` for business decisions.
 */
export interface Ctx {
  correlationId: string;
  actorId: string | null;
  now: Date;
}

export async function readClock(db: Db): Promise<Date> {
  const s = await db.systemState.findUnique({ where: { id: 1 } });
  return s?.simulatedNow ?? new Date();
}

export function makeCtx(actorId: string | null, now: Date, correlationId?: string): Ctx {
  return { actorId, now, correlationId: correlationId ?? randomUUID() };
}
