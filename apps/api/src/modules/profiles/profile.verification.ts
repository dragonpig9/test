import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { RULES } from '../../config/policy';
import type { Ctx } from '../../core/context';
import { addMinutes } from '../../core/dates';
import { afterCommit, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { recordAudit } from '../audit/audit.service';
import { getMember } from '../members/member.repo';
import { deliveryMode } from '../notifications/email.provider';
import { enqueueTransactionalEmail, notificationAddress } from '../notifications/notification.service';

/**
 * Contact verification (separate from profile editing). A 6-digit code is emailed to the contact
 * address through the email outbox; entering it marks the address verified. The method is recorded:
 * "email-code" when a provider actually delivered it, "demo-preview" when demo mode only showed it on
 * screen (labelled as such everywhere). Phone verification needs an SMS provider, which is not built.
 */
const MODULE = 'profiles';
const CODE_MINUTES = 30;
const MAX_ATTEMPTS = 5;

const hash = (memberId: string, code: string) => createHash('sha256').update(`${memberId}:${code}`).digest('hex');

export async function requestEmailVerification(tx: Tx, ctx: Ctx, memberId: string) {
  const m = await getMember(tx, memberId);
  const address = notificationAddress(m);
  const mode = deliveryMode();
  if (mode === 'disabled') {
    throw new AppError('VERIFICATION_FAILED', 'Email delivery is not configured on this server, so a verification code cannot be sent.', MODULE);
  }
  await tx.emailVerification.updateMany({ where: { memberId, consumedAt: null }, data: { consumedAt: ctx.now } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const v = await tx.emailVerification.create({
    data: { memberId, address, codeHash: hash(memberId, code), expiresAt: addMinutes(ctx.now, CODE_MINUTES), createdAt: ctx.now },
  });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'profile.verification_requested',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { verificationId: v.id, delivery: mode },
    reason: mode === 'smtp' ? 'Code emailed to the contact address.' : 'Demo mode: code placed in the on-screen email preview (not delivered).',
    ruleId: RULES.CONTACT_VERIFY,
    summary: `${m.displayName} requested a contact email verification code`,
  });
  // The email row is written by the outbox after this transaction commits.
  const body = `Your CommonHours verification code is ${code}. It expires in ${CODE_MINUTES} minutes. If you did not ask for it, ignore this email.`;
  afterCommit(async () => {
    await enqueueTransactionalEmail(memberId, address, 'CommonHours: verify your contact email', body, `verify:${v.id}`);
  });
  return { verificationId: v.id, sentTo: address, delivery: mode, /** internal callers (demo seed) only; routes never return it */ code };
}

export async function confirmEmailVerification(tx: Tx, ctx: Ctx, memberId: string, code: string) {
  const m = await getMember(tx, memberId);
  const address = notificationAddress(m);
  const v = await tx.emailVerification.findFirst({ where: { memberId, consumedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!v || v.address !== address) throw new AppError('VERIFICATION_FAILED', 'No active code for your current contact email. Send a new code.', MODULE);
  if (v.expiresAt.getTime() < ctx.now.getTime()) throw new AppError('VERIFICATION_FAILED', 'This code has expired. Send a new code.', MODULE);
  if (v.attempts >= MAX_ATTEMPTS) throw new AppError('VERIFICATION_FAILED', 'Too many wrong attempts. Send a new code.', MODULE);
  const ok = timingSafeEqual(Buffer.from(hash(memberId, code)), Buffer.from(v.codeHash));
  if (!ok) {
    await tx.emailVerification.update({ where: { id: v.id }, data: { attempts: { increment: 1 } } });
    return { verified: false as const, attemptsLeft: MAX_ATTEMPTS - v.attempts - 1 };
  }
  const email = await tx.emailOutbox.findUnique({ where: { dedupeKey: `verify:${v.id}` } });
  const via = email && email.status !== 'PREVIEW' ? 'email-code' : 'demo-preview';
  await tx.emailVerification.update({ where: { id: v.id }, data: { consumedAt: ctx.now } });
  await tx.member.update({ where: { id: memberId }, data: { contactEmailVerifiedAt: ctx.now, contactEmailVerifiedVia: via } });
  await recordAudit(tx, ctx, {
    module: MODULE,
    action: 'profile.contact_verified',
    entityType: 'MEMBER',
    entityId: memberId,
    after: { method: via },
    reason: via === 'email-code' ? 'Code delivered by email and confirmed.' : 'Demo verification: code shown on screen, not delivered — labelled "demo-verified".',
    ruleId: RULES.CONTACT_VERIFY,
    summary: `${m.displayName} verified their contact email (${via})`,
  });
  return { verified: true as const, method: via };
}

export function requestPhoneVerification(): never {
  throw new AppError('PHONE_VERIFICATION_UNAVAILABLE', 'Phone verification is not available: no SMS provider is configured. Your phone stays “not verified”.', MODULE);
}
