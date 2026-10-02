import type { AuditEventView, TimelineEntry } from '@commonhours/shared';
import type { Db } from '../../core/db';
import { toSummary } from '../members/member.repo';

const include = { actor: true } as const;

export async function listAudit(
  db: Db,
  filter: { entityType?: string; entityId?: string; actorId?: string; involvingMemberId?: string; limit?: number },
): Promise<AuditEventView[]> {
  const where: Record<string, unknown> = {};
  if (filter.entityType) where.entityType = filter.entityType;
  if (filter.entityId) where.entityId = filter.entityId;
  if (filter.actorId) where.actorId = filter.actorId;
  if (filter.involvingMemberId) {
    // Events the member performed, or events about entities the member is part of.
    const id = filter.involvingMemberId;
    const [exchanges, vouches, disputes] = await Promise.all([
      db.exchange.findMany({ where: { OR: [{ providerId: id }, { recipientId: id }] }, select: { id: true } }),
      db.vouch.findMany({ where: { OR: [{ voucherId: id }, { voucheeId: id }] }, select: { id: true } }),
      db.dispute.findMany({
        where: { OR: [{ exchange: { providerId: id } }, { exchange: { recipientId: id } }, { assignments: { some: { attestorId: id } } }] },
        select: { id: true },
      }),
    ]);
    const reservations = await db.reservation.findMany({ where: { OR: [{ payerId: id }, { payeeId: id }] }, select: { id: true } });
    const ids = [id, ...exchanges.map((x) => x.id), ...vouches.map((x) => x.id), ...disputes.map((x) => x.id), ...reservations.map((r) => r.id)];
    where.OR = [{ actorId: id }, { entityId: { in: ids } }];
  }
  const rows = await db.auditEvent.findMany({ where, include, orderBy: [{ occurredAt: 'desc' }, { seq: 'desc' }], take: filter.limit ?? 200 });
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    recordedAt: r.recordedAt.toISOString(),
    actor: r.actor ? toSummary(r.actor) : null,
    module: r.module,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    before: r.before,
    after: r.after,
    reason: r.reason,
    ruleId: r.ruleId,
    policyVersion: r.policyVersion,
    correlationId: r.correlationId,
    summary: r.summary,
  }));
}

/** Timeline for one or more entities (e.g. an exchange plus its reservation and dispute). */
export async function timelineFor(db: Db, entityIds: string[]): Promise<TimelineEntry[]> {
  const rows = await db.auditEvent.findMany({
    where: { entityId: { in: entityIds } },
    include,
    orderBy: [{ occurredAt: 'asc' }, { seq: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.occurredAt.toISOString(),
    actor: r.actor?.displayName ?? null,
    action: r.action,
    summary: r.summary,
    module: r.module,
  }));
}
