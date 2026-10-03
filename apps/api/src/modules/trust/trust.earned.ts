import type { EarnedRelationship, Member, TrustUpdate } from '@prisma/client';
import type { TrustUpdateView } from '@commonhours/shared';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { addDays } from '../../core/dates';
import { lockRow, type Db, type Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { toSummary } from '../members/member.repo';
import { notify } from '../notifications/notification.events';
import { nextEarnedStrength, pairKey } from './trust.earned.rules';
import { loadTrust, relationshipTrust } from './trust.service';

const MODULE = 'trust';

export function toTrustUpdateView(
  u: TrustUpdate & { relationship: EarnedRelationship & { memberA: Member; memberB: Member }; exchange?: { deliverable: string } | null },
): TrustUpdateView {
  return {
    id: u.id,
    relationshipId: u.relationshipId,
    exchangeId: u.exchangeId,
    exchangeDeliverable: u.exchange?.deliverable,
    members: [toSummary(u.relationship.memberA), toSummary(u.relationship.memberB)],
    previousStrength: u.previousStrength,
    newStrength: u.newStrength,
    applied: u.applied,
    reason: u.reason,
    relationshipTrustBefore: u.relationshipTrustBefore,
    relationshipTrustAfter: u.relationshipTrustAfter,
    ruleId: u.ruleId,
    createdAt: u.createdAt.toISOString(),
  };
}

export const trustUpdateInclude = { relationship: { include: { memberA: true, memberB: true } }, exchange: { select: { deliverable: true } } } as const;

/**
 * Applies the earned-trust increase for one exchange that both parties confirmed and that settled.
 * Exactly once: the TrustUpdate row is unique per exchange, so retries, repeated confirmations and
 * reloads find the existing row and change nothing. Runs inside the settlement transaction.
 */
export async function recordEarnedTrust(tx: Tx, ctx: Ctx, ex: { id: string; providerId: string; recipientId: string; deliverable: string }) {
  const existing = await tx.trustUpdate.findUnique({ where: { exchangeId: ex.id } });
  if (existing) return existing;
  const [a, b] = pairKey(ex.providerId, ex.recipientId);
  const before = relationshipTrust(await loadTrust(tx, ctx.now), a, b);
  // Create the pair row if needed without racing a concurrent settlement for the same pair.
  await tx.$executeRaw`INSERT INTO "EarnedRelationship" ("id", "memberAId", "memberBId", "strength", "countedExchanges", "createdAt", "lastExchangeAt", "updatedAt")
    VALUES (${`er_${ex.id}`}, ${a}, ${b}, 0, 0, ${ctx.now}, ${ctx.now}, ${ctx.now}) ON CONFLICT ("memberAId", "memberBId") DO NOTHING`;
  const row0 = await tx.earnedRelationship.findUniqueOrThrow({ where: { memberAId_memberBId: { memberAId: a, memberBId: b } } });
  await lockRow(tx, 'EarnedRelationship', row0.id);
  const row = await tx.earnedRelationship.findUniqueOrThrow({ where: { id: row0.id } });
  const isNew = row.countedExchanges === 0 && row.strength === 0;
  const countedInWindow = await tx.trustUpdate.count({
    where: { relationshipId: row.id, applied: true, createdAt: { gt: addDays(ctx.now, -POLICY.earnedTrust.windowDays) } },
  });
  const step = nextEarnedStrength(isNew ? null : row, countedInWindow, ctx.now);
  const updated = await tx.earnedRelationship.update({
    where: { id: row.id },
    data: {
      strength: step.newStrength,
      countedExchanges: step.applied ? { increment: 1 } : undefined,
      lastExchangeAt: ctx.now,
      updatedAt: ctx.now,
    },
    include: { memberA: true, memberB: true },
  });
  const after = relationshipTrust(await loadTrust(tx, ctx.now), a, b);
  const u = await tx.trustUpdate.create({
    data: {
      relationshipId: row.id,
      exchangeId: ex.id,
      previousStrength: step.previousStrength,
      newStrength: step.newStrength,
      applied: step.applied,
      reason: step.reason,
      relationshipTrustBefore: before,
      relationshipTrustAfter: after,
      ruleId: RULES.TRUST_EARNED,
      createdAt: ctx.now,
    },
  });
  const names = `${updated.memberA.displayName} ↔ ${updated.memberB.displayName}`;
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: step.applied ? 'trust.earned_increased' : 'trust.earned_unchanged',
    entityType: 'EXCHANGE',
    entityId: ex.id,
    before: { earnedStrength: step.previousStrength, relationshipTrust: before },
    after: { earnedStrength: step.newStrength, relationshipTrust: after, relationshipId: row.id, trustUpdateId: u.id },
    reason: step.reason,
    ruleId: RULES.TRUST_EARNED,
    summary: step.applied
      ? `Earned trust ${names}: ${step.previousStrength} → ${step.newStrength} (exchange “${ex.deliverable}”)`
      : `Earned trust ${names} unchanged at ${step.newStrength}: ${step.reason}`,
  });
  if (step.applied) {
    for (const [me, other] of [
      [updated.memberA, updated.memberB],
      [updated.memberB, updated.memberA],
    ]) {
      notify({
        memberId: me.id,
        kind: 'trust.changed',
        category: 'trust',
        title: `Your earned trust with ${other.displayName} grew to ${step.newStrength}`,
        body: `${step.previousStrength} → ${step.newStrength} after “${ex.deliverable}”. Relationship trust (strongest path) ${before ?? 0} → ${after ?? 0}. ${step.reason}`,
        link: `/exchanges/${ex.id}`,
        entityType: 'EXCHANGE',
        entityId: ex.id,
        dedupeKey: `trust.changed:${ex.id}:${me.id}`,
        at: ctx.now,
      });
    }
  }
  return u;
}

export async function trustUpdateForExchange(db: Db, exchangeId: string) {
  const u = await db.trustUpdate.findUnique({ where: { exchangeId }, include: trustUpdateInclude });
  return u ? toTrustUpdateView(u) : null;
}

export async function trustUpdatesFor(db: Db, opts: { memberId?: string; relationshipId?: string; limit?: number }) {
  const rows = await db.trustUpdate.findMany({
    where: {
      ...(opts.relationshipId ? { relationshipId: opts.relationshipId } : {}),
      ...(opts.memberId ? { relationship: { OR: [{ memberAId: opts.memberId }, { memberBId: opts.memberId }] } } : {}),
    },
    include: trustUpdateInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit ?? 50,
  });
  return rows.map(toTrustUpdateView);
}
