import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { POLICY, RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { addMinutes } from '../../core/dates';
import { afterCommit, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { getMember } from '../members/member.repo';
import { deliveryMode } from '../notifications/email.provider';
import { enqueueTransactionalEmail } from '../notifications/notification.service';

/**
 * University email ownership: an expiring (POLICY.student.codeMinutes), single-use 6-digit code sent to
 * the university address. Codes are bound to the address they were sent to, so changing the university
 * or email makes outstanding codes useless. Separate from contact verification (purpose = "student").
 *
 * Delivery:
 *   smtp    — a provider is configured: real email, verified via "email-code".
 *   preview — DEVELOPMENT ONLY (env.devShortcuts, never in production): the code appears in the on-screen
 *             email preview and the result is labelled "dev-preview", never "University email verified".
 *   none    — otherwise: codes cannot be sent; configure EMAIL_PROVIDER.
 */
const MODULE = 'student';

const hash = (memberId: string, code: string) => createHash('sha256').update(`student:${memberId}:${code}`).digest('hex');

export function studentCodeDelivery(): 'smtp' | 'preview' | 'none' {
  const mode = deliveryMode();
  if (mode === 'smtp') return 'smtp';
  return env.devShortcuts ? 'preview' : 'none';
}

export async function requestStudentEmailCode(tx: Tx, ctx: Ctx, memberId: string) {
  const m = await getMember(tx, memberId);
  if (!m.studentEmail || !m.university) throw new AppError('VERIFICATION_FAILED', 'Add your university and university email first.', MODULE);
  if (m.studentEmailVerifiedAt && m.studentEmailVerifiedVia === 'email-code') {
    throw new AppError('ALREADY_DONE', 'Your university email is already verified.', MODULE, undefined, 409);
  }
  const delivery = studentCodeDelivery();
  if (delivery === 'none') {
    throw new AppError('VERIFICATION_FAILED', 'Email delivery is not configured on this server, so a university email code cannot be sent.', MODULE);
  }
  // Single active code: any earlier unused code is consumed.
  await tx.emailVerification.updateMany({ where: { memberId, purpose: 'student', consumedAt: null }, data: { consumedAt: ctx.now } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const v = await tx.emailVerification.create({
    data: { memberId, purpose: 'student', address: m.studentEmail, codeHash: hash(memberId, code), expiresAt: addMinutes(ctx.now, POLICY.student.codeMinutes), createdAt: ctx.now },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'student.verification_requested',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { verificationId: v.id, delivery, university: m.university },
    reason: delivery === 'smtp' ? 'Code emailed to the university address.' : 'Development preview: code shown on screen, not delivered.',
    ruleId: RULES.STUDENT_VERIFY,
    summary: `${m.displayName} requested a university email code (${m.university})`,
  });
  const address = m.studentEmail;
  const body = `Your CommonHours university email code is ${code}. It expires in ${POLICY.student.codeMinutes} minutes and can be used once. If you did not ask for it, ignore this email.`;
  afterCommit(async () => {
    await enqueueTransactionalEmail(memberId, address, 'CommonHours: verify your university email', body, `student-verify:${v.id}`);
  });
  return { verificationId: v.id, sentTo: address, delivery, /** internal callers (tests) only; routes never return it */ code };
}

export async function confirmStudentEmailCode(tx: Tx, ctx: Ctx, memberId: string, code: string) {
  const m = await getMember(tx, memberId);
  const v = await tx.emailVerification.findFirst({ where: { memberId, purpose: 'student', consumedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!v || !m.studentEmail || v.address !== m.studentEmail) {
    throw new AppError('VERIFICATION_FAILED', 'No active code for your current university email. Send a new code.', MODULE);
  }
  if (v.expiresAt.getTime() < ctx.now.getTime()) throw new AppError('VERIFICATION_FAILED', 'This code has expired. Send a new code.', MODULE);
  if (v.attempts >= POLICY.student.maxAttempts) throw new AppError('VERIFICATION_FAILED', 'Too many wrong attempts. Send a new code.', MODULE);
  const ok = timingSafeEqual(Buffer.from(hash(memberId, code)), Buffer.from(v.codeHash));
  if (!ok) {
    await tx.emailVerification.update({ where: { id: v.id }, data: { attempts: { increment: 1 } } });
    return { verified: false as const, attemptsLeft: POLICY.student.maxAttempts - v.attempts - 1 };
  }
  const email = await tx.emailOutbox.findUnique({ where: { dedupeKey: `student-verify:${v.id}` } });
  const via = email && email.status !== 'PREVIEW' ? 'email-code' : 'dev-preview';
  // Single use: a conditional update, so two concurrent confirmations cannot both succeed.
  const used = await tx.emailVerification.updateMany({ where: { id: v.id, consumedAt: null }, data: { consumedAt: ctx.now } });
  if (used.count !== 1) throw new AppError('VERIFICATION_FAILED', 'This code was already used. Send a new code.', MODULE);
  await tx.member.update({ where: { id: memberId }, data: { studentEmailVerifiedAt: ctx.now, studentEmailVerifiedVia: via } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'student.email_verified',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { method: via, university: m.university },
    reason: via === 'email-code' ? 'Code delivered to the university address and confirmed.' : 'Development preview code confirmed (mailbox ownership not proven).',
    ruleId: RULES.STUDENT_VERIFY,
    summary: `${m.displayName} confirmed their university email (${via})`,
  });
  return { verified: true as const, method: via };
}
