import { isDemoMode } from '../../config/demo-mode';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { getMember } from '../members/member.repo';
import { universityAccessOf } from '../verification/verification.guards';
import { recordDemoAdmission } from '../verification/verification.service';
import { ensureRoom, openMemberships } from './circles.repo';
import { planCircleMembership } from './circles.rules';

/**
 * Brings a member's university-circle membership in line with their current access. Called after
 * registration (both routes), after student details change, after university email verification and
 * when the member opens Circles (so pending accounts and mode changes are picked up). Idempotent.
 *
 * Demo mode: the member joins their selected university's circle at once; the affiliation is recorded
 * as DEMO_SELF_DECLARED (and the account's demo admission is recorded). Normal mode: only a genuinely
 * verified university email gives access. A profile dropdown alone never does.
 *
 * Circle membership never touches vouches, earned relationships, credibility or friends.
 */
export async function syncCircleMembership(tx: Tx, ctx: Ctx, memberId: string, trigger: string) {
  const m = await getMember(tx, memberId);
  const access = universityAccessOf(m, isDemoMode());
  const open = await openMemberships(tx, memberId);
  const plan = planCircleMembership(
    open.map((o) => ({ id: o.id, university: o.room.universityCode, via: o.via })),
    access,
  );
  for (const c of plan.close) {
    const row = open.find((o) => o.id === c.id)!;
    await tx.circleMembership.update({ where: { id: c.id }, data: { leftAt: ctx.now, leftReason: c.reason } });
    await recordAudit(tx, ctx, {
      module: 'circles',
      action: 'circle.left',
      entityType: 'MEMBER',
      entityId: memberId,
      before: { circle: row.room.universityCode, via: row.via },
      after: { circle: null },
      reason: `${c.reason} Earlier messages stay in the circle; access to it ends.`,
      ruleId: RULES.CIRCLE_MEMBERSHIP,
      summary: `${m.displayName} left the ${row.room.name}`,
    });
  }
  if (plan.updateVia) {
    await tx.circleMembership.update({ where: { id: plan.updateVia.id }, data: { via: plan.updateVia.via } });
  }
  if (plan.open) {
    const room = await ensureRoom(tx, plan.open.university, ctx.now);
    await tx.circleMembership.create({ data: { roomId: room.id, memberId, via: plan.open.via, joinedAt: ctx.now } });
    if (plan.open.via === 'DEMO_SELF_DECLARED') await recordDemoAdmission(tx, ctx, memberId, `${room.name} via self-declared affiliation`);
    await recordAudit(tx, ctx, {
      module: 'circles',
      action: 'circle.joined',
      entityType: 'MEMBER',
      entityId: memberId,
      after: { circle: room.universityCode, via: plan.open.via },
      reason:
        plan.open.via === 'VERIFIED_EMAIL'
          ? 'University email genuinely verified.'
          : 'Demo mode: university affiliation is self-declared (not verified). No trust, credibility or friendship is created.',
      ruleId: RULES.CIRCLE_MEMBERSHIP,
      summary: `${m.displayName} joined the ${room.name} (${trigger})`,
    });
  }
  return { access, changed: plan.close.length > 0 || !!plan.open || !!plan.updateVia };
}
