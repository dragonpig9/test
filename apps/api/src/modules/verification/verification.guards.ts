import type { Member } from '@prisma/client';
import type { AdmissionView } from '@commonhours/shared';

/**
 * Verification guards (pure). The ONLY place that decides whether a verification requirement is met
 * or bypassed by demo mode. Callers pass `demoMode` from config/demo-mode.ts so these stay testable.
 *
 * Rules:
 *  - Genuine verification = a code delivered by a real email provider and confirmed ("email-code").
 *    A development preview ("dev-preview") or a demo admission never counts as genuine.
 *  - Demo mode bypasses verification prerequisites only. Account status (LEFT), invitations,
 *    credibility, trust thresholds, owner approval and credit rules are checked elsewhere, unchanged.
 *  - Demo admission is recorded separately (Member.demoAdmittedAt) and is never read here to grant
 *    access, so switching demo mode off restores the genuine requirements immediately — even for
 *    stale sessions and existing room memberships, because every request re-checks.
 */
export type GuardMember = Pick<
  Member,
  'status' | 'joinRoute' | 'accountType' | 'university' | 'studentEmail' | 'studentEmailVerifiedAt' | 'studentEmailVerifiedVia' | 'demoAdmittedAt'
>;

export function hasGenuineStudentVerification(m: Pick<Member, 'studentEmailVerifiedAt' | 'studentEmailVerifiedVia'>): boolean {
  return !!m.studentEmailVerifiedAt && m.studentEmailVerifiedVia === 'email-code';
}

export type ContactLevel = 'VERIFIED' | 'DEMO_VERIFIED' | 'UNVERIFIED';

/** High-trust tasks: a verified contact method, unless demo mode bypasses the prerequisite. */
export function contactRequirementMet(contact: ContactLevel, demoMode: boolean): { met: boolean; bypassed: boolean } {
  if (contact === 'VERIFIED') return { met: true, bypassed: false };
  return demoMode ? { met: true, bypassed: true } : { met: false, bypassed: false };
}

/**
 * App admission. Invited members are admitted by their invitation (the inviter's vouch), exactly as
 * before. Members who joined as students without an invitation are admitted by genuine university
 * email verification — or, in demo mode, by the demo bypass.
 */
export function admissionOf(m: GuardMember, demoMode: boolean): { admitted: boolean; via: 'INVITATION' | 'VERIFIED_EMAIL' | 'DEMO_BYPASS' | null } {
  if (m.joinRoute === 'INVITATION') return { admitted: true, via: 'INVITATION' };
  if (hasGenuineStudentVerification(m)) return { admitted: true, via: 'VERIFIED_EMAIL' };
  if (demoMode) return { admitted: true, via: 'DEMO_BYPASS' };
  return { admitted: false, via: null };
}

export type UniversityAccessVia = 'VERIFIED_EMAIL' | 'DEMO_SELF_DECLARED';

/**
 * Access to the member's university circle. A university picked in the profile is not enough on its
 * own: normal mode needs genuine verification of an address at that university's domain.
 */
export function universityAccessOf(m: GuardMember, demoMode: boolean): { university: string | null; allowed: boolean; via: UniversityAccessVia | null; reason: string } {
  if (!m.university) return { university: null, allowed: false, via: null, reason: 'Add your university in your profile to join its circle.' };
  if (m.status !== 'ACTIVE') return { university: m.university, allowed: false, via: null, reason: 'Members who have left the community cannot use circles.' };
  if (hasGenuineStudentVerification(m)) return { university: m.university, allowed: true, via: 'VERIFIED_EMAIL', reason: 'University email verified.' };
  if (demoMode) return { university: m.university, allowed: true, via: 'DEMO_SELF_DECLARED', reason: 'Demo mode: university affiliation is self-declared, not verified.' };
  return { university: m.university, allowed: false, via: null, reason: `Verify your ${m.university} email to join the ${m.university} Circle.` };
}

/**
 * The public label shown instead of a verified badge for accounts admitted through the demo bypass.
 * Never "verified": a genuine verification shows the normal verified badge instead.
 */
export function demoBadgeOf(m: Pick<Member, 'accountType' | 'demoAdmittedAt' | 'studentEmailVerifiedAt' | 'studentEmailVerifiedVia'>): 'Demo student' | 'Demo member' | null {
  if (!m.demoAdmittedAt || hasGenuineStudentVerification(m)) return null;
  return m.accountType === 'STUDENT' ? 'Demo student' : 'Demo member';
}

/** What the web app needs to decide which screens to show. */
export function admissionView(m: GuardMember & Pick<Member, 'accountType'>, demoMode: boolean): AdmissionView {
  const a = admissionOf(m, demoMode);
  const u = universityAccessOf(m, demoMode);
  const studentPending = !!m.studentEmail && !hasGenuineStudentVerification(m);
  return {
    demoMode,
    admitted: a.admitted,
    admittedVia: a.via,
    // Normal mode only: the verification screen. Demo mode never shows blocking verification UI.
    verificationRequired: !a.admitted,
    studentVerificationPending: studentPending,
    showVerificationPrompts: !demoMode && studentPending,
    universityAccess: { university: u.university, allowed: u.allowed, via: u.via, reason: u.reason },
    demoBadge: demoBadgeOf(m),
  };
}
