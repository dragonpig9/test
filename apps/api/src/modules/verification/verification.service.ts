import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { getMember } from '../members/member.repo';

/**
 * Records that an account used the demo-mode verification bypass. Stored separately from genuine
 * verification (Member.demoAdmittedAt): it never sets studentEmailVerifiedAt / contactEmailVerifiedAt
 * and is never read to grant access, so it stops mattering the moment demo mode is switched off.
 * Idempotent: the first admission is kept.
 */
export async function recordDemoAdmission(tx: Tx, ctx: Ctx, memberId: string, reason: string) {
  const m = await getMember(tx, memberId);
  if (m.demoAdmittedAt) return m;
  const u = await tx.member.update({ where: { id: memberId }, data: { demoAdmittedAt: ctx.now, demoAdmissionReason: reason } });
  await recordAudit(tx, ctx, {
    module: 'verification',
    action: 'member.demo_admitted',
    entityType: 'MEMBER',
    entityId: memberId,
    before: { demoAdmittedAt: null },
    after: { demoAdmittedAt: ctx.now, studentEmailVerified: false },
    reason: `Demo mode bypassed a verification prerequisite (${reason}). This is not verification.`,
    ruleId: RULES.DEMO_ADMISSION,
    summary: `${m.displayName} was admitted through demo mode (${reason})`,
  });
  return u;
}
