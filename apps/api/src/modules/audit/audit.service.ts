import { Prisma } from '@prisma/client';
import { POLICY } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Tx } from '../../core/db';

export interface AuditInput {
  module: string;
  action: string;
  entityType: 'MEMBER' | 'INVITATION' | 'VOUCH' | 'LISTING' | 'EXCHANGE' | 'RESERVATION' | 'LEDGER' | 'CREDIBILITY' | 'DISPUTE' | 'SYSTEM';
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason: string;
  ruleId: string;
  /** Human readable sentence for the Activity page. */
  summary: string;
}

function json(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === undefined || v === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

/**
 * Writes a domain audit event. MUST be called with the same `tx` as the business change
 * so the audit row and the change commit (or roll back) together.
 */
export async function recordAudit(tx: Tx, ctx: Ctx, e: AuditInput) {
  return tx.auditEvent.create({
    data: {
      occurredAt: ctx.now,
      actorId: ctx.actorId,
      module: e.module,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: json(e.before),
      after: json(e.after),
      reason: e.reason,
      ruleId: e.ruleId,
      policyVersion: POLICY.version,
      correlationId: ctx.correlationId,
      summary: e.summary,
    },
  });
}
