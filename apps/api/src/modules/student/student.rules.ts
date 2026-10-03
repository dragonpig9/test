import type { Member } from '@prisma/client';
import { studentEmailProblem, universityByCode, type StudentStatusView } from '@commonhours/shared';
import { AppError } from '../../core/errors';

/**
 * Pure student rules. The university → domain mapping itself lives in packages/shared/src/universities.ts
 * (one configuration module shared by the web form and the API).
 */
const MODULE = 'student';

/** Backend re-validation of the university/domain pair (the client is never trusted). */
export function assertStudentEmailMatches(university: string, studentEmail: string) {
  const problem = studentEmailProblem(university, studentEmail.trim().toLowerCase());
  if (problem) throw new AppError('UNIVERSITY_DOMAIN_MISMATCH', problem, MODULE, { university, studentEmail });
}

/** Any change of university or address invalidates a previous verification. */
export function requiresReverification(current: Pick<Member, 'university' | 'studentEmail'>, next: { university: string; studentEmail: string }) {
  return current.university !== next.university || (current.studentEmail ?? '').toLowerCase() !== next.studentEmail.toLowerCase();
}

export type StudentFields = Pick<Member, 'accountType' | 'university' | 'studentEmail' | 'studentEmailVerifiedAt' | 'studentEmailVerifiedVia' | 'studentDeclaredAt'>;

export function studentEmailVerification(m: StudentFields): StudentStatusView['emailVerification'] {
  if (!m.studentEmail) return 'NOT_PROVIDED';
  if (!m.studentEmailVerifiedAt) return 'PENDING';
  return m.studentEmailVerifiedVia === 'email-code' ? 'VERIFIED' : 'DEMO_VERIFIED';
}

export function toStudentStatusView(m: StudentFields, devPreviewDelivery: boolean): StudentStatusView {
  const uni = universityByCode(m.university);
  const v = studentEmailVerification(m);
  const notes: string[] = [];
  if (v === 'VERIFIED') notes.push('University email verified: a one-time code sent to this address was confirmed.');
  if (v === 'DEMO_VERIFIED') notes.push('Development preview only: the code was shown on screen, so mailbox ownership was NOT proven. This is never shown as “verified”.');
  if (v === 'PENDING') notes.push('University email not verified yet. Send a code and enter it to verify.');
  if (m.studentDeclaredAt) notes.push('Current enrolment is self-declared. Owning a university email does not by itself prove current enrolment.');
  return {
    accountType: m.accountType,
    university: uni ? { code: uni.code, name: uni.name, domain: uni.domain } : null,
    studentEmail: m.studentEmail,
    emailVerification: v,
    emailVerifiedAt: m.studentEmailVerifiedAt?.toISOString() ?? null,
    declaredCurrentStudentAt: m.studentDeclaredAt?.toISOString() ?? null,
    notes,
    devPreviewDelivery,
  };
}
