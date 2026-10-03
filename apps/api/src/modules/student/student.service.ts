import type { StudentDetailsInput } from '@commonhours/shared';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { getMember } from '../members/member.repo';
import { studentCodeDelivery } from './student.verification';
import { assertStudentEmailMatches, requiresReverification, toStudentStatusView } from './student.rules';

/**
 * Student account details: university, university email, verification state and the
 * current-student declaration. Used both at registration (invitations.joinWithInvitation) and
 * from the profile (existing members add or change details later).
 */
const MODULE = 'student';

export async function setStudentDetails(tx: Tx, ctx: Ctx, memberId: string, input: StudentDetailsInput) {
  const studentEmail = input.studentEmail.trim().toLowerCase();
  assertStudentEmailMatches(input.university, studentEmail);
  if (input.currentStudentDeclaration !== true) {
    throw new AppError('VALIDATION_FAILED', 'Confirm that you are currently enrolled at this university.', MODULE);
  }
  const m = await getMember(tx, memberId);
  const clash = await tx.member.findFirst({ where: { studentEmail, NOT: { id: memberId } }, select: { id: true } });
  if (clash) throw new AppError('CONFLICT', 'This university email is already linked to another CommonHours account.', MODULE, undefined, 409);

  const changed = requiresReverification(m, { university: input.university, studentEmail });
  const u = await tx.member.update({
    where: { id: memberId },
    data: {
      accountType: 'STUDENT',
      university: input.university,
      studentEmail,
      studentDeclaredAt: ctx.now,
      // A new university or address must be verified again; outstanding codes for the old address die too.
      ...(changed ? { studentEmailVerifiedAt: null, studentEmailVerifiedVia: null } : {}),
    },
  });
  if (changed) await tx.emailVerification.updateMany({ where: { memberId, purpose: 'student', consumedAt: null }, data: { consumedAt: ctx.now } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: changed ? 'student.details_set' : 'student.declaration_renewed',
    entityType: 'MEMBER',
    entityId: memberId,
    // Field names and the university only; the private address is not copied into the audit trail.
    before: { accountType: m.accountType, university: m.university, emailVerified: !!m.studentEmailVerifiedAt },
    after: { accountType: u.accountType, university: u.university, emailVerified: !!u.studentEmailVerifiedAt },
    reason: changed
      ? 'University or university email changed: email verification reset; current-student declaration recorded.'
      : 'Current-student declaration renewed; university email unchanged, verification kept.',
    ruleId: RULES.STUDENT_DETAILS,
    summary: `${m.displayName} ${changed ? 'set student details' : 'renewed the student declaration'} (${input.university})`,
  });
  return { member: u, verificationReset: changed };
}

export async function studentStatus(db: Db, memberId: string) {
  return toStudentStatusView(await getMember(db, memberId), studentCodeDelivery() === 'preview');
}
