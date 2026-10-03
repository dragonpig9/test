import bcrypt from 'bcryptjs';
import type { StudentJoinInput } from '@commonhours/shared';
import { isDemoMode } from '../../config/demo-mode';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { withTx, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { ensureMemberAccount } from '../ledger/ledger.repo';
import { setStudentDetails } from '../student/student.service';
import { requestStudentEmailCode } from '../student/student.verification';
import { recordDemoAdmission } from '../verification/verification.service';

/**
 * Onboarding: the two ways to join.
 *   1. "Join with an invitation" — modules/invitations (unchanged: the code must be valid in every mode).
 *   2. "Join as a student"       — joinAsStudent below: no invitation, no inviter, no vouch.
 * Both then call afterJoin, which either admits the account through demo mode or starts genuine
 * university email verification.
 */
const MODULE = 'onboarding';

export async function joinAsStudent(tx: Tx, ctx: Ctx, input: StudentJoinInput, opts: { passwordHash?: string } = {}) {
  if (!input.acceptCommunityTerms) throw new AppError('TERMS_NOT_ACCEPTED', 'You must accept the community terms to join.', MODULE);
  const email = input.student.studentEmail.trim().toLowerCase();
  const clash = await tx.member.findFirst({ where: { OR: [{ email }, { studentEmail: email }, { handle: input.handle }] }, select: { id: true } });
  if (clash) throw new AppError('CONFLICT', 'That university email or handle is already registered.', MODULE, undefined, 409);
  const member = await tx.member.create({
    data: {
      handle: input.handle,
      displayName: input.displayName,
      // The university email is the login email.
      email,
      passwordHash: opts.passwordHash ?? (await bcrypt.hash(input.password, 10)),
      joinedAt: ctx.now,
      joinRoute: 'STUDENT',
    },
  });
  const memberCtx = { ...ctx, actorId: member.id };
  // Existing new-member rules: an empty ledger account (0 credits). No invitation, vouch or inviter is created.
  await ensureMemberAccount(tx, member.id, member.displayName);
  await recordAudit(tx, memberCtx, {
    module: MODULE,
    action: 'member.joined_as_student',
    entityType: 'MEMBER',
    entityId: member.id,
    after: { handle: member.handle, joinRoute: 'STUDENT', university: input.student.university },
    reason: 'Accepted the community terms and joined as a student without an invitation (no inviter, no vouch).',
    ruleId: RULES.STUDENT_JOIN,
    summary: `${member.displayName} joined as a ${input.student.university} student`,
  });
  // University + domain re-validated server-side; the email starts unverified.
  const r = await setStudentDetails(tx, memberCtx, member.id, input.student);
  return r.member;
}

export interface AfterJoinResult {
  /** Demo mode: the account was admitted without verification. */
  demoAdmitted: boolean;
  /** Normal mode: where a university email code was actually sent, or null when nothing was sent. */
  studentVerification: { sentTo: string; delivery: string } | null;
  /** Plain statement for the UI; never claims an email was sent when it was not. */
  notice: string | null;
}

/**
 * After either join route commits. Demo mode: record the demo admission and send nothing. Normal mode:
 * send the university email code; if email delivery is unavailable the account still exists and the
 * member can resend from the verification screen (signup is never blocked by email).
 */
export async function afterJoin(ctx: Ctx, memberId: string, isStudent: boolean): Promise<AfterJoinResult> {
  if (!isStudent) return { demoAdmitted: false, studentVerification: null, notice: null };
  const memberCtx = { ...ctx, actorId: memberId };
  if (isDemoMode()) {
    await withTx((tx) => recordDemoAdmission(tx, memberCtx, memberId, 'student registration'));
    return { demoAdmitted: true, studentVerification: null, notice: 'Demo mode: university email verification was skipped. Nothing was emailed.' };
  }
  try {
    const r = await withTx((tx) => requestStudentEmailCode(tx, memberCtx, memberId));
    return {
      demoAdmitted: false,
      studentVerification: { sentTo: r.sentTo, delivery: r.delivery },
      notice: r.delivery === 'smtp' ? `A verification code was emailed to ${r.sentTo}.` : 'Development preview: the code is shown on screen, not emailed.',
    };
  } catch (e) {
    console.warn(`[${ctx.correlationId}] student code not sent after join:`, (e as Error).message);
    return { demoAdmitted: false, studentVerification: null, notice: `No email was sent: ${(e as Error).message}` };
  }
}
